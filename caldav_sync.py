import json
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


def _ical_escape_text(s: str) -> str:
    """
    Escape text for RFC5545 iCalendar fields.
    """
    if s is None:
        return ""
    s = str(s)
    s = s.replace("\\", "\\\\")
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = s.replace("\n", "\\n")
    s = s.replace(",", "\\,").replace(";", "\\;")
    return s


def _dtstamp_utc() -> str:
    return datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")


def _date_to_ical(d: date) -> str:
    return d.strftime("%Y%m%d")


def _datetime_floating(dt: datetime) -> str:
    # Floating local time: YYYYMMDDTHHMMSS (no TZID, no Z suffix)
    return dt.strftime("%Y%m%dT%H%M%S")


def _build_all_day_vcal(uid: str, start_d: date, end_d: date, summary: str, description: str) -> str:
    return (
        "BEGIN:VCALENDAR\n"
        "VERSION:2.0\n"
        "PRODID:-//gua_file//CalDAV Sync//EN\n"
        "BEGIN:VEVENT\n"
        f"UID:{uid}\n"
        f"DTSTAMP:{_dtstamp_utc()}\n"
        f"DTSTART;VALUE=DATE:{_date_to_ical(start_d)}\n"
        f"DTEND;VALUE=DATE:{_date_to_ical(end_d)}\n"
        f"SUMMARY:{_ical_escape_text(summary)}\n"
        f"DESCRIPTION:{_ical_escape_text(description)}\n"
        "END:VEVENT\n"
        "END:VCALENDAR"
    )


def _add_minutes(h: int, m: int, add: int) -> Tuple[int, int]:
    total = h * 60 + m + add
    h2 = (total // 60) % 24
    m2 = total % 60
    return int(h2), int(m2)


def _build_timed_vcal(uid: str, start_dt: datetime, end_dt: datetime, summary: str, description: str) -> str:
    return (
        "BEGIN:VCALENDAR\n"
        "VERSION:2.0\n"
        "PRODID:-//gua_file//CalDAV Sync//EN\n"
        "BEGIN:VEVENT\n"
        f"UID:{uid}\n"
        f"DTSTAMP:{_dtstamp_utc()}\n"
        f"DTSTART:{_datetime_floating(start_dt)}\n"
        f"DTEND:{_datetime_floating(end_dt)}\n"
        f"SUMMARY:{_ical_escape_text(summary)}\n"
        f"DESCRIPTION:{_ical_escape_text(description)}\n"
        "END:VEVENT\n"
        "END:VCALENDAR"
    )


def _iter_dates(start_d: date, end_d: date) -> Iterable[date]:
    cur = start_d
    while cur <= end_d:
        yield cur
        cur += timedelta(days=1)


def _date_str(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def is_checkin_event_active_for_date(evt: Dict[str, Any], date_str: str) -> bool:
    """
    Replicates the front-end logic in static/checkin.js:
    - if no dateStart/dateEnd => always active
    - if dateStart exists and dateStr < dateStart => inactive
    - if dateEnd exists and dateStr > dateEnd => inactive
    """
    date_start = evt.get("dateStart") or None
    date_end = evt.get("dateEnd") or None
    if not date_start and not date_end:
        return True
    if date_start and date_str < date_start:
        return False
    if date_end and date_str > date_end:
        return False
    return True


def _parse_hour_minute(evt: Dict[str, Any]) -> Tuple[Optional[int], Optional[int]]:
    hour = evt.get("hour", None)
    minute = evt.get("minute", None)
    if hour is None or hour == "":
        hour = None
    if minute is None or minute == "":
        minute = None
    try:
        hour_i = int(hour) if hour is not None else None
    except Exception:
        hour_i = None
    try:
        minute_i = int(minute) if minute is not None else None
    except Exception:
        minute_i = None
    return hour_i, minute_i


def build_desired_caldav_events(
    checkin_data: Dict[str, Any],
    start_d: date,
    end_d: date,
) -> Tuple[Dict[str, str], Set[str]]:
    """
    Build desired mapping: uid -> vcalendar(VCALENDAR string).

    Returns:
      (desired_events_by_uid, desired_uid_set)
    """
    events: List[Dict[str, Any]] = list(checkin_data.get("events") or [])
    records: List[Dict[str, Any]] = list(checkin_data.get("records") or [])
    date_labels: Dict[str, Any] = checkin_data.get("dateLabels") or {"specific": {}, "annual": {}}

    # completion sets
    completed: Dict[str, Set[str]] = {}
    for r in records:
        eid = str(r.get("eventId") or "")
        dstr = r.get("date") or ""
        if not eid or not dstr:
            continue
        completed.setdefault(eid, set()).add(dstr)

    desired: Dict[str, str] = {}

    # 1) checkin events (plan + completion update)
    checkins = [e for e in events if (e.get("type") or "") == "checkin"]
    for evt in checkins:
        evt_id = str(evt.get("id") or "")
        name = str(evt.get("name") or "")
        if not evt_id or not name:
            continue

        # effective range
        date_start = evt.get("dateStart") or start_d.strftime("%Y-%m-%d")
        date_end = evt.get("dateEnd") or end_d.strftime("%Y-%m-%d")

        try:
            ds = max(date_start, start_d.strftime("%Y-%m-%d"))
            de = min(date_end, end_d.strftime("%Y-%m-%d"))
            cur_s = datetime.strptime(ds, "%Y-%m-%d").date()
            cur_e = datetime.strptime(de, "%Y-%m-%d").date()
        except Exception:
            continue

        # guard: if end < start, skip
        if cur_e < cur_s:
            continue

        for d in _iter_dates(cur_s, cur_e):
            dstr = _date_str(d)
            if not is_checkin_event_active_for_date(evt, dstr):
                continue
            uid = f"gua_checkin:{evt_id}:{dstr}"
            done = dstr in (completed.get(evt_id) or set())
            summary = f"[打卡✓] {name}" if done else f"[打卡] {name}"
            desc = f"日期：{dstr}\n状态：{'已完成' if done else '未完成'}"
            desired[uid] = _build_all_day_vcal(uid, d, d + timedelta(days=1), summary, desc)

    # 2) reminder events (plan on specific/monthly + completion update)
    reminders = [e for e in events if (e.get("type") or "") == "reminder"]
    for evt in reminders:
        evt_id = str(evt.get("id") or "")
        name = str(evt.get("name") or "")
        if not evt_id or not name:
            continue

        date_type = evt.get("dateType") or "specific"
        # For monthly, hour/minute are not stored by current UI, so we treat monthly as all-day.
        hour_i, minute_i = _parse_hour_minute(evt)

        for d in _iter_dates(start_d, end_d):
            dstr = _date_str(d)
            active = False
            if date_type == "specific":
                if (evt.get("specificDate") or "") == dstr:
                    active = True
            elif date_type == "monthly":
                # replicate getRemindersForDate() logic
                day_of_month = evt.get("dayOfMonth")
                if day_of_month is None:
                    continue
                try:
                    dom = int(day_of_month)
                except Exception:
                    continue
                if d.day != dom:
                    continue
                mstart = evt.get("monthlyStartDate") or start_d.strftime("%Y-%m-%d")
                mend = evt.get("monthlyEndDate") or end_d.strftime("%Y-%m-%d")
                # string compare works because YYYY-MM-DD
                if dstr >= mstart and dstr <= mend:
                    active = True
            if not active:
                continue

            uid = f"gua_reminder:{evt_id}:{dstr}"
            done = dstr in (completed.get(evt_id) or set())
            summary = f"[提醒✓] {name}" if done else f"[提醒] {name}"
            desc = f"日期：{dstr}\n状态：{'已完成' if done else '未完成'}"

            if date_type == "specific" and hour_i is not None and minute_i is not None:
                start_dt = datetime.combine(d, time(hour_i, minute_i))
                end_h, end_m = _add_minutes(hour_i, minute_i, 15)
                end_dt = datetime.combine(d, time(end_h, end_m))
                desired[uid] = _build_timed_vcal(uid, start_dt, end_dt, summary, desc)
            else:
                desired[uid] = _build_all_day_vcal(uid, d, d + timedelta(days=1), summary, desc)

    # 3) date labels (optional): generate all-day events for labels shown on UI.
    labels_specific = date_labels.get("specific") or {}
    labels_annual = date_labels.get("annual") or {}

    for d in _iter_dates(start_d, end_d):
        dstr = _date_str(d)
        # replicate a simplified version of getLabelsForDate()
        # a) specific labels
        specific_arr = labels_specific.get(dstr) if isinstance(labels_specific, dict) else None
        label_entries: List[Dict[str, Any]] = []
        if isinstance(specific_arr, list):
            label_entries.extend([x for x in specific_arr if x and x.get("name")])
        elif isinstance(specific_arr, dict) and specific_arr.get("name"):
            label_entries.append(specific_arr)
        elif isinstance(specific_arr, str) and specific_arr:
            label_entries.append({"name": specific_arr, "addType": "custom"})

        # b) annual labels
        mm = f"{d.month:02d}"
        dd = f"{d.day:02d}"
        mmdd = f"{mm}-{dd}"

        def is_in_annual_range(item: Dict[str, Any]) -> bool:
            start = item.get("annualStartDate") or "1900-01-01"
            end = item.get("annualEndDate") or "2099-12-31"
            return dstr >= start and dstr <= end

        annual_arr = labels_annual.get(mmdd) if isinstance(labels_annual, dict) else None
        if isinstance(annual_arr, list):
            label_entries.extend([x for x in annual_arr if x and x.get("name") and is_in_annual_range(x)])
        elif isinstance(annual_arr, dict) and annual_arr.get("name"):
            if is_in_annual_range(annual_arr):
                label_entries.append(annual_arr)

        # overflow logic: if day is last day and lastDay < 31, UI also checks keys mm-(lastDay+1..31)
        last_day = (date(d.year, d.month, 1) + timedelta(days=31)).replace(day=1) - timedelta(days=1)
        if d.day == last_day.day and last_day.day < 31:
            for add_d in range(last_day.day + 1, 32):
                overflow_mmdd = f"{mm}-{add_d:02d}"
                overflow_arr = labels_annual.get(overflow_mmdd) if isinstance(labels_annual, dict) else None
                if isinstance(overflow_arr, list):
                    label_entries.extend(
                        [x for x in overflow_arr if x and x.get("name") and is_in_annual_range(x)]
                    )
                elif isinstance(overflow_arr, dict) and overflow_arr.get("name"):
                    if is_in_annual_range(overflow_arr):
                        label_entries.append(overflow_arr)

        # create events
        for l in label_entries:
            add_type = str(l.get("addType") or "custom")
            name = str(l.get("name") or "")
            if not name:
                continue
            uid = f"gua_label:{dstr}:{add_type}:{name}"
            summary = name
            desc = f"标签类型：{add_type}\n日期：{dstr}"
            desired[uid] = _build_all_day_vcal(uid, d, d + timedelta(days=1), summary, desc)

    desired_uids = set(desired.keys())
    return desired, desired_uids


def _extract_vevent_uid_from_caldav_event(event: Any) -> Optional[str]:
    """
    Try to extract VEVENT UID from a caldav Event object.
    """
    try:
        # caldav 3.x: event.get_icalendar_instance() is supported in examples
        ical_copy = event.get_icalendar_instance()
        # ical_copy is an iCalendar object with subcomponents
        for comp in getattr(ical_copy, "subcomponents", []) or []:
            if getattr(comp, "name", None) == "VEVENT":
                uid_val = comp.get("UID")
                if uid_val is None:
                    continue
                return str(uid_val)
    except Exception:
        pass
    return None


def sync_checkin_to_caldav(config: Dict[str, Any], checkin_data: Dict[str, Any], window_days: int = 90) -> Dict[str, Any]:
    """
    One-way sync: generate desired events from checkin_data and push to CalDAV.
    """
    import caldav  # imported lazily so server can run without caldav installed

    caldav_url = str(config.get("caldav_url") or "").strip()
    calendar_url = str(config.get("calendar_url") or "").strip()
    username = str(config.get("username") or "").strip()
    password = str(config.get("password") or "")

    if not caldav_url or not calendar_url or not username:
        return {"success": False, "message": "CalDAV 配置不完整"}

    today = date.today()
    start_d = today
    end_d = today + timedelta(days=window_days)

    desired, desired_uids = build_desired_caldav_events(checkin_data, start_d, end_d)

    client = caldav.DAVClient(url=caldav_url, username=username, password=password)
    calendar = client.calendar(url=calendar_url)

    # Fetch existing events in range and delete obsolete ones (only our UID prefixes)
    desired_prefixes = ("gua_checkin:", "gua_reminder:", "gua_label:")
    start_dt = datetime.combine(start_d, time.min)
    end_dt = datetime.combine(end_d + timedelta(days=1), time.min)

    deleted = 0
    created_or_updated = 0
    errors: List[str] = []

    try:
        existing_events = calendar.search(start=start_dt, end=end_dt, event=True, expand=False)
    except Exception as exc:
        existing_events = []
        errors.append(f"读取现有事件失败：{exc}")

    for ev in existing_events or []:
        uid = _extract_vevent_uid_from_caldav_event(ev)
        if not uid:
            continue
        if not uid.startswith(desired_prefixes):
            continue
        if uid not in desired_uids:
            try:
                ev.delete()
                deleted += 1
            except Exception as exc:
                errors.append(f"删除事件失败 UID={uid}: {exc}")

    # Create/update by saving VCALENDAR with UID
    for uid, vcal in desired.items():
        try:
            calendar.save_event(vcal)
            created_or_updated += 1
        except Exception as exc:
            errors.append(f"保存事件失败 UID={uid}: {exc}")

    return {
        "success": True,
        "range": {"start": _date_str(start_d), "end": _date_str(end_d)},
        "desired_count": len(desired),
        "created_or_updated": created_or_updated,
        "deleted": deleted,
        "errors": errors[:20],
    }

