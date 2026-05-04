import os
import json
import csv
import io
import sqlite3
import ssl
import re
import socket
import difflib
import uuid
from datetime import datetime, date, timedelta
from urllib.parse import urlencode
from math import ceil
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

from flask import Flask, jsonify, render_template, request, Response, redirect, url_for, send_file
from send2trash import send2trash

from database import (
    init_db,
    get_remark,
    set_remark,
    update_path,
    get_all_notes,
    get_note,
    add_note,
    update_note,
    delete_note,
    count_notes_in_category,
    rename_notes_category,
    get_all_bookmarks,
    get_bookmark,
    add_bookmark,
    update_bookmark,
    delete_bookmark,
    swap_bookmarks as swap_bookmarks_db,
    get_app_state,
    set_app_state,
    get_all_vocab_words,
    set_vocab_state,
    get_all_todos,
    set_todos_state,
    get_calendar_events,
    set_calendar_state,
    get_diary,
    upsert_diary,
    list_diaries_between,
    get_ledger_tags,
    get_ledger_tag_by_id,
    add_ledger_tag,
    rename_ledger_tag,
    delete_ledger_tag_if_unused,
    add_ledger_entry,
    update_ledger_entry,
    delete_ledger_entry,
    ledger_retention_month_start_iso,
    run_ledger_retention_archive,
    query_ledger_entries_between,
    query_ledger_entries_archive_between,
    sum_ledger_between,
    query_ledger_daily_expense_by_day,
    query_ledger_tag_expense_ratios,
    ledger_expense_breakdown_between,
    upsert_ledger_budget_cell,
    list_ledger_budget_cells,
    update_ledger_budget_cell_amount,
    resolve_ledger_budget_amount,
    get_todo_instances_for_date,
    get_todo_instances_completed_on,
    insert_todo_instance,
    update_todo_instance_status,
    clone_pending_todo_instances,
    purge_orphan_todo_instances,
    heal_stale_pending_todo_instances_for_date,
    add_ip_access_log,
    count_distinct_access_ips,
    get_recent_online_ip_stats,
    list_distinct_ips_in_log_range,
    count_ip_access_logs_filtered,
    get_ip_access_logs_filtered,
    get_content_tags,
    add_content_tag,
    update_content_tag,
    delete_content_tag_if_unused,
    add_content_record,
    update_content_record,
    delete_content_record,
    get_content_record,
    content_record_related_ids_from_ext_json,
    sync_content_record_related_links,
    set_content_record_tags,
    query_content_records,
    get_content_calendar_aggregates,
    search_content_record_titles,
    is_valid_content_record_public_id,
    normalize_content_record_public_id,
    query_content_persons,
    get_content_person,
    get_content_person_works,
    is_valid_content_person_public_id,
    search_content_person_suggest,
    toggle_content_person_liked,
    update_content_person_profile,
    delete_content_person_when_no_links,
)
from utils import scan_directory, validate_directory_path
from caldav_sync import sync_checkin_to_caldav


app = Flask(__name__)

# Initialize SQLite database for remarks storage.
init_db()
try:
    run_ledger_retention_archive()
except Exception:
    pass

# In-memory cache for the last scan result
SCAN_RESULTS: List[Dict[str, Any]] = []


def _get_client_ip() -> str:
    """
    Best-effort client IP extraction for local networks / reverse proxies.
    """
    xff = (request.headers.get("X-Forwarded-For") or "").strip()
    if xff:
        return xff.split(",")[0].strip()
    return (request.remote_addr or "").strip()


def _guess_lan_ipv4() -> str:
    """
    推测运行本服务机器的局域网 IPv4（用于生成同 Wi-Fi 访问链接）。
    无网络或受限环境时返回空字符串。
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            ip = str(s.getsockname()[0] or "").strip()
        finally:
            s.close()
        if ip.startswith("127."):
            return ""
        return ip
    except Exception:
        return ""


def _server_listen_port_int() -> int:
    """
    生成对外访问链接时使用的端口。
    优先读取环境变量 PORT；否则使用 Werkzeug 的 SERVER_PORT。
    在测试客户端等场景下 SERVER_PORT 常为 80，此时回退到默认 5001。
    """
    try:
        if os.environ.get("PORT"):
            return int(os.environ.get("PORT", "5001"))
    except Exception:
        pass
    try:
        sp = int(request.environ.get("SERVER_PORT") or 0)
    except Exception:
        sp = 0
    if sp and sp not in (80, 443):
        return sp
    return 5001


@app.before_request
def _log_ip_access() -> None:
    """
    Record each non-static request: timestamp (to seconds), ip, and page.
    """
    try:
        path = request.full_path or request.path or ""
        if path.endswith("?"):
            path = path[:-1]
        if request.path.startswith("/static/") or request.path in ("/favicon.ico",):
            return
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ip = _get_client_ip()
        add_ip_access_log(ts=ts, ip=ip, path=path)
    except Exception:
        return


def _load_checkin_state() -> Dict[str, Any]:
    """
    Load checkin state from app_state; ensure minimal structure.
    """
    raw = None
    try:
        raw = get_app_state(CHECKIN_STATE_KEY)
    except Exception:
        raw = None
    if not raw:
        return DEFAULT_CHECKIN_STATE.copy()
    try:
        data = json.loads(raw)
    except Exception:
        data = DEFAULT_CHECKIN_STATE.copy()
    if not isinstance(data, dict):
        data = DEFAULT_CHECKIN_STATE.copy()
    data.setdefault("events", [])
    data.setdefault("records", [])
    data.setdefault("dateLabels", {"specific": {}, "annual": {}})
    return data

CHECKIN_STATE_KEY = "checkin_data"
DEFAULT_CHECKIN_STATE: Dict[str, Any] = {
    "events": [],
    "records": [],
    "dateLabels": {"specific": {}, "annual": {}},
}

CALDAV_CONFIG_KEY = "caldav_config"

VOCAB_STATE_KEY = "vocab_data"
DEFAULT_VOCAB_STATE: Dict[str, Any] = {
    "items": [],
    "tags": [],  # { "name": str, "scope": "english" | "chinese" }
}

TODOS_STATE_KEY = "todos_data"
DEFAULT_TODOS_STATE: Dict[str, Any] = {
    "items": [],
}

NOTES_CATEGORIES_STATE_KEY = "notes_categories"
DEFAULT_NOTES_CATEGORIES_STATE: Dict[str, Any] = {
    "items": ["AI", "系统使用", "读书笔记", "其他"],
}


# LLM 配置文件路径（可选）：config_llm.json
LLM_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config_llm.json")


def _load_llm_config() -> Dict[str, str]:
    """
    从本地 config_llm.json 加载大模型配置（api_key / base_url / model）。
    若文件不存在或解析失败，则返回空配置，后续再回退到环境变量。
    """
    try:
        with open(LLM_CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {"api_key": "", "base_url": "", "model": ""}
    except Exception:
        return {"api_key": "", "base_url": "", "model": ""}

    return {
        "api_key": str(data.get("api_key") or "").strip(),
        "base_url": str(data.get("base_url") or "").strip(),
        "model": str(data.get("model") or "").strip(),
    }


def get_paginated_items(
    items: List[Dict[str, Any]],
    page: int,
    per_page: int,
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Paginate a list of items.

    :param items: The list of items to paginate.
    :param page: The current page number (1-based).
    :param per_page: Number of items per page.
    :return: A tuple of (page_items, total_pages).
    """
    total = len(items)
    if per_page <= 0:
        per_page = 1
    total_pages = (total + per_page - 1) // per_page if total > 0 else 1
    if page < 1:
        page = 1
    if page > total_pages:
        page = total_pages
    start = (page - 1) * per_page
    end = start + per_page
    return items[start:end], total_pages


def sort_items(
    items: List[Dict[str, Any]],
    sort_by: str,
    sort_order: str,
) -> List[Dict[str, Any]]:
    """
    Sort a list of file items based on a given field and order.

    :param items: The list of file items.
    :param sort_by: The field name to sort by.
    :param sort_order: The sort order, "asc" or "desc".
    :return: Sorted list of items.
    """
    reverse = sort_order == "desc"

    def sort_key(item: Dict[str, Any]) -> Any:
        """
        Generate a sort key for each item based on the requested field.

        :param item: Single file item.
        :return: Sort key value.
        """
        if sort_by == "name":
            return item.get("name", "").lower()
        if sort_by == "size":
            return item.get("size_bytes", 0)
        if sort_by == "extension":
            return item.get("extension", "")
        if sort_by == "created_at":
            return item.get("created_at_ts", 0.0)
        if sort_by == "modified_at":
            return item.get("modified_at_ts", 0.0)
        # Default to name sort if field is unknown
        return item.get("name", "").lower()

    return sorted(items, key=sort_key, reverse=reverse)


def filter_items(
    items: List[Dict[str, Any]],
    file_type: Optional[str],
    search: Optional[str],
) -> List[Dict[str, Any]]:
    """
    Filter items by file type and search keyword.

    :param items: The list of file items.
    :param file_type: Optional file type filter, e.g. "word", "excel", "hidden".
    :param search: Optional search keyword for filename fuzzy search.
    :return: Filtered list of items.
    """
    filtered = items

    if file_type:
        file_type_lower = file_type.lower()
        if file_type_lower == "hidden":
            filtered = [item for item in filtered if item.get("is_hidden")]
        else:
            filtered = [
                item
                for item in filtered
                if item.get("file_type_key", "").lower() == file_type_lower
            ]

    if search:
        keyword = search.lower()
        filtered = [
            item for item in filtered if keyword in item.get("name", "").lower()
        ]

    return filtered


def normalize_file_title(name: str) -> str:
    """
    Normalize filename text for similarity matching:
    - remove extension
    - lowercase
    - remove non-alphanumeric / non-Chinese chars
    """
    base = os.path.splitext(str(name or ""))[0].lower()
    return re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff]+", "", base)


def _name_similarity_ratio(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def build_similar_file_groups(
    items: List[Dict[str, Any]],
    ratio_threshold: float = 0.9,
    size_diff_limit_bytes: int = 102400,
) -> List[Dict[str, Any]]:
    """
    Build connected-component groups for near-duplicate files.
    Rule:
    - normalized title similarity >= ratio_threshold
    - absolute size diff <= size_diff_limit_bytes
    """
    candidates: List[Dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        size_bytes = it.get("size_bytes")
        name = it.get("name")
        file_type_key = str(it.get("file_type_key") or "").strip().lower()
        if size_bytes is None or not name:
            continue
        try:
            sz = int(size_bytes)
        except Exception:
            continue
        normalized = normalize_file_title(str(name))
        if not normalized:
            continue
        candidates.append(
            {
                "item": it,
                "name_norm": normalized,
                "size_bytes": sz,
                "file_type_key": file_type_key,
            }
        )

    n = len(candidates)
    if n < 2:
        return []

    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(n):
        a = candidates[i]
        for j in range(i + 1, n):
            b = candidates[j]
            # 新规则：必须是同一工具类型（如 word 组里可包含 doc/docx）
            if a["file_type_key"] != b["file_type_key"]:
                continue
            if abs(a["size_bytes"] - b["size_bytes"]) > size_diff_limit_bytes:
                continue
            if _name_similarity_ratio(a["name_norm"], b["name_norm"]) >= ratio_threshold:
                union(i, j)

    buckets: Dict[int, List[Dict[str, Any]]] = {}
    for idx, c in enumerate(candidates):
        root = find(idx)
        buckets.setdefault(root, []).append(c["item"])

    groups: List[Dict[str, Any]] = []
    seq = 1
    for _, grouped_items in buckets.items():
        if len(grouped_items) < 2:
            continue
        def _item_created_ts(it: Dict[str, Any]) -> float:
            raw_ts = it.get("created_at_ts")
            try:
                return float(raw_ts)
            except Exception:
                pass
            raw_text = str(it.get("created_at") or "").strip()
            if raw_text:
                try:
                    return datetime.strptime(raw_text, "%Y-%m-%d %H:%M:%S").timestamp()
                except Exception:
                    pass
            return 0.0

        earliest_created_ts = min(_item_created_ts(x) for x in grouped_items)
        items_sorted = sorted(
            grouped_items,
            key=lambda x: (
                str(x.get("modified_at") or ""),
                int(x.get("size_bytes") or 0),
            ),
            reverse=True,
        )
        groups.append(
            {
                "group_id": f"sim_{seq:04d}",
                "count": len(items_sorted),
                "representative_full_path": str(items_sorted[0].get("full_path") or ""),
                "earliest_created_ts": earliest_created_ts,
                "items": items_sorted,
            }
        )
        seq += 1

    # 按组内最早文件时间升序排列；时间相同再按组内文件数降序
    groups.sort(
        key=lambda g: (
            float(g.get("earliest_created_ts") or 0.0),
            -int(g.get("count") or 0),
            str(g.get("group_id") or ""),
        )
    )
    for idx, g in enumerate(groups, start=1):
        g["group_id"] = f"sim_{idx:04d}"
    return groups


@app.route("/")
def index() -> str:
    """
    Redirect root URL to /home（端口由运行配置决定，默认见 main() 中的 PORT）。
    """
    return redirect(url_for("home"))


@app.route("/home")
def home() -> str:
    """
    Render the home page.
    :return: Rendered HTML content.
    """
    ip_count = 0
    online_link_ip_count = 0
    online_ips: List[str] = []
    recent_online_minutes = 15
    try:
        ip_count = count_distinct_access_ips()
    except Exception:
        ip_count = 0
    try:
        online_link_ip_count, online_ips = get_recent_online_ip_stats(recent_online_minutes)
    except Exception:
        online_link_ip_count, online_ips = 0, []
    return render_template(
        "home.html",
        ip_count=ip_count,
        online_link_ip_count=online_link_ip_count,
        online_ips=online_ips,
        recent_online_minutes=recent_online_minutes,
    )


@app.route("/api/network-access-hint", methods=["GET"])
def api_network_access_hint() -> Any:
    """
    返回本机推测的局域网 IP 与首页访问链接（供同 Wi-Fi 设备使用）。
    """
    lip = _guess_lan_ipv4()
    if not lip:
        return jsonify(
            {
                "success": False,
                "message": "无法探测局域网 IPv4（请确认本机已联网，或手动查看系统网络设置中的 IP）。",
            }
        )
    port = _server_listen_port_int()
    origin = f"http://{lip}:{port}"
    home_url = origin + "/home"
    return jsonify(
        {
            "success": True,
            "lan_ip": lip,
            "port": port,
            "origin": origin,
            "home_url": home_url,
        }
    )


@app.route("/calendar")
def calendar_page() -> str:
    """独立日历页面。"""
    return render_template("calendar.html")


def _parse_month_param(month_str: Optional[str]) -> Tuple[int, int]:
    """
    Parse month parameter 'YYYY-MM'. Fallback to current year/month.
    """
    now = datetime.now()
    if not month_str:
        return now.year, now.month
    try:
        y_str, m_str = (month_str or "").split("-", 1)
        y = int(y_str)
        m = int(m_str)
        if 1 <= m <= 12:
            return y, m
    except Exception:
        pass
    return now.year, now.month


def _month_date_range(year: int, month: int) -> Tuple[str, str]:
    """
    Return (start_date, end_date) string pair for given year/month.
    """
    first = date(year, month, 1)
    if month == 12:
        last = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        last = date(year, month + 1, 1) - timedelta(days=1)
    return first.strftime("%Y-%m-%d"), last.strftime("%Y-%m-%d")


def _parse_date_param(date_str: str) -> Optional[date]:
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except Exception:
        return None


def _build_month_daily_expense_series(month_start: str, month_end: str) -> List[Dict[str, Any]]:
    """自然月内每日支出（无则 0），用于统计柱状图。"""
    sparse = query_ledger_daily_expense_by_day(month_start, month_end)
    by_d = {
        str(x.get("date") or ""): {
            "expense_total": float(x.get("expense_total") or 0.0),
            "daily_expense_total": float(x.get("daily_expense_total") or 0.0),
        }
        for x in sparse
    }
    d0 = _parse_date_param(month_start)
    d1 = _parse_date_param(month_end)
    if not d0 or not d1:
        return []
    out: List[Dict[str, Any]] = []
    cur = d0
    while cur <= d1:
        ds = cur.strftime("%Y-%m-%d")
        row = by_d.get(ds) or {}
        out.append(
            {
                "date": ds,
                "expense_total": round(float(row.get("expense_total") or 0.0), 2),
                "daily_expense_total": round(float(row.get("daily_expense_total") or 0.0), 2),
            }
        )
        cur += timedelta(days=1)
    return out


def _build_week_daily_breakdown_series(base_date: date) -> List[Dict[str, Any]]:
    """自然周内逐日收入/日常支出/非日常支出。"""
    wmon = _ledger_start_of_week_monday(base_date)
    ws, _ = _ledger_week_range_from_monday(wmon)
    d0 = _parse_date_param(ws)
    if not d0:
        return []
    out: List[Dict[str, Any]] = []
    for i in range(7):
        d = d0 + timedelta(days=i)
        ds = d.strftime("%Y-%m-%d")
        totals = sum_ledger_between(ds, ds)
        breakdown = ledger_expense_breakdown_between(ds, ds)
        out.append(
            {
                "date": ds,
                "income_total": round(float(totals.get("income_total") or 0.0), 2),
                "daily_expense_total": round(float(totals.get("daily_expense_total") or 0.0), 2),
                "nondaily_expense_total": round(float(breakdown.get("expense_fixed_total") or 0.0), 2),
            }
        )
    return out


def _build_month_weekly_expense_series(base_date: date) -> List[Dict[str, Any]]:
    """自然月内按自然周汇总支出（包含跨月周）。"""
    ms, me = _month_date_range(base_date.year, base_date.month)
    d0 = _parse_date_param(ms)
    d1 = _parse_date_param(me)
    if not d0 or not d1:
        return []
    wk = _ledger_start_of_week_monday(d0)
    out: List[Dict[str, Any]] = []
    while wk <= d1:
        ws, we = _ledger_week_range_from_monday(wk)
        br = ledger_expense_breakdown_between(ws, we)
        expense_total = float(br.get("expense_total") or 0.0)
        daily_total = float(br.get("expense_daily_total") or 0.0)
        fixed_total = float(br.get("expense_fixed_total") or 0.0)
        out.append(
            {
                "week_start": ws,
                "week_end": we,
                "label": f"{ws.replace('-', '')}~{we.replace('-', '')}",
                "expense_total": round(expense_total, 2),
                "daily_expense_total": round(daily_total, 2),
                "nondaily_expense_total": round(fixed_total, 2),
            }
        )
        wk += timedelta(days=7)
    return out


def _load_global_todos_items() -> List[Dict[str, Any]]:
    """Prefer DB todos; fallback to app_state snapshot when DB empty."""
    try:
        db_items = get_all_todos()
    except Exception:
        db_items = []
    if db_items:
        return db_items
    raw = None
    try:
        raw = get_app_state(TODOS_STATE_KEY)
    except Exception:
        raw = None
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if not isinstance(parsed, dict):
        return []
    items = parsed.get("items") or []
    return items if isinstance(items, list) else []


def _filter_pending_todo_instances_vs_master(instances: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Calendar/API: omit instance rows still pending when master `todos` is already done."""
    try:
        masters = get_all_todos() or []
        done_ids = {
            str(it.get("id") or "").strip()
            for it in masters
            if str(it.get("status") or "").strip().lower() == "done"
        }
        out: List[Dict[str, Any]] = []
        for t in instances or []:
            if (t.get("status") or "pending") != "pending":
                continue
            sid = str(t.get("source_todo_id") or "").strip()
            if sid and sid in done_ids:
                continue
            out.append(t)
        return out
    except Exception:
        return [t for t in instances or [] if (t.get("status") or "pending") == "pending"]


def _sync_pending_todo_instances_missing_for_date(date_str: str) -> None:
    """
    For *today* only: ensure every pending master todo in todos has a todo_instances row
    for date_str (INSERT OR IGNORE). Fixes the case where instances were created earlier
    and new todos were added later — the old code returned early and never seeded again.
    """
    today_str = datetime.now().strftime("%Y-%m-%d")
    if date_str != today_str:
        return
    try:
        existing_rows = get_todo_instances_for_date(date_str)
    except Exception:
        existing_rows = []
    have_sources = {str(r.get("source_todo_id") or "").strip() for r in existing_rows if r.get("source_todo_id")}
    items = _load_global_todos_items()
    try:
        done_master_ids = {
            str(it.get("id") or "").strip()
            for it in (get_all_todos() or [])
            if str(it.get("status") or "").strip().lower() == "done"
        }
    except Exception:
        done_master_ids = set()
    for it in items or []:
        try:
            st = str(it.get("status") or "").strip().lower()
            if st not in ("pending", "todo"):
                continue
            source_id = str(it.get("id") or "").strip()
            content = str(it.get("content") or "").strip()
            if not source_id or not content:
                continue
            if source_id in done_master_ids:
                continue
            if source_id in have_sources:
                continue
            insert_todo_instance(
                source_todo_id=source_id,
                date=date_str,
                status="pending",
                complete_date="",
                content_snapshot=content,
            )
            have_sources.add(source_id)
        except Exception:
            continue


def _ensure_todo_instances_for_date(date_str: str) -> None:
    """
    Lazy create todo_instances for a date:
    - If already exists: do nothing (except *today* — then sync missing masters)
    - Else clone pending from previous date
    - If still empty: seed from global todos where status=pending
    """
    today_str = datetime.now().strftime("%Y-%m-%d")
    if date_str == today_str:
        try:
            heal_stale_pending_todo_instances_for_date(date_str)
        except Exception:
            pass

    existing = []
    try:
        existing = get_todo_instances_for_date(date_str)
    except Exception:
        existing = []
    if existing:
        if date_str == today_str:
            _sync_pending_todo_instances_missing_for_date(date_str)
        return

    d = _parse_date_param(date_str)
    if not d:
        return
    prev = (d - timedelta(days=1)).strftime("%Y-%m-%d")

    try:
        cloned = clone_pending_todo_instances(prev, date_str)
    except Exception:
        cloned = 0
    if cloned and cloned > 0:
        if date_str == today_str:
            _sync_pending_todo_instances_missing_for_date(date_str)
        return

    items = _load_global_todos_items()

    try:
        done_master_ids_seed = {
            str(it.get("id") or "").strip()
            for it in (get_all_todos() or [])
            if str(it.get("status") or "").strip().lower() == "done"
        }
    except Exception:
        done_master_ids_seed = set()

    # seed pending instances: only for today (historical days should not show pending)
    if date_str == today_str:
        for it in items or []:
            try:
                st = str(it.get("status") or "").strip().lower()
                # todos 页面历史状态：todo=未完成，done=已完成
                if st not in ("pending", "todo"):
                    continue
                source_id = str(it.get("id") or "").strip()
                content = str(it.get("content") or "").strip()
                if not source_id or not content:
                    continue
                if source_id in done_master_ids_seed:
                    continue
                insert_todo_instance(
                    source_todo_id=source_id,
                    date=date_str,
                    status="pending",
                    complete_date="",
                    content_snapshot=content,
                )
            except Exception:
                continue

    # seed historical done (completeDate matches this date) so that old completions show up
    date_slash = date_str.replace("-", "/")
    for it in items or []:
        try:
            if str(it.get("status") or "").strip().lower() != "done":
                continue
            source_id = str(it.get("id") or "").strip()
            content = str(it.get("content") or "").strip()
            cd = str(it.get("completeDate") or it.get("complete_date") or "").strip()
            if not source_id or not content or not cd:
                continue
            # accept both YYYY-MM-DD and YYYY/MM/DD
            if cd != date_str and cd != date_slash:
                continue
            insert_todo_instance(
                source_todo_id=source_id,
                date=date_str,
                status="done",
                complete_date=date_str,
                content_snapshot=content,
            )
        except Exception:
            continue

    if date_str == today_str:
        _sync_pending_todo_instances_missing_for_date(date_str)


@app.route("/api/calendar/summary", methods=["GET"])
def api_calendar_summary() -> Any:
    """
    Monthly calendar summary for新版日历.

    Query:
        month: 'YYYY-MM' (optional, default current month)

    Response:
        {
          "success": true,
          "year": 2026,
          "month": 4,
          "days": [
            {
              "date": "2026-04-01",
              "labels": [ { "name": "...", "addType": "custom" }, ... ],
              "checkin_completed_count": 2,
              "reminder_count": 1,
              "todo_pending_count": 3,
              "expense_total": 123.45,
              "income_total": 0.0,
              "has_diary": true
            },
            ...
          ]
        }
    """
    month_str = request.args.get("month")
    year, month = _parse_month_param(month_str)
    start_date, end_date = _month_date_range(year, month)

    try:
        purge_orphan_todo_instances()
    except Exception:
        pass

    checkin_state = _load_checkin_state()
    events: List[Dict[str, Any]] = list(checkin_state.get("events") or [])
    records: List[Dict[str, Any]] = list(checkin_state.get("records") or [])
    date_labels: Dict[str, Any] = checkin_state.get("dateLabels") or {"specific": {}, "annual": {}}

    # Index events by id and type
    event_by_id: Dict[str, Dict[str, Any]] = {}
    for evt in events:
        eid = str(evt.get("id") or "")
        if not eid:
            continue
        event_by_id[eid] = evt

    def _date_in_range(d: str, start: str, end: str) -> bool:
        if not d:
            return False
        if start and d < start:
            return False
        if end and d > end:
            return False
        return True

    def _checkin_active(evt: Dict[str, Any], d: str) -> bool:
        start = str(evt.get("dateStart") or "")
        end = str(evt.get("dateEnd") or "")
        return _date_in_range(d, start or "0000-01-01", end or "9999-12-31")

    def _reminder_matches_date(evt: Dict[str, Any], d: str) -> bool:
        date_type = str(evt.get("dateType") or "specific")
        if date_type == "specific":
            return str(evt.get("specificDate") or "") == d
        if date_type == "monthly":
            try:
                day = int(d.split("-")[2])
            except Exception:
                return False
            try:
                dom = int(evt.get("dayOfMonth") or 0)
            except Exception:
                dom = 0
            if dom <= 0 or day != dom:
                return False
            start = str(evt.get("monthlyStartDate") or "") or "0000-01-01"
            end = str(evt.get("monthlyEndDate") or "") or "9999-12-31"
            return _date_in_range(d, start, end)
        return False

    # Group records by date
    records_by_date: Dict[str, List[Dict[str, Any]]] = {}
    for rec in records:
        d = str(rec.get("date") or "")
        if not d:
            continue
        records_by_date.setdefault(d, []).append(rec)

    # Preload ledger and diary information for the month
    try:
        month_ledger = query_ledger_entries_between(start_date, end_date)
    except Exception:
        month_ledger = []
    ledger_by_date: Dict[str, Dict[str, float]] = {}
    for row in month_ledger:
        d = row.get("date")
        if not d:
            continue
        kind = row.get("kind") or ""
        amt = float(row.get("amount") or 0.0)
        agg = ledger_by_date.setdefault(d, {"income_total": 0.0, "expense_total": 0.0})
        if kind == "income":
            agg["income_total"] += amt
        elif kind == "expense":
            agg["expense_total"] += amt

    try:
        diaries_meta = list_diaries_between(start_date, end_date)
    except Exception:
        diaries_meta = []
    diary_dates = {row.get("date") for row in diaries_meta if row.get("date")}
    try:
        content_agg_by_date = get_content_calendar_aggregates(start_date, end_date)
    except Exception:
        content_agg_by_date = {}

    # Todo instances for month (only need pending count per day)
    # For simplicity and small scale, query per day when building days list.

    # Helper to compute labels for a date (subset of JS getLabelsForDate，简化版）
    def _labels_for_date(date_str: str) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        labels = date_labels or {"specific": {}, "annual": {}}
        specific = (labels.get("specific") or {}).get(date_str)
        if isinstance(specific, list):
            out.extend([x for x in specific if x and x.get("name")])
        elif specific:
            out.append({"name": str(specific), "addType": "custom"})
        # annual: 只做最常见路径（精简版），不处理“月底溢出”场景
        try:
            y_str, m_str, d_str = date_str.split("-")
            mmdd = f"{m_str}-{d_str}"
        except Exception:
            mmdd = ""
        if mmdd:
            annual = (labels.get("annual") or {}).get(mmdd)
            if isinstance(annual, list):
                out.extend([x for x in annual if x and x.get("name")])
            elif annual:
                item = annual if isinstance(annual, dict) else {"name": str(annual), "addType": "custom"}
                out.append(item)
        # 去重
        seen = set()
        uniq: List[Dict[str, Any]] = []
        for item in out:
            name = str(item.get("name") or "")
            if not name or name in seen:
                continue
            seen.add(name)
            uniq.append({"name": name, "addType": item.get("addType") or "custom"})
        return uniq

    days: List[Dict[str, Any]] = []
    cur = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()
    today_str = datetime.now().strftime("%Y-%m-%d")
    while cur <= end:
        d_str = cur.strftime("%Y-%m-%d")
        # Records for date
        recs = records_by_date.get(d_str, [])
        checkin_completed = 0
        checkin_colors: List[str] = []
        reminder_items: List[Dict[str, Any]] = []
        for rec in recs:
            eid = str(rec.get("eventId") or "")
            evt = event_by_id.get(eid)
            if not evt:
                continue
            etype = evt.get("type") or "checkin"
            if etype == "checkin":
                if _checkin_active(evt, d_str):
                    checkin_completed += 1
                    c = str(evt.get("color") or "").strip()
                    if c:
                        checkin_colors.append(c)

        # Scheduled reminders for this date (show on calendar even if not completed)
        completed_ids = {str(r.get("eventId") or "") for r in recs}
        for evt in events:
            if (evt.get("type") or "checkin") != "reminder":
                continue
            if not _reminder_matches_date(evt, d_str):
                continue
            eid = str(evt.get("id") or "")
            reminder_items.append(
                {
                    "id": eid,
                    "name": str(evt.get("name") or ""),
                    "reminderType": str(evt.get("reminderType") or "normal"),
                    "completed": eid in completed_ids,
                }
            )

        # Todo pending count
        if d_str == today_str:
            try:
                _ensure_todo_instances_for_date(d_str)
                instances = get_todo_instances_for_date(d_str)
                todo_pending = len(_filter_pending_todo_instances_vs_master(instances))
            except Exception:
                todo_pending = 0
        else:
            todo_pending = 0

        ledger_agg = ledger_by_date.get(d_str, {"income_total": 0.0, "expense_total": 0.0})
        content_agg = content_agg_by_date.get(d_str, {"watch_count": 0, "book_count": 0})

        days.append(
            {
                "date": d_str,
                "labels": _labels_for_date(d_str),
                "checkin_completed_count": checkin_completed,
                "checkin_completed_colors": checkin_colors,
                "reminders": reminder_items,
                "reminder_count": len(reminder_items),
                "todo_pending_count": todo_pending,
                "expense_total": round(float(ledger_agg.get("expense_total") or 0.0), 2),
                "income_total": round(float(ledger_agg.get("income_total") or 0.0), 2),
                "has_diary": d_str in diary_dates,
                "hasDiary": d_str in diary_dates,
                "watch_count": int(content_agg.get("watch_count") or 0),
                "book_count": int(content_agg.get("book_count") or 0),
            }
        )
        cur += timedelta(days=1)

    return jsonify({"success": True, "year": year, "month": month, "days": days})


@app.route("/api/calendar/day", methods=["GET"])
def api_calendar_day() -> Any:
    """
    Per-day detail for新版日历抽屉.

    Query:
        date: 'YYYY-MM-DD'（必填）
    """
    date_str = (request.args.get("date") or "").strip()
    if not date_str:
        return jsonify({"success": False, "message": "缺少参数 date"}), 400
    d_obj = _parse_date_param(date_str)
    if not d_obj:
        return jsonify({"success": False, "message": "参数 date 格式错误，需 YYYY-MM-DD"}), 400

    checkin_state = _load_checkin_state()
    events: List[Dict[str, Any]] = list(checkin_state.get("events") or [])
    records: List[Dict[str, Any]] = list(checkin_state.get("records") or [])
    date_labels: Dict[str, Any] = checkin_state.get("dateLabels") or {"specific": {}, "annual": {}}

    # 打卡/提醒事件：按当天是否生效筛选并附加完成态
    today_records_ids = {str(r.get("eventId") or "") for r in records if (r.get("date") or "") == date_str}
    checkin_events: List[Dict[str, Any]] = []
    reminder_events: List[Dict[str, Any]] = []

    def _date_in_range(d: str, start: str, end: str) -> bool:
        if not d:
            return False
        if start and d < start:
            return False
        if end and d > end:
            return False
        return True

    def _reminder_matches_date(evt: Dict[str, Any], d: str) -> bool:
        date_type = str(evt.get("dateType") or "specific")
        if date_type == "specific":
            return str(evt.get("specificDate") or "") == d
        if date_type == "monthly":
            # day-of-month match + validity range
            try:
                day = int(d.split("-")[2])
            except Exception:
                return False
            try:
                dom = int(evt.get("dayOfMonth") or 0)
            except Exception:
                dom = 0
            if dom <= 0 or day != dom:
                return False
            start = str(evt.get("monthlyStartDate") or "")
            end = str(evt.get("monthlyEndDate") or "")
            # if empty, treat as always valid
            start = start or "0000-01-01"
            end = end or "9999-12-31"
            return _date_in_range(d, start, end)
        return False
    for evt in events:
        etype = evt.get("type") or "checkin"
        eid = str(evt.get("id") or "")
        if not eid:
            continue
        # 打卡：按生效区间过滤（dateStart/dateEnd）
        if etype == "checkin":
            start = str(evt.get("dateStart") or "")
            end = str(evt.get("dateEnd") or "")
            if start or end:
                if not _date_in_range(date_str, start or "0000-01-01", end or "9999-12-31"):
                    continue
        # 提醒：只返回当天需要展示的提醒（按 specific/monthly 规则）
        if etype == "reminder":
            if not _reminder_matches_date(evt, date_str):
                continue

        item = {
            "id": eid,
            "name": evt.get("name") or "",
            "color": evt.get("color") or "",
            "completed": eid in today_records_ids,
            "raw": evt,
        }
        if etype == "checkin":
            checkin_events.append(item)
        elif etype == "reminder":
            reminder_events.append(item)

    # 日期标签：返回手动标签（specific/annual）+ 同步标签（addType=sync）
    def _labels_for_date(d: str) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        if not d:
            return out
        labels = date_labels or {"specific": {}, "annual": {}}
        specific = (labels.get("specific") or {}).get(d)
        if isinstance(specific, list):
            out.extend([x for x in specific if x and x.get("name")])
        elif specific:
            out.append({"name": str(specific), "addType": "custom"})
        # annual
        try:
            _, mm, dd = d.split("-")
            mmdd = f"{mm}-{dd}"
        except Exception:
            mmdd = ""
        if mmdd:
            annual = (labels.get("annual") or {}).get(mmdd)
            # respect annualStartDate/annualEndDate if present
            def _annual_in_range(item: Any) -> bool:
                if not isinstance(item, dict):
                    return True
                start = str(item.get("annualStartDate") or "0000-01-01")
                end = str(item.get("annualEndDate") or "9999-12-31")
                return _date_in_range(d, start, end)

            if isinstance(annual, list):
                out.extend([x for x in annual if x and x.get("name") and _annual_in_range(x)])
            elif annual:
                item = annual if isinstance(annual, dict) else {"name": str(annual), "addType": "custom"}
                if item.get("name") and _annual_in_range(item):
                    out.append(item)
        # normalize + dedupe by name
        seen = set()
        uniq: List[Dict[str, Any]] = []
        for it in out:
            name = str((it or {}).get("name") or "").strip()
            if not name or name in seen:
                continue
            seen.add(name)
            uniq.append({"name": name, "addType": str((it or {}).get("addType") or "custom")})
        return uniq

    labels = _labels_for_date(date_str)

    # 日记
    try:
        diary = get_diary(date_str)
    except Exception:
        diary = None

    # 记账：当天流水及合计
    try:
        entries = [
            row
            for row in query_ledger_entries_between(date_str, date_str)
            if row.get("date") == date_str
        ]
        totals = sum_ledger_between(date_str, date_str)
    except Exception:
        entries = []
        totals = {"income_total": 0.0, "expense_total": 0.0, "daily_expense_total": 0.0}
    try:
        content_items, _ = query_content_records(
            submit_start=date_str,
            submit_end=date_str,
            page_size=0,
        )
    except Exception:
        content_items = []

    # 待办实例：懒迁移 + 规则过滤
    # 规则：
    # - 待办事项：展示该日期下所有未完成（date=当天, status=pending）
    # - 已完成待办：展示完成日期为当天（complete_date=当天, status=done），不要求 date 等于当天
    try:
        today_obj = datetime.now().date()
        if d_obj == today_obj:
            _ensure_todo_instances_for_date(date_str)
            pending_instances = _filter_pending_todo_instances_vs_master(get_todo_instances_for_date(date_str))
        else:
            # 非当天不展示未完成待办
            _ensure_todo_instances_for_date(date_str)  # 仅用于回填历史已完成（complete_date），pending 不会生成
            pending_instances = []
        done_instances = get_todo_instances_completed_on(date_str)
    except Exception:
        pending_instances = []
        done_instances = []

    return jsonify(
        {
            "success": True,
            "date": date_str,
            # 与 todos_pending 是否返回保持一致，避免前端用本地日期判断「今天」与后端不一致
            "server_today": datetime.now().strftime("%Y-%m-%d"),
            "labels": labels,
            "checkins": checkin_events,
            "reminders": reminder_events,
            "diary": diary,
            "ledger": {
                "entries": entries,
                "income_total": round(float(totals.get("income_total") or 0.0), 2),
                "expense_total": round(float(totals.get("expense_total") or 0.0), 2),
            },
            "content_items": content_items,
            "todos_pending": pending_instances,
            "todos_done": done_instances,
        }
    )


@app.route("/api/todo-instances/<int:instance_id>/status", methods=["POST"])
def api_todo_instance_set_status(instance_id: int) -> Any:
    """
    Set todo_instance status.

    JSON body:
      { "status": "done" | "pending" }
    """
    body = request.get_json(silent=True) or {}
    status = str(body.get("status") or "").strip()
    if status not in ("done", "pending"):
        return jsonify({"success": False, "message": "status 仅支持 done / pending"}), 400
    complete_date = str(body.get("complete_date") or "").strip()
    try:
        ok = update_todo_instance_status(instance_id, status, complete_date=complete_date)
        if not ok:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"更新失败：{exc}"}), 500


def _parse_ip_monitor_date(s: str) -> Optional[date]:
    try:
        return datetime.strptime((s or "").strip()[:10], "%Y-%m-%d").date()
    except Exception:
        return None


@app.route("/ip-monitor")
def ip_monitor_page() -> str:
    """IP monitoring page with date/IP filters and pagination."""
    today = date.today()
    default_start = today - timedelta(days=7)
    default_end = today

    raw_start = (request.args.get("start") or "").strip()
    raw_end = (request.args.get("end") or "").strip()
    sd = _parse_ip_monitor_date(raw_start) if raw_start else default_start
    ed = _parse_ip_monitor_date(raw_end) if raw_end else default_end
    if sd is None:
        sd = default_start
    if ed is None:
        ed = default_end
    if sd > ed:
        sd, ed = ed, sd

    start_date_str = sd.isoformat()
    end_date_str = ed.isoformat()
    start_ts = f"{start_date_str} 00:00:00"
    end_ts = f"{end_date_str} 23:59:59"

    ip_options: List[str] = []
    try:
        ip_options = list_distinct_ips_in_log_range(start_ts, end_ts)
    except Exception:
        ip_options = []

    ip_filter = (request.args.get("ip") or "").strip()
    if not ip_options:
        ip_filter = ""
    elif ip_filter and ip_filter not in ip_options:
        ip_filter = ""

    page = int(request.args.get("page", 1) or 1)
    per_page = 20
    total = 0
    try:
        total = count_ip_access_logs_filtered(start_ts, end_ts, ip_filter or None)
    except Exception:
        total = 0
    total_pages = max(1, int(ceil(total / float(per_page))) if per_page > 0 else 1)
    page = max(1, min(page, total_pages))
    offset = (page - 1) * per_page
    logs: List[Dict[str, Any]] = []
    try:
        logs = get_ip_access_logs_filtered(per_page, offset, start_ts, end_ts, ip_filter or None)
    except Exception:
        logs = []

    qp: List[Tuple[str, str]] = [("start", start_date_str), ("end", end_date_str)]
    if ip_filter:
        qp.append(("ip", ip_filter))
    filter_qs = urlencode(qp)

    return render_template(
        "ip_monitor.html",
        logs=logs,
        total=total,
        page=page,
        total_pages=total_pages,
        per_page=per_page,
        start_date=start_date_str,
        end_date=end_date_str,
        ip_filter=ip_filter,
        ip_options=ip_options,
        filter_qs=filter_qs,
    )


@app.route("/ledger")
def ledger_page() -> str:
    """Ledger placeholder page."""
    return render_template("ledger.html")


@app.route("/content")
def content_page() -> str:
    """光影文卷页面。"""
    return render_template("content.html")


@app.route("/people")
def people_library_page() -> str:
    """人物库：追剧/读书人物卡片与关联作品。"""
    return render_template("people.html")


@app.route("/local-services")
def local_services_dashboard() -> Any:
    """本机服务面板（可选：项目根目录 local-services-dashboard.html）。"""
    path = Path(__file__).resolve().parent / "local-services-dashboard.html"
    if path.is_file():
        return send_file(path, mimetype="text/html; charset=utf-8")
    html = (
        "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"/>"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>"
        "<title>本机服务面板</title></head><body style=\"font-family:system-ui;padding:24px;\">"
        "<h1>本机服务面板</h1>"
        "<p>未找到 <code>local-services-dashboard.html</code>（应放在项目根目录与 <code>app.py</code> 同级）。</p>"
        "<p><a href=\"/home\">返回首页</a></p></body></html>"
    )
    return Response(html, mimetype="text/html; charset=utf-8")


def _ledger_kind_normalize(kind: str) -> str:
    k = str(kind or "").strip().lower()
    return k if k in ("income", "expense") else ""


def _ledger_retention_start_iso() -> str:
    return ledger_retention_month_start_iso()


def _ledger_server_date_iso() -> str:
    return date.today().strftime("%Y-%m-%d")


def _ledger_clamp_main_query_dates(start_date: str, end_date: str) -> Tuple[str, str, Optional[str]]:
    """将查询区间限制在 [保留下限, 今天]；返回 (start, end, format_error)。
    与保留区间无交集时 s > e，调用方按空结果处理（不视为格式错误）。"""
    sd = _parse_date_param(str(start_date or "").strip())
    ed = _parse_date_param(str(end_date or "").strip())
    if not sd or not ed:
        return "", "", "日期格式错误，需 YYYY-MM-DD"
    s = sd.strftime("%Y-%m-%d")
    e = ed.strftime("%Y-%m-%d")
    if s > e:
        s, e = e, s
    cut = _ledger_retention_start_iso()
    today_s = _ledger_server_date_iso()
    if e > today_s:
        e = today_s
    if s < cut:
        s = cut
    return s, e, None


def _ledger_entry_date_allowed(date_str: str) -> Optional[str]:
    """POST/PUT 发生日期校验；通过返回 None。"""
    ds = str(date_str or "").strip()
    d = _parse_date_param(ds)
    if not d:
        return "参数错误：date 格式需 YYYY-MM-DD"
    cut_d = _parse_date_param(_ledger_retention_start_iso())
    if cut_d and d < cut_d:
        return "发生日期不可早于系统保留区间（最近12个自然月）"
    if d > date.today():
        return "发生日期不能晚于今天"
    return None


def _ledger_archive_export_clamp(start_date: str, end_date: str) -> Tuple[str, str, Optional[str]]:
    sd = _parse_date_param(str(start_date or "").strip())
    ed = _parse_date_param(str(end_date or "").strip())
    if not sd or not ed:
        return "", "", "日期格式错误，需 YYYY-MM-DD"
    s = sd.strftime("%Y-%m-%d")
    e = ed.strftime("%Y-%m-%d")
    if s > e:
        s, e = e, s
    today_s = _ledger_server_date_iso()
    if e > today_s:
        e = today_s
    return s, e, None


def _ledger_row_csv_cells(row: Dict[str, Any]) -> List[str]:
    kind = str(row.get("kind") or "")
    is_income = kind == "income"
    type_text = "收入" if is_income else "支出"
    nature_raw = str(row.get("expense_nature") or "").lower()
    nature_text = "—" if is_income else ("固定" if nature_raw == "fixed" else "日常")
    amt = float(row.get("amount") or 0.0)
    return [
        str(row.get("date") or ""),
        type_text,
        nature_text,
        str(row.get("tag_name") or "").strip() or "未命名",
        str(row.get("description") or "").strip() or "（无明细）",
        str(row.get("annotation") or "").strip(),
        f"{amt:.2f}",
    ]


def _ledger_csv_response(rows: List[Dict[str, Any]], filename: str) -> Response:
    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf)
    writer.writerow(["发生日期", "类型", "支出性质", "标签", "明细", "批注", "金额"])
    for row in rows:
        writer.writerow(_ledger_row_csv_cells(row))
    payload = buf.getvalue().encode("utf-8")
    return Response(
        payload,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _ledger_parse_amount(raw: Any) -> Optional[float]:
    try:
        v = float(raw)
    except Exception:
        return None
    if v <= 0:
        return None
    # store as positive number; UI controls sign by kind
    return round(abs(v), 2)


def _ledger_parse_entry_text_fields(body: Dict[str, Any]) -> Tuple[str, str, Optional[str]]:
    """
    Parse and validate ledger entry text fields.

    Returns (description, annotation, error_message).
    """
    desc = str(body.get("description") or "").strip()
    ann_raw = body.get("annotation")
    if ann_raw is None:
        ann_raw = body.get("批注")
    ann = str(ann_raw or "").strip()
    if not desc:
        return "", "", "请填写明细"
    if len(desc) > 200:
        return "", "", "明细不能超过200字"
    if len(ann) > 30:
        return "", "", "批注不能超过30字"
    return desc, ann, None


def _ledger_scope_normalize(raw: Any) -> str:
    s = str(raw or "").strip().lower()
    return s if s in ("week", "month") else ""


def _ledger_start_of_week_monday(d: date) -> date:
    wd = d.weekday()
    return d - timedelta(days=wd)


def _ledger_week_range_from_monday(monday: date) -> Tuple[str, str]:
    end = monday + timedelta(days=6)
    return monday.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def _ledger_period_dates(scope: str, period_start: str) -> Optional[Tuple[str, str]]:
    d = _parse_date_param(str(period_start or "").strip())
    if not d:
        return None
    if scope == "month":
        if d.day != 1:
            return None
        return _month_date_range(d.year, d.month)
    if scope == "week":
        if d.weekday() != 0:
            return None
        return _ledger_week_range_from_monday(d)
    return None


def _ledger_period_not_future(scope: str, period_start: str) -> bool:
    today = date.today()
    d = _parse_date_param(str(period_start or "").strip())
    if not d:
        return False
    if scope == "month":
        if d.day != 1:
            return False
        return (d.year, d.month) <= (today.year, today.month)
    if scope == "week":
        if d.weekday() != 0:
            return False
        cur_mon = _ledger_start_of_week_monday(today)
        return d <= cur_mon
    return False


def _ledger_period_label(scope: str, start_s: str, end_s: str) -> str:
    sd = _parse_date_param(start_s)
    ed = _parse_date_param(end_s)
    if not sd or not ed:
        return ""
    if scope == "month":
        return f"{sd.year}年{sd.month}月"

    def _fmt_dot(d0: date) -> str:
        return f"{d0.year}.{d0.month:02d}.{d0.day:02d}"

    return f"周一 {_fmt_dot(sd)} ~ 周日 {_fmt_dot(ed)}"


def _ledger_triple_totals(start_s: str, end_s: str) -> Dict[str, Any]:
    """收入 / 总支出 / 日常性质支出（与记账列表合计口径一致）。"""
    t = sum_ledger_between(start_s, end_s)
    return {
        "income_total": round(float(t.get("income_total") or 0.0), 2),
        "expense_total": round(float(t.get("expense_total") or 0.0), 2),
        "daily_expense_total": round(float(t.get("daily_expense_total") or 0.0), 2),
    }


def _ledger_gauge_block(scope: str, anchor: date) -> Dict[str, Any]:
    """支出预算占比：日常类支出（非固定）/ 周期预算。anchor 为当周周一或当月 1 号。"""
    ps = anchor.strftime("%Y-%m-%d")
    prange = _ledger_period_dates(scope, ps)
    if not prange:
        return {
            "scope": scope,
            "period_start": ps,
            "period_label": "",
            "start_date": "",
            "end_date": "",
            "daily_budget": None,
            "budget_ratio_percent": None,
            "expense_daily_for_budget": 0.0,
        }
    start_s, end_s = prange
    br = ledger_expense_breakdown_between(start_s, end_s)
    resolved = resolve_ledger_budget_amount(scope, start_s, end_s)
    daily_spent = float(br.get("expense_daily_total") or 0.0)
    ratio_pct: Optional[float] = None
    if resolved is not None and resolved > 0:
        ratio_pct = round((daily_spent / resolved) * 100.0, 1)
    return {
        "scope": scope,
        "period_start": ps,
        "start_date": start_s,
        "end_date": end_s,
        "period_label": _ledger_period_label(scope, start_s, end_s),
        "daily_budget": round(float(resolved), 2) if resolved is not None else None,
        "expense_daily_for_budget": round(daily_spent, 2),
        "budget_ratio_percent": ratio_pct,
    }


def _ledger_expense_nature_for_kind(kind: str, body: Dict[str, Any]) -> Tuple[str, Optional[str]]:
    if kind == "income":
        return "", None
    raw = str(body.get("expense_nature") or "").strip().lower()
    if raw not in ("fixed", "daily"):
        return "", "参数错误：支出需选择支出性质（fixed=固定 / daily=日常）"
    return raw, None


def _ledger_parse_budget_amount(raw: Any) -> Optional[float]:
    try:
        v = float(raw)
    except Exception:
        return None
    if v < 0:
        return None
    return round(abs(v), 2)


def _ledger_policy_range_validate(range_start: str, range_end: str) -> Optional[str]:
    rs = _parse_date_param(str(range_start or "").strip())
    re_ = _parse_date_param(str(range_end or "").strip())
    if not rs or not re_:
        return "预算起止日期格式需为 YYYY-MM-DD"
    if rs > re_:
        return "预算开始日期不能晚于结束日期"
    return None


def _enumerate_week_budget_lines(range_start_d: date, range_end_d: date, amount: float) -> List[Dict[str, Any]]:
    """Each calendar week (Mon–Sun) that intersects [range_start_d, range_end_d] gets the same budget amount."""
    d0 = _ledger_start_of_week_monday(range_start_d)
    d1 = _ledger_start_of_week_monday(range_end_d)
    lines: List[Dict[str, Any]] = []
    cur = d0
    while cur <= d1:
        ps = cur.strftime("%Y-%m-%d")
        pe = (cur + timedelta(days=6)).strftime("%Y-%m-%d")
        label = _ledger_period_label("week", ps, pe)
        lines.append(
            {
                "period_start": ps,
                "period_end": pe,
                "period_label": label,
                "amount": round(float(amount), 2),
            }
        )
        cur += timedelta(days=7)
    return lines


def _enumerate_month_budget_lines(range_start_d: date, range_end_d: date, amount: float) -> List[Dict[str, Any]]:
    """Each calendar month that intersects [range_start_d, range_end_d] gets the same budget amount."""
    y, m = range_start_d.year, range_start_d.month
    y_end, m_end = range_end_d.year, range_end_d.month
    lines: List[Dict[str, Any]] = []
    while y < y_end or (y == y_end and m <= m_end):
        ps, pe = _month_date_range(y, m)
        label = _ledger_period_label("month", ps, pe)
        lines.append(
            {
                "period_start": ps,
                "period_end": pe,
                "period_label": label,
                "amount": round(float(amount), 2),
            }
        )
        if m == 12:
            y += 1
            m = 1
        else:
            m += 1
    return lines


def _content_record_type_normalize(raw: Any) -> str:
    x = str(raw or "").strip().lower()
    return x if x in ("watch", "book") else ""


def _content_list_status_normalize(raw: Any) -> str:
    x = str(raw or "").strip().lower()
    return x if x in ("done", "wishlist") else ""


def _content_tag_record_type_normalize(raw: Any) -> str:
    x = str(raw or "").strip().lower()
    return x if x in ("watch", "book", "all") else ""


def _parse_rating(raw: Any) -> int:
    try:
        n = int(raw)
    except Exception:
        return -1
    if 0 <= n <= 5:
        return n
    return -1


@app.route("/api/ledger/meta", methods=["GET"])
def api_ledger_meta() -> Any:
    """记账保留策略：热库仅最近12个自然月；供前端限制日期控件。"""
    return jsonify(
        {
            "success": True,
            "retention_start_date": _ledger_retention_start_iso(),
            "server_date": _ledger_server_date_iso(),
        }
    )


@app.route("/api/ledger/export.csv", methods=["GET"])
def api_ledger_export_csv() -> Any:
    """导出当前热库区间流水，表头与记账列表一致（无「操作」列）。"""
    start_date = str(request.args.get("start_date") or "").strip()
    end_date = str(request.args.get("end_date") or "").strip()
    if not start_date or not end_date:
        return jsonify({"success": False, "message": "缺少参数 start_date / end_date"}), 400
    s, e, fmt_err = _ledger_clamp_main_query_dates(start_date, end_date)
    if fmt_err:
        return jsonify({"success": False, "message": fmt_err}), 400
    try:
        rows = query_ledger_entries_between(s, e) if s <= e else []
        fn = f"ledger_{s}_{e}.csv"
        return _ledger_csv_response(rows, fn)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"导出失败：{exc}"}), 500


@app.route("/api/ledger/archive/export.csv", methods=["GET"])
def api_ledger_archive_export_csv() -> Any:
    """导出归档表流水（早于热库保留下限的历史），表头与记账列表一致。"""
    start_date = str(request.args.get("start_date") or "").strip()
    end_date = str(request.args.get("end_date") or "").strip()
    if not start_date or not end_date:
        return jsonify({"success": False, "message": "缺少参数 start_date / end_date"}), 400
    s, e, fmt_err = _ledger_archive_export_clamp(start_date, end_date)
    if fmt_err:
        return jsonify({"success": False, "message": fmt_err}), 400
    try:
        rows = query_ledger_entries_archive_between(s, e) if s <= e else []
        fn = f"ledger_archive_{s}_{e}.csv"
        return _ledger_csv_response(rows, fn)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"导出失败：{exc}"}), 500


@app.route("/api/ledger/tags", methods=["GET"])
def api_ledger_tags_list() -> Any:
    """
    List ledger tags.

    Query:
      kind: income | expense (optional)
    """
    kind = _ledger_kind_normalize(request.args.get("kind") or "")
    try:
        if kind:
            items = get_ledger_tags(kind)
        else:
            items = list(get_ledger_tags("expense") or []) + list(get_ledger_tags("income") or [])
        return jsonify({"success": True, "items": items})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取标签失败：{exc}"}), 500


@app.route("/api/ledger/tags", methods=["POST"])
def api_ledger_tags_add() -> Any:
    """
    Add ledger tag.

    JSON:
      { "kind": "income"|"expense", "name": "xxx" }
    """
    body = request.get_json(silent=True) or {}
    kind = _ledger_kind_normalize(body.get("kind") or "")
    name = str(body.get("name") or "").strip()
    if not kind or not name:
        return jsonify({"success": False, "message": "参数错误：kind / name 必填"}), 400
    try:
        tag_id = add_ledger_tag(kind, name)
        return jsonify({"success": True, "id": tag_id})
    except Exception as exc:  # pylint: disable=broad-except
        msg = str(exc)
        if "UNIQUE constraint failed" in msg:
            return jsonify({"success": False, "message": "该类型下标签名称已存在"}), 400
        return jsonify({"success": False, "message": f"新增标签失败：{exc}"}), 500


@app.route("/api/ledger/tags/<int:tag_id>", methods=["PUT"])
def api_ledger_tags_rename(tag_id: int) -> Any:
    """
    Rename ledger tag.

    JSON:
      { "name": "new name" }
    """
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "message": "参数错误：name 必填"}), 400
    try:
        ok = rename_ledger_tag(tag_id, name)
        if not ok:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        msg = str(exc)
        if "UNIQUE constraint failed" in msg:
            return jsonify({"success": False, "message": "该类型下标签名称已存在"}), 400
        return jsonify({"success": False, "message": f"重命名失败：{exc}"}), 500


@app.route("/api/ledger/tags/<int:tag_id>", methods=["DELETE"])
def api_ledger_tags_delete(tag_id: int) -> Any:
    """Delete ledger tag if unused; otherwise returns 400."""
    try:
        ok = delete_ledger_tag_if_unused(tag_id)
        if not ok:
            return jsonify({"success": False, "message": "该标签已被记账记录引用，无法删除"}), 400
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"删除失败：{exc}"}), 500


@app.route("/api/content/tags", methods=["GET"])
def api_content_tags_list() -> Any:
    """List content tags, optionally filtered by record_type."""
    rt = _content_tag_record_type_normalize(request.args.get("record_type") or "") or "all"
    try:
        items = get_content_tags(rt)
        return jsonify({"success": True, "items": items})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取标签失败：{exc}"}), 500


@app.route("/api/content/tags", methods=["POST"])
def api_content_tags_add() -> Any:
    """Add one content tag."""
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    rt = _content_tag_record_type_normalize(body.get("record_type") or "") or "all"
    if not name:
        return jsonify({"success": False, "message": "参数错误：name 必填"}), 400
    try:
        tag_id = add_content_tag(name, rt)
        return jsonify({"success": True, "id": tag_id})
    except Exception as exc:  # pylint: disable=broad-except
        msg = str(exc)
        if "UNIQUE constraint failed" in msg:
            return jsonify({"success": False, "message": "标签已存在"}), 400
        return jsonify({"success": False, "message": f"新增标签失败：{exc}"}), 500


@app.route("/api/content/tags/<int:tag_id>", methods=["PUT"])
def api_content_tags_rename(tag_id: int) -> Any:
    """Update one content tag (name and/or 追剧/读书适用范围)."""
    body = request.get_json(silent=True) or {}
    raw_name = body.get("name")
    raw_rt = body.get("record_type")
    name: Optional[str] = None
    record_type: Optional[str] = None
    if raw_name is not None:
        name = str(raw_name or "").strip()
        if not name:
            return jsonify({"success": False, "message": "参数错误：name 不能为空"}), 400
    if raw_rt is not None:
        record_type = _content_tag_record_type_normalize(raw_rt) or str(raw_rt or "").strip().lower()
        if record_type not in ("watch", "book", "all"):
            return jsonify({"success": False, "message": "参数错误：record_type 须为 watch / book / all"}), 400
    if name is None and record_type is None:
        return jsonify({"success": False, "message": "参数错误：请提供 name 或 record_type"}), 400
    try:
        ok = update_content_tag(tag_id, name=name, record_type=record_type)
        if not ok:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True})
    except sqlite3.IntegrityError:
        return jsonify({"success": False, "message": "标签已存在"}), 400
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"更新失败：{exc}"}), 500


@app.route("/api/content/tags/<int:tag_id>", methods=["DELETE"])
def api_content_tags_delete(tag_id: int) -> Any:
    """Delete content tag when unused."""
    try:
        ok = delete_content_tag_if_unused(tag_id)
        if not ok:
            return jsonify({"success": False, "message": "该标签已被记录引用，无法删除"}), 400
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"删除失败：{exc}"}), 500


def _content_cover_upload_dir() -> Path:
    p = Path(app.root_path) / "static" / "uploads" / "content_covers"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _detect_uploaded_image_ext(header: bytes) -> Optional[str]:
    if len(header) < 12:
        return None
    if header[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if header[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if header[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return ".webp"
    return None


def _normalize_content_cover_url(raw: str) -> str:
    s = str(raw or "").strip()[:800]
    if not s:
        return ""
    prefix = "/static/uploads/content_covers/"
    if not s.startswith(prefix):
        return ""
    rest = s[len(prefix) :]
    if not rest or "/" in rest or ".." in rest:
        return ""
    if not re.match(r"^[a-fA-F0-9]{32}\.(jpg|jpeg|png|gif|webp)$", rest, re.IGNORECASE):
        return ""
    return prefix + rest


def _parse_content_record_payload(body: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    rt = _content_record_type_normalize(body.get("record_type") or "")
    if not rt:
        return None, "参数错误：record_type 仅支持 watch / book"
    submit_date = str(body.get("submit_date") or "").strip()
    if not submit_date or not _parse_date_param(submit_date):
        return None, "参数错误：标记日期格式需 YYYY-MM-DD"
    title = str(body.get("title") or "").strip()
    if not title:
        return None, "参数错误：title 必填"
    rating = _parse_rating(body.get("rating"))
    if rating < 0:
        return None, "参数错误：rating 需在 0-5 之间"
    category = str(body.get("category") or "").strip()
    if rt == "watch":
        fixed_categories = {"长剧", "短剧", "电影", "TV动画", "剧场动画", "AI漫剧"}
        if category not in fixed_categories:
            return None, "参数错误：category 仅支持 长剧/短剧/电影/TV动画/剧场动画/AI漫剧"
    elif rt == "book":
        if category and category not in {"书籍"}:
            return None, "参数错误：读书 category 仅支持 书籍"
    ls = _content_list_status_normalize(body.get("list_status"))
    if not ls:
        ls = "done"
    episode_count = str(body.get("episode_count") or "").strip()[:200]
    payload = {
        "record_type": rt,
        "submit_date": submit_date,
        "title": title,
        "creator": str(body.get("creator") or "").strip(),
        "category": category,
        "rating": rating,
        "episode_count": episode_count,
        "summary": str(body.get("summary") or "").strip(),
        "review": str(body.get("review") or "").strip(),
        "original_work": str(body.get("original_work") or "").strip(),
        "release_date": str(body.get("release_date") or "").strip(),
        "related_series": str(body.get("related_series") or "").strip(),
        "cover_url": _normalize_content_cover_url(str(body.get("cover_url") or "")),
        "source": str(body.get("source") or "manual").strip() or "manual",
        "source_id": str(body.get("source_id") or "").strip(),
        "ext_json": str(body.get("ext_json") or "{}").strip() or "{}",
        "list_status": ls,
    }
    tag_ids_raw = body.get("tag_ids") or []
    tag_ids: List[int] = []
    if isinstance(tag_ids_raw, list):
        for x in tag_ids_raw:
            try:
                tag_ids.append(int(x))
            except Exception:
                continue
    payload["tag_ids"] = tag_ids
    return payload, None


@app.route("/api/content/person-suggest", methods=["GET"])
def api_content_person_suggest() -> Any:
    """
    人物库关键字筛选（光影文卷主演/作者录入）。

    Query:
      q: keyword
      record_type: watch | book（与当前记录类型一致）
      exclude: 可重复，已选中的展示名不再出现
      limit: 默认 30，最大 80
    """
    q = str(request.args.get("q") or "").strip()
    if not q:
        return jsonify({"success": True, "items": []})
    rt = _content_record_type_normalize(request.args.get("record_type") or "")
    if rt not in ("watch", "book"):
        return jsonify({"success": False, "message": "record_type 需为 watch 或 book"}), 400
    exclude = [str(x or "").strip() for x in request.args.getlist("exclude") if str(x or "").strip()]
    try:
        lim = int(request.args.get("limit") or 30)
    except (TypeError, ValueError):
        lim = 30
    try:
        items = search_content_person_suggest(q, rt, exclude_names=exclude, limit=lim)
        return jsonify({"success": True, "items": items})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"查询失败：{exc}"}), 500


@app.route("/api/content/title-suggest", methods=["GET"])
def api_content_title_suggest() -> Any:
    """
    Fuzzy match record titles for form pickers.

    Query:
      q: keyword (required, non-empty)
      exclude_id: record id to omit (e.g. current editing row)
      limit: max rows (default 30, max 80)
    """
    q = str(request.args.get("q") or "").strip()
    if not q:
        return jsonify({"success": True, "items": []})
    exclude_raw = str(request.args.get("exclude_id") or "").strip()
    exclude_id = ""
    if exclude_raw and is_valid_content_record_public_id(exclude_raw):
        exclude_id = normalize_content_record_public_id(exclude_raw)
    try:
        lim = int(request.args.get("limit") or 30)
    except (TypeError, ValueError):
        lim = 30
    try:
        items = search_content_record_titles(q, exclude_id=exclude_id, limit=lim)
        return jsonify({"success": True, "items": items})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"查询失败：{exc}"}), 500


@app.route("/api/content/cover", methods=["POST"])
def api_content_cover_upload() -> Any:
    """Upload one poster image; returns URL under /static/uploads/content_covers/."""
    if "file" not in request.files:
        return jsonify({"success": False, "message": "缺少文件参数 file"}), 400
    uf = request.files["file"]
    if not uf or not uf.filename:
        return jsonify({"success": False, "message": "未选择文件"}), 400
    try:
        data = uf.read()
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取失败：{exc}"}), 400
    max_bytes = 5 * 1024 * 1024
    if len(data) > max_bytes:
        return jsonify({"success": False, "message": "图片不能超过 5MB"}), 400
    ext = _detect_uploaded_image_ext(data[:32])
    if not ext:
        return jsonify({"success": False, "message": "仅支持 JPEG / PNG / GIF / WebP 图片"}), 400
    name = f"{uuid.uuid4().hex}{ext}"
    dest = _content_cover_upload_dir() / name
    try:
        dest.write_bytes(data)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"保存失败：{exc}"}), 500
    url = f"/static/uploads/content_covers/{name}"
    return jsonify({"success": True, "url": url})


@app.route("/api/content/records", methods=["GET"])
def api_content_records_query() -> Any:
    """Query content records with key filters."""
    rt = _content_record_type_normalize(request.args.get("record_type") or "")
    title_kw = str(request.args.get("title") or "").strip()
    creator_kw = str(request.args.get("creator") or "").strip()
    category = str(request.args.get("category") or "").strip()
    tag_name = str(request.args.get("tag") or "").strip()
    submit_start = str(request.args.get("submit_start") or "").strip()
    submit_end = str(request.args.get("submit_end") or "").strip()
    rating = _parse_rating(request.args.get("rating"))
    list_status = _content_list_status_normalize(request.args.get("list_status"))
    try:
        page = int(request.args.get("page") or 1)
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(request.args.get("page_size") or 20)
    except (TypeError, ValueError):
        page_size = 20
    page = max(1, page)
    page_size = max(1, min(page_size, 100))
    if submit_start and not _parse_date_param(submit_start):
        return jsonify({"success": False, "message": "submit_start 格式错误，需 YYYY-MM-DD"}), 400
    if submit_end and not _parse_date_param(submit_end):
        return jsonify({"success": False, "message": "submit_end 格式错误，需 YYYY-MM-DD"}), 400
    if submit_start and submit_end and submit_start > submit_end:
        submit_start, submit_end = submit_end, submit_start
    try:
        items, total = query_content_records(
            record_type=rt,
            title_kw=title_kw,
            creator_kw=creator_kw,
            category=category,
            rating=rating if rating >= 0 else -1,
            tag_name=tag_name,
            submit_start=submit_start,
            submit_end=submit_end,
            list_status=list_status,
            page=page,
            page_size=page_size,
        )
        return jsonify(
            {
                "success": True,
                "items": items,
                "total": total,
                "page": page,
                "page_size": page_size,
            }
        )
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"查询失败：{exc}"}), 500


@app.route("/api/content/records/<string:record_id>", methods=["GET"])
def api_content_records_get(record_id: str) -> Any:
    """Get one content record by id."""
    if not is_valid_content_record_public_id(record_id):
        return jsonify({"success": False, "message": "记录 ID 格式无效"}), 400
    try:
        item = get_content_record(record_id)
        if not item:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True, "item": item})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取失败：{exc}"}), 500


@app.route("/api/content/records", methods=["POST"])
def api_content_records_add() -> Any:
    """Add one content record."""
    body = request.get_json(silent=True) or {}
    payload, err = _parse_content_record_payload(body)
    if err:
        return jsonify({"success": False, "message": err}), 400
    try:
        record_id = add_content_record(
            record_type=payload["record_type"],
            submit_date=payload["submit_date"],
            title=payload["title"],
            creator=payload["creator"],
            category=payload["category"],
            rating=payload["rating"],
            episode_count=payload["episode_count"],
            summary=payload["summary"],
            review=payload["review"],
            original_work=payload["original_work"],
            release_date=payload["release_date"],
            related_series=payload["related_series"],
            cover_url=payload["cover_url"],
            source=payload["source"],
            source_id=payload["source_id"],
            ext_json=payload["ext_json"],
            list_status=payload["list_status"],
        )
        set_content_record_tags(record_id, payload.get("tag_ids") or [])
        new_ids = content_record_related_ids_from_ext_json(payload.get("ext_json") or "{}")
        sync_content_record_related_links(record_id, set(), new_ids)
        return jsonify({"success": True, "id": record_id})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"新增失败：{exc}"}), 500


@app.route("/api/content/records/<string:record_id>", methods=["PUT"])
def api_content_records_update(record_id: str) -> Any:
    """Update one content record."""
    if not is_valid_content_record_public_id(record_id):
        return jsonify({"success": False, "message": "记录 ID 格式无效"}), 400
    body = request.get_json(silent=True) or {}
    payload, err = _parse_content_record_payload(body)
    if err:
        return jsonify({"success": False, "message": err}), 400
    try:
        existing = get_content_record(record_id)
        if not existing:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        old_ids = content_record_related_ids_from_ext_json(existing.get("ext_json") or "{}")
        ok = update_content_record(
            record_id=record_id,
            record_type=payload["record_type"],
            submit_date=payload["submit_date"],
            title=payload["title"],
            creator=payload["creator"],
            category=payload["category"],
            rating=payload["rating"],
            episode_count=payload["episode_count"],
            summary=payload["summary"],
            review=payload["review"],
            original_work=payload["original_work"],
            release_date=payload["release_date"],
            related_series=payload["related_series"],
            cover_url=payload["cover_url"],
            source=payload["source"],
            source_id=payload["source_id"],
            ext_json=payload["ext_json"],
            list_status=payload["list_status"],
        )
        if not ok:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        set_content_record_tags(record_id, payload.get("tag_ids") or [])
        new_ids = content_record_related_ids_from_ext_json(payload.get("ext_json") or "{}")
        sync_content_record_related_links(record_id, old_ids, new_ids)
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"更新失败：{exc}"}), 500


@app.route("/api/content/records/<string:record_id>", methods=["DELETE"])
def api_content_records_delete(record_id: str) -> Any:
    """Delete one content record."""
    if not is_valid_content_record_public_id(record_id):
        return jsonify({"success": False, "message": "记录 ID 格式无效"}), 400
    try:
        ok = delete_content_record(record_id)
        if not ok:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"删除失败：{exc}"}), 500


@app.route("/api/content/calendar-summary", methods=["GET"])
def api_content_calendar_summary() -> Any:
    """Get watch/book counts by date for month range."""
    month_str = request.args.get("month")
    year, month = _parse_month_param(month_str)
    start_date, end_date = _month_date_range(year, month)
    try:
        by_date = get_content_calendar_aggregates(start_date, end_date)
        return jsonify(
            {
                "success": True,
                "year": year,
                "month": month,
                "start_date": start_date,
                "end_date": end_date,
                "by_date": by_date,
            }
        )
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取失败：{exc}"}), 500


@app.route("/api/content/day", methods=["GET"])
def api_content_day() -> Any:
    """Get one day content records, optional by record_type."""
    date_str = str(request.args.get("date") or "").strip()
    if not date_str or not _parse_date_param(date_str):
        return jsonify({"success": False, "message": "参数错误：date 格式需 YYYY-MM-DD"}), 400
    rt = _content_record_type_normalize(request.args.get("record_type") or "")
    try:
        items, _ = query_content_records(
            record_type=rt,
            submit_start=date_str,
            submit_end=date_str,
            page_size=0,
        )
        return jsonify({"success": True, "date": date_str, "items": items})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取失败：{exc}"}), 500


@app.route("/api/content/persons", methods=["GET"])
def api_content_persons_list() -> Any:
    """
    人物库列表：分页、统计。

    Query:
      scope: watch | book | 空
      name: 姓名关键字
      letter: A–Z，按展示名首字拼音首字母
      page: 默认 1
      page_size: 默认 80，最大 100
    """
    raw = str(request.args.get("scope") or "").strip().lower()
    scope = raw if raw in ("watch", "book") else ""
    name_kw = str(request.args.get("name") or "").strip()
    letter = str(request.args.get("letter") or "").strip().upper()
    try:
        page = int(request.args.get("page") or 1)
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(request.args.get("page_size") or 80)
    except (TypeError, ValueError):
        page_size = 80
    page = max(1, page)
    page_size = max(1, min(page_size, 100))
    try:
        items, total = query_content_persons(
            scope=scope,
            name_kw=name_kw,
            letter=letter,
            page=page,
            page_size=page_size,
        )
        return jsonify(
            {
                "success": True,
                "items": items,
                "total": total,
                "page": page,
                "page_size": page_size,
            }
        )
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取失败：{exc}"}), 500


@app.route("/api/content/persons/<string:person_id>", methods=["GET", "PUT", "DELETE"])
def api_content_person_detail(person_id: str) -> Any:
    """人物详情（GET）、更新资料（PUT）、删除（DELETE，无关联作品时）。"""
    if not is_valid_content_person_public_id(person_id):
        return jsonify({"success": False, "message": "人物 ID 格式无效"}), 400
    if request.method == "GET":
        try:
            item = get_content_person(person_id)
            if not item:
                return jsonify({"success": False, "message": "人物不存在"}), 404
            return jsonify({"success": True, "item": item})
        except Exception as exc:  # pylint: disable=broad-except
            return jsonify({"success": False, "message": f"读取失败：{exc}"}), 500
    if request.method == "PUT":
        body = request.get_json(silent=True) or {}
        try:
            ok = update_content_person_profile(
                person_id,
                gender=str(body.get("gender") or ""),
                education=str(body.get("education") or ""),
                birthday=str(body.get("birthday") or ""),
                real_name=str(body.get("real_name") or ""),
                bio_note=str(body.get("bio_note") or ""),
            )
            if not ok:
                return jsonify({"success": False, "message": "人物不存在"}), 404
            item = get_content_person(person_id)
            return jsonify({"success": True, "item": item})
        except Exception as exc:  # pylint: disable=broad-except
            return jsonify({"success": False, "message": f"保存失败：{exc}"}), 500
    if request.method == "DELETE":
        try:
            ok, msg = delete_content_person_when_no_links(person_id)
            if not ok:
                code = 404 if ("不存在" in msg) or ("已删除" in msg) else 400
                return jsonify({"success": False, "message": msg}), code
            return jsonify({"success": True})
        except Exception as exc:  # pylint: disable=broad-except
            return jsonify({"success": False, "message": f"删除失败：{exc}"}), 500
    return jsonify({"success": False, "message": "不支持的请求方法"}), 405


@app.route("/api/content/persons/<string:person_id>/like", methods=["POST"])
def api_content_person_toggle_like(person_id: str) -> Any:
    """切换喜欢 / 取消喜欢。"""
    if not is_valid_content_person_public_id(person_id):
        return jsonify({"success": False, "message": "人物 ID 格式无效"}), 400
    try:
        newv = toggle_content_person_liked(person_id)
        if newv is None:
            return jsonify({"success": False, "message": "人物不存在"}), 404
        return jsonify({"success": True, "liked": newv})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"操作失败：{exc}"}), 500


@app.route("/api/content/persons/<string:person_id>/works", methods=["GET"])
def api_content_person_works(person_id: str) -> Any:
    """某人物关联的光影文卷作品（星级、日期、清单）。"""
    if not is_valid_content_person_public_id(person_id):
        return jsonify({"success": False, "message": "人物 ID 格式无效"}), 400
    try:
        items = get_content_person_works(person_id)
        return jsonify({"success": True, "items": items})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取失败：{exc}"}), 500


@app.route("/api/ledger/entries", methods=["GET"])
def api_ledger_entries_query() -> Any:
    """
    Query ledger entries between dates (inclusive), and totals.

    Query:
      start_date: YYYY-MM-DD
      end_date: YYYY-MM-DD
    """
    start_date = str(request.args.get("start_date") or "").strip()
    end_date = str(request.args.get("end_date") or "").strip()
    if not start_date or not end_date:
        return jsonify({"success": False, "message": "缺少参数 start_date / end_date"}), 400
    s, e, fmt_err = _ledger_clamp_main_query_dates(start_date, end_date)
    if fmt_err:
        return jsonify({"success": False, "message": fmt_err}), 400
    start_date, end_date = s, e
    try:
        if start_date > end_date:
            entries: List[Dict[str, Any]] = []
            totals = {"income_total": 0.0, "expense_total": 0.0, "daily_expense_total": 0.0}
        else:
            entries = query_ledger_entries_between(start_date, end_date)
            totals = sum_ledger_between(start_date, end_date)
        return jsonify(
            {
                "success": True,
                "start_date": start_date,
                "end_date": end_date,
                "entries": entries,
                "totals": {
                    "income_total": round(float(totals.get("income_total") or 0.0), 2),
                    "expense_total": round(float(totals.get("expense_total") or 0.0), 2),
                    "daily_expense_total": round(float(totals.get("daily_expense_total") or 0.0), 2),
                },
            }
        )
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"查询失败：{exc}"}), 500


@app.route("/api/ledger/entries", methods=["POST"])
def api_ledger_entries_add() -> Any:
    """
    Add ledger entry.

    JSON:
      {
        "date": "YYYY-MM-DD",
        "kind": "income"|"expense",
        "tag_id": 1,
        "description": "明细（必填，200字以内）",
        "annotation": "批注（可选，30字以内）",
        "amount": 12.3
      }
    """
    body = request.get_json(silent=True) or {}
    date_str = str(body.get("date") or "").strip()
    kind = _ledger_kind_normalize(body.get("kind") or "")
    tag_id_raw = body.get("tag_id")
    desc, ann, text_err = _ledger_parse_entry_text_fields(body)
    amt = _ledger_parse_amount(body.get("amount"))
    if not date_str or not _parse_date_param(date_str):
        return jsonify({"success": False, "message": "参数错误：date 格式需 YYYY-MM-DD"}), 400
    date_err = _ledger_entry_date_allowed(date_str)
    if date_err:
        return jsonify({"success": False, "message": date_err}), 400
    if not kind:
        return jsonify({"success": False, "message": "参数错误：kind 仅支持 income / expense"}), 400
    try:
        tag_id = int(tag_id_raw)
    except Exception:
        return jsonify({"success": False, "message": "参数错误：tag_id 需为整数"}), 400
    if amt is None:
        return jsonify({"success": False, "message": "参数错误：amount 必须为正数"}), 400
    if text_err:
        return jsonify({"success": False, "message": text_err}), 400
    nature, nature_err = _ledger_expense_nature_for_kind(kind, body)
    if nature_err:
        return jsonify({"success": False, "message": nature_err}), 400

    try:
        tag = get_ledger_tag_by_id(tag_id)
        if not tag:
            return jsonify({"success": False, "message": "标签不存在"}), 400
        if (tag.get("kind") or "") != kind:
            return jsonify({"success": False, "message": "标签类型与记账类型不匹配"}), 400
        entry_id = add_ledger_entry(
            date=date_str,
            kind=kind,
            tag_id=tag_id,
            tag_name_snapshot=str(tag.get("name") or ""),
            description=desc,
            annotation=ann,
            amount=float(amt),
            expense_nature=nature or "daily",
        )
        return jsonify({"success": True, "id": entry_id})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"新增失败：{exc}"}), 500


@app.route("/api/ledger/entries/<int:entry_id>", methods=["PUT"])
def api_ledger_entries_update(entry_id: int) -> Any:
    """Update ledger entry (payload matches POST)."""
    body = request.get_json(silent=True) or {}
    date_str = str(body.get("date") or "").strip()
    kind = _ledger_kind_normalize(body.get("kind") or "")
    tag_id_raw = body.get("tag_id")
    desc, ann, text_err = _ledger_parse_entry_text_fields(body)
    amt = _ledger_parse_amount(body.get("amount"))
    if not date_str or not _parse_date_param(date_str):
        return jsonify({"success": False, "message": "参数错误：date 格式需 YYYY-MM-DD"}), 400
    date_err = _ledger_entry_date_allowed(date_str)
    if date_err:
        return jsonify({"success": False, "message": date_err}), 400
    if not kind:
        return jsonify({"success": False, "message": "参数错误：kind 仅支持 income / expense"}), 400
    try:
        tag_id = int(tag_id_raw)
    except Exception:
        return jsonify({"success": False, "message": "参数错误：tag_id 需为整数"}), 400
    if amt is None:
        return jsonify({"success": False, "message": "参数错误：amount 必须为正数"}), 400
    if text_err:
        return jsonify({"success": False, "message": text_err}), 400
    nature, nature_err = _ledger_expense_nature_for_kind(kind, body)
    if nature_err:
        return jsonify({"success": False, "message": nature_err}), 400

    try:
        tag = get_ledger_tag_by_id(tag_id)
        if not tag:
            return jsonify({"success": False, "message": "标签不存在"}), 400
        if (tag.get("kind") or "") != kind:
            return jsonify({"success": False, "message": "标签类型与记账类型不匹配"}), 400
        ok = update_ledger_entry(
            entry_id=entry_id,
            date=date_str,
            kind=kind,
            tag_id=tag_id,
            tag_name_snapshot=str(tag.get("name") or ""),
            description=desc,
            annotation=ann,
            amount=float(amt),
            expense_nature=nature or "daily",
        )
        if not ok:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"更新失败：{exc}"}), 500


@app.route("/api/ledger/entries/<int:entry_id>", methods=["DELETE"])
def api_ledger_entries_delete(entry_id: int) -> Any:
    """Delete ledger entry."""
    try:
        ok = delete_ledger_entry(entry_id)
        if not ok:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"删除失败：{exc}"}), 500


def _ledger_budget_cell_json(row: Dict[str, Any]) -> Dict[str, Any]:
    g = str(row.get("granularity") or "")
    ps = str(row.get("period_start") or "")
    pe = str(row.get("period_end") or "")
    label = _ledger_period_label(g, ps, pe) if ps and pe else ""
    return {
        "id": row["id"],
        "granularity": g,
        "period_start": ps,
        "period_end": pe,
        "period_label": label,
        "amount": round(float(row.get("amount") or 0), 2),
        "updated_at": row.get("updated_at"),
    }


@app.route("/api/ledger/budget/cells", methods=["GET"])
def api_ledger_budget_cells_list() -> Any:
    """List persisted week / month budget cells (left column weeks, right column months)."""
    try:
        weeks = [_ledger_budget_cell_json(r) for r in list_ledger_budget_cells("week")]
        months = [_ledger_budget_cell_json(r) for r in list_ledger_budget_cells("month")]
        return jsonify({"success": True, "weeks": weeks, "months": months})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取失败：{exc}"}), 500


@app.route("/api/ledger/budget/cells/generate", methods=["POST"])
def api_ledger_budget_cells_generate() -> Any:
    """
    Expand a date range into discrete week or month rows and upsert amounts (does not keep a separate rule row).
    """
    body = request.get_json(silent=True) or {}
    granularity = _ledger_scope_normalize(body.get("granularity"))
    range_start = str(body.get("range_start") or "").strip()
    range_end = str(body.get("range_end") or "").strip()
    amt = _ledger_parse_budget_amount(body.get("amount"))
    err = _ledger_policy_range_validate(range_start, range_end)
    if not granularity:
        return jsonify({"success": False, "message": "缺少或非法的 granularity（week / month）"}), 400
    if err:
        return jsonify({"success": False, "message": err}), 400
    if amt is None:
        return jsonify({"success": False, "message": "参数错误：amount 需为非负数"}), 400
    rs = _parse_date_param(range_start)
    re_ = _parse_date_param(range_end)
    if not rs or not re_:
        return jsonify({"success": False, "message": "日期无效"}), 400
    try:
        if granularity == "week":
            lines = _enumerate_week_budget_lines(rs, re_, float(amt))
        else:
            lines = _enumerate_month_budget_lines(rs, re_, float(amt))
        for ln in lines:
            upsert_ledger_budget_cell(
                granularity,
                str(ln["period_start"]),
                str(ln["period_end"]),
                float(amt),
            )
        return jsonify({"success": True, "count": len(lines)})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"生成失败：{exc}"}), 500


@app.route("/api/ledger/budget/cells/<int:cell_id>", methods=["PUT"])
def api_ledger_budget_cell_update(cell_id: int) -> Any:
    body = request.get_json(silent=True) or {}
    amt = _ledger_parse_budget_amount(body.get("amount"))
    if amt is None:
        return jsonify({"success": False, "message": "参数错误：amount 需为非负数"}), 400
    try:
        ok = update_ledger_budget_cell_amount(cell_id, float(amt))
        if not ok:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"更新失败：{exc}"}), 500


@app.route("/api/ledger/stats/budget", methods=["GET"])
def api_ledger_stats_budget() -> Any:
    """
    Totals for a week/month plus optional daily-expense budget ratio.

    Query: scope=week|month, period_start=YYYY-MM-DD (week Monday or month first day).
    """
    scope = _ledger_scope_normalize(request.args.get("scope"))
    period_start = str(request.args.get("period_start") or "").strip()
    if not scope or not period_start:
        return jsonify({"success": False, "message": "缺少参数 scope / period_start"}), 400
    prange = _ledger_period_dates(scope, period_start)
    if not prange:
        return jsonify({"success": False, "message": "period_start 不合法"}), 400
    if not _ledger_period_not_future(scope, period_start):
        return jsonify({"success": False, "message": "不能选择未来周期"}), 400
    start_s, end_s = prange
    try:
        br = ledger_expense_breakdown_between(start_s, end_s)
        resolved = resolve_ledger_budget_amount(scope, start_s, end_s)
        daily_spent = float(br.get("expense_daily_total") or 0.0)
        ratio_pct: Optional[float] = None
        if resolved is not None and resolved > 0:
            ratio_pct = round((daily_spent / resolved) * 100.0, 1)
        return jsonify(
            {
                "success": True,
                "scope": scope,
                "period_start": period_start,
                "start_date": start_s,
                "end_date": end_s,
                "period_label": _ledger_period_label(scope, start_s, end_s),
                "daily_budget": round(float(resolved), 2) if resolved is not None else None,
                "expense_daily_total": round(float(br.get("expense_daily_total") or 0.0), 2),
                "expense_fixed_total": round(float(br.get("expense_fixed_total") or 0.0), 2),
                "expense_total": round(float(br.get("expense_total") or 0.0), 2),
                "budget_ratio_percent": ratio_pct,
            }
        )
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"统计失败：{exc}"}), 500


@app.route("/api/ledger/stats/overview", methods=["GET"])
def api_ledger_stats_overview() -> Any:
    """统计 TAB：基准日期（日）对应的日/周/前周/月汇总 + 预算占比与消费占比。"""
    ds = str(request.args.get("date") or "").strip()
    if ds:
        base = _parse_date_param(ds)
        if not base:
            return jsonify({"success": False, "message": "缺少或非法的 date（YYYY-MM-DD）"}), 400
        date_err = _ledger_entry_date_allowed(ds)
        if date_err:
            return jsonify({"success": False, "message": date_err}), 400
    else:
        base = date.today()
    day_s = base.strftime("%Y-%m-%d")
    wmon = _ledger_start_of_week_monday(base)
    ws, we = _ledger_week_range_from_monday(wmon)
    ms, me = _month_date_range(base.year, base.month)
    current = {
        "day": _ledger_triple_totals(day_s, day_s),
        "week": _ledger_triple_totals(ws, we),
        "month": _ledger_triple_totals(ms, me),
    }
    prev_wmon = wmon - timedelta(days=7)
    pw_s, pw_e = _ledger_week_range_from_monday(prev_wmon)
    current["prev_week"] = _ledger_triple_totals(pw_s, pw_e)
    gauges = {
        "this_week": _ledger_gauge_block("week", wmon),
        "prev_week": _ledger_gauge_block("week", prev_wmon),
        "this_month": _ledger_gauge_block("month", date(base.year, base.month, 1)),
    }
    tag_ratios = {
        "week": query_ledger_tag_expense_ratios(ws, we),
        "month": query_ledger_tag_expense_ratios(ms, me),
    }
    month_daily_expense = _build_month_daily_expense_series(ms, me)
    week_daily_breakdown = _build_week_daily_breakdown_series(base)
    month_weekly_expense = _build_month_weekly_expense_series(base)
    return jsonify(
        {
            "success": True,
            "server_date": day_s,
            "current": current,
            "gauges": gauges,
            "tag_ratios": tag_ratios,
            "month_daily_expense": month_daily_expense,
            "week_daily_breakdown": week_daily_breakdown,
            "month_weekly_expense": month_weekly_expense,
        }
    )


@app.route("/api/ledger/stats/by-date", methods=["GET"])
def api_ledger_stats_by_date() -> Any:
    """按指定日期：当日、所在自然周、所在自然月的收入/支出/日常支出及周、月预算占比。"""
    ds = str(request.args.get("date") or "").strip()
    d = _parse_date_param(ds)
    if not d:
        return jsonify({"success": False, "message": "缺少或非法的 date（YYYY-MM-DD）"}), 400
    date_err = _ledger_entry_date_allowed(ds)
    if date_err:
        return jsonify({"success": False, "message": date_err}), 400
    day_s = d.strftime("%Y-%m-%d")
    wmon = _ledger_start_of_week_monday(d)
    ws, we = _ledger_week_range_from_monday(wmon)
    ms, me = _month_date_range(d.year, d.month)
    week_tag = query_ledger_tag_expense_ratios(ws, we)
    month_tag = query_ledger_tag_expense_ratios(ms, me)
    return jsonify(
        {
            "success": True,
            "date": day_s,
            "day": _ledger_triple_totals(day_s, day_s),
            "week": {
                "totals": _ledger_triple_totals(ws, we),
                "gauge": _ledger_gauge_block("week", wmon),
                "tag_ratios": week_tag,
            },
            "month": {
                "totals": _ledger_triple_totals(ms, me),
                "gauge": _ledger_gauge_block("month", date(d.year, d.month, 1)),
                "tag_ratios": month_tag,
            },
        }
    )


@app.route("/files")
def file_manager_page() -> str:
    """
    Render the local file management tool page.
    :return: Rendered HTML content.
    """
    return render_template("index.html")


@app.route("/notes")
def notes_page() -> str:
    """
    Render the study notes page.
    :return: Rendered HTML content.
    """
    return render_template("notes.html")


@app.route("/diary")
def diary_page() -> str:
    """
    Render the diary page.
    :return: Rendered HTML content.
    """
    return render_template("diary.html")


@app.route("/bookmarks")
def bookmarks_page() -> str:
    """
    Render the bookmarks management page.
    :return: Rendered HTML content.
    """
    return render_template("bookmarks.html")


@app.route("/api/bookmarks", methods=["GET"])
def api_bookmarks_list() -> Any:
    """Return all bookmarks ordered by id."""
    try:
        items = get_all_bookmarks()
        return jsonify({"success": True, "items": items})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/bookmarks", methods=["POST"])
def api_bookmarks_add() -> Any:
    """Add a new bookmark. Request JSON: { "title": "", "url": "", "category": "" }"""
    data = request.get_json(silent=True) or {}
    title = data.get("title", "")
    url = data.get("url", "")
    category = data.get("category", "")
    try:
        row_id = add_bookmark(title, url, category)
        return jsonify({"success": True, "id": row_id})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/bookmarks/<int:bookmark_id>", methods=["PUT"])
def api_bookmarks_update(bookmark_id: int) -> Any:
    """Update a bookmark. Request JSON: { "title": "", "url": "", "category": "" }"""
    data = request.get_json(silent=True) or {}
    title = data.get("title", "")
    url = data.get("url", "")
    category = data.get("category", "")
    try:
        ok = update_bookmark(bookmark_id, title, url, category)
        if not ok:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/bookmarks/<int:bookmark_id>", methods=["DELETE"])
def api_bookmarks_delete(bookmark_id: int) -> Any:
    """Delete a bookmark."""
    try:
        ok = delete_bookmark(bookmark_id)
        if not ok:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/bookmarks/<int:bookmark_id>/move-up", methods=["POST"])
def api_bookmarks_move_up(bookmark_id: int) -> Any:
    """Swap bookmark with the previous one within the same category."""
    try:
        items = get_all_bookmarks()
        # Find current item and its category
        id_to_item = {item["id"]: item for item in items}
        current = id_to_item.get(bookmark_id)
        if current is None:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        cur_category = (current.get("category") or "").strip()

        # Walk backwards in the global order to find the previous item in the same category
        ids = [item["id"] for item in items]
        idx = ids.index(bookmark_id)
        prev_id: int | None = None
        for j in range(idx - 1, -1, -1):
            prev_item = items[j]
            prev_cat = (prev_item.get("category") or "").strip()
            if prev_cat == cur_category:
                prev_id = prev_item["id"]
                break

        if prev_id is None:
            # Already the first item within this category
            return jsonify({"success": False, "message": "已是该分类第一条，无法上移"}), 400

        ok = swap_bookmarks_db(bookmark_id, prev_id)
        if not ok:
            return jsonify({"success": False, "message": "交换失败"}), 500
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/notes", methods=["GET"])
def api_notes_list() -> Any:
    """
    Return all notes ordered by created_at desc.
    :return: JSON with list of notes.
    """
    try:
        items = get_all_notes()
        return jsonify({"success": True, "items": items})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/notes/<int:note_id>", methods=["GET"])
def api_notes_get(note_id: int) -> Any:
    """
    Get a single note by id.
    """
    try:
        note = get_note(note_id)
        if note is None:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True, "item": note})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/notes", methods=["POST"])
def api_notes_add() -> Any:
    """
    Add a new note.
    Request JSON: { "title": "", "category": "", "content": "" }
    """
    data = request.get_json(silent=True) or {}
    title = data.get("title", "")
    category = data.get("category", "")
    content = data.get("content", "")
    try:
        row_id = add_note(title, category, content)
        return jsonify({"success": True, "id": row_id})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/notes/<int:note_id>", methods=["PUT"])
def api_notes_update(note_id: int) -> Any:
    """
    Update an existing note.
    Request JSON: { "title": "", "category": "", "content": "" }
    """
    data = request.get_json(silent=True) or {}
    title = data.get("title", "")
    category = data.get("category", "")
    content = data.get("content", "")
    try:
        ok = update_note(note_id, title, category, content)
        if not ok:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/notes/<int:note_id>", methods=["DELETE"])
def api_notes_delete(note_id: int) -> Any:
    """
    Delete a note.
    """
    try:
        ok = delete_note(note_id)
        if not ok:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/diaries", methods=["GET"])
def api_diaries_list() -> Any:
    """
    List diaries between start_date and end_date.
    Query:
      start_date: YYYY-MM-DD (optional)
      end_date: YYYY-MM-DD (optional)
    """
    start_date = str(request.args.get("start_date") or "").strip()
    end_date = str(request.args.get("end_date") or "").strip()
    if not start_date and not end_date:
        # default wide range for list panel
        start_date = "1900-01-01"
        end_date = "2999-12-31"
    elif start_date and not end_date:
        end_date = start_date
    elif end_date and not start_date:
        start_date = end_date

    if not _parse_date_param(start_date) or not _parse_date_param(end_date):
        return jsonify({"success": False, "message": "日期格式错误，需 YYYY-MM-DD"}), 400
    if start_date > end_date:
        start_date, end_date = end_date, start_date

    try:
        items = list_diaries_between(start_date, end_date)
        return jsonify({"success": True, "items": items})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/diaries/<date_str>", methods=["GET"])
def api_diary_get(date_str: str) -> Any:
    """
    Get one diary by date (YYYY-MM-DD).
    """
    date_str = str(date_str or "").strip()
    if not _parse_date_param(date_str):
        return jsonify({"success": False, "message": "日期格式错误，需 YYYY-MM-DD"}), 400
    try:
        item = get_diary(date_str)
        if item is None:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True, "item": item})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/diaries/<date_str>", methods=["PUT"])
def api_diary_upsert(date_str: str) -> Any:
    """
    Upsert one diary by date (YYYY-MM-DD).
    Request JSON: { "title": "", "content": "", "today_diet": "", "exercise_summary": "" }
    """
    date_str = str(date_str or "").strip()
    if not _parse_date_param(date_str):
        return jsonify({"success": False, "message": "日期格式错误，需 YYYY-MM-DD"}), 400
    body = request.get_json(silent=True) or {}
    title = str(body.get("title") or "")
    content = str(body.get("content") or "")
    today_diet = str(body.get("today_diet") or "").strip()
    exercise_summary = str(body.get("exercise_summary") or "").strip()
    if len(today_diet) > 200:
        return jsonify({"success": False, "message": "今日饮食不能超过200字"}), 400
    if len(exercise_summary) > 500:
        return jsonify({"success": False, "message": "锻炼小结不能超过500字"}), 400
    try:
        upsert_diary(date_str, title, content, today_diet, exercise_summary)
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


def _normalize_categories(items: Any) -> List[str]:
    if not isinstance(items, list):
        return []
    out: List[str] = []
    seen = set()
    for it in items:
        s = str(it or "").strip()
        if not s:
            continue
        if s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


@app.route("/api/notes/categories", methods=["GET"])
def api_notes_categories_get() -> Any:
    """Get persisted note categories list."""
    try:
        raw = get_app_state(NOTES_CATEGORIES_STATE_KEY)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取分类失败：{exc}"}), 500

    if not raw:
        return jsonify({"success": True, "data": DEFAULT_NOTES_CATEGORIES_STATE})
    try:
        data = json.loads(raw)
    except Exception:
        data = DEFAULT_NOTES_CATEGORIES_STATE
    if not isinstance(data, dict):
        data = DEFAULT_NOTES_CATEGORIES_STATE
    items = _normalize_categories(data.get("items") or [])
    if not items:
        items = DEFAULT_NOTES_CATEGORIES_STATE["items"][:]
    return jsonify({"success": True, "data": {"items": items}})


@app.route("/api/notes/categories", methods=["POST"])
def api_notes_categories_set() -> Any:
    """Overwrite persisted note categories list."""
    body = request.get_json(silent=True) or {}
    items = _normalize_categories(body.get("items") or [])
    if not items:
        items = DEFAULT_NOTES_CATEGORIES_STATE["items"][:]
    data: Dict[str, Any] = {"items": items}
    try:
        payload = json.dumps(data, ensure_ascii=False)
        set_app_state(NOTES_CATEGORIES_STATE_KEY, payload)
        return jsonify({"success": True, "data": data})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"保存分类失败：{exc}"}), 500


@app.route("/api/notes/categories/rename", methods=["POST"])
def api_notes_categories_rename() -> Any:
    """Rename a category (also updates notes records)."""
    body = request.get_json(silent=True) or {}
    old = str(body.get("from") or "").strip()
    new = str(body.get("to") or "").strip()
    if not old or not new:
        return jsonify({"success": False, "message": "参数错误"}), 400
    if old == new:
        return jsonify({"success": True, "affected": 0})

    try:
        raw = get_app_state(NOTES_CATEGORIES_STATE_KEY)
    except Exception:
        raw = None
    cats = DEFAULT_NOTES_CATEGORIES_STATE["items"][:]
    if raw:
        try:
            data = json.loads(raw)
            cats = _normalize_categories(data.get("items") or []) or cats
        except Exception:
            pass

    if new in cats and new != old:
        return jsonify({"success": False, "message": "分类已存在"}), 400

    try:
        affected = rename_notes_category(old, new)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"更新笔记分类失败：{exc}"}), 500

    # update categories list
    cats_out: List[str] = []
    for c in cats:
        cats_out.append(new if c == old else c)
    cats_out = _normalize_categories(cats_out)
    if not cats_out:
        cats_out = DEFAULT_NOTES_CATEGORIES_STATE["items"][:]
    try:
        set_app_state(NOTES_CATEGORIES_STATE_KEY, json.dumps({"items": cats_out}, ensure_ascii=False))
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"保存分类失败：{exc}"}), 500

    return jsonify({"success": True, "affected": affected, "data": {"items": cats_out}})


@app.route("/api/notes/categories/delete", methods=["POST"])
def api_notes_categories_delete() -> Any:
    """Delete a category (only if no notes under it)."""
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "message": "参数错误"}), 400

    try:
        cnt = count_notes_in_category(name)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"校验失败：{exc}"}), 500
    if cnt > 0:
        return jsonify({"success": False, "message": "当前分类下已有笔记，不可删除。"}), 400

    try:
        raw = get_app_state(NOTES_CATEGORIES_STATE_KEY)
    except Exception:
        raw = None
    cats = DEFAULT_NOTES_CATEGORIES_STATE["items"][:]
    if raw:
        try:
            data = json.loads(raw)
            cats = _normalize_categories(data.get("items") or []) or cats
        except Exception:
            pass

    cats_out = [c for c in cats if c != name]
    cats_out = _normalize_categories(cats_out)
    if not cats_out:
        cats_out = DEFAULT_NOTES_CATEGORIES_STATE["items"][:]
    try:
        set_app_state(NOTES_CATEGORIES_STATE_KEY, json.dumps({"items": cats_out}, ensure_ascii=False))
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"保存分类失败：{exc}"}), 500

    return jsonify({"success": True, "data": {"items": cats_out}})


@app.route("/api/scan", methods=["POST"])
def api_scan() -> Any:
    """
    Scan a directory for files, classify them and cache results.

    Request JSON body:
        {
          "directory": "/absolute/path"
        }

    :return: JSON response with scan status.
    """
    global SCAN_RESULTS

    data = request.get_json(silent=True) or {}
    directory = data.get("directory", "")

    if not isinstance(directory, str) or not directory:
        return jsonify({"success": False, "message": "目录不能为空。"}), 400

    if not validate_directory_path(directory):
        return jsonify({"success": False, "message": "目录路径无效或不存在。"}), 400

    try:
        SCAN_RESULTS = scan_directory(directory)
        return jsonify(
            {
                "success": True,
                "message": "扫描完成。",
                "total": len(SCAN_RESULTS),
            }
        )
    except Exception as exc:  # pylint: disable=broad-except
        return (
            jsonify({"success": False, "message": f"扫描失败：{exc}"}),
            500,
        )


@app.route("/api/files", methods=["GET"])
def api_files() -> Any:
    """
    Return paginated, sorted and filtered file list based on last scan.

    Query parameters:
        page: page number (default 1)
        per_page: items per page (default 200)
        sort_by: name | size | type | created_at | modified_at (default name)
        sort_order: asc | desc (default asc)
        file_type: word | excel | ppt | pdf | prototype | hidden
        search: keyword for filename fuzzy search

    :return: JSON with file list and pagination info.
    """
    if not SCAN_RESULTS:
        return jsonify(
            {
                "success": True,
                "items": [],
                "page": 1,
                "per_page": 200,
                "total": 0,
                "total_pages": 1,
            }
        )

    try:
        page = int(request.args.get("page", "1"))
    except ValueError:
        page = 1

    try:
        per_page = int(request.args.get("per_page", "200"))
    except ValueError:
        per_page = 200

    sort_by = request.args.get("sort_by", "name")
    sort_order = request.args.get("sort_order", "asc")
    file_type = request.args.get("file_type") or None
    search = request.args.get("search") or None

    filtered_items = filter_items(SCAN_RESULTS, file_type=file_type, search=search)
    sorted_items = sort_items(filtered_items, sort_by=sort_by, sort_order=sort_order)
    page_items, total_pages = get_paginated_items(sorted_items, page, per_page)

    return jsonify(
        {
            "success": True,
            "items": page_items,
            "page": page,
            "per_page": per_page,
            "total": len(filtered_items),
            "total_pages": total_pages,
        }
    )


@app.route("/api/files/similar", methods=["GET"])
def api_files_similar() -> Any:
    """
    Return paginated near-duplicate file groups based on last scan.
    Rules (default):
    - filename similarity >= 0.9
    - file size difference <= 100KB
    """
    if not SCAN_RESULTS:
        return jsonify({"success": False, "message": "请先扫描文件后再进行疑似同文件分析。"}), 400

    try:
        page = int(request.args.get("page", "1"))
    except ValueError:
        page = 1
    try:
        per_page = int(request.args.get("per_page", "10"))
    except ValueError:
        per_page = 10

    try:
        ratio = float(request.args.get("name_ratio", "0.9"))
    except ValueError:
        ratio = 0.9
    try:
        size_diff_kb = int(request.args.get("size_diff_kb", "100"))
    except ValueError:
        size_diff_kb = 100
    ratio = max(0.0, min(1.0, ratio))
    size_diff_bytes = max(0, size_diff_kb * 1024)

    groups = build_similar_file_groups(
        SCAN_RESULTS,
        ratio_threshold=ratio,
        size_diff_limit_bytes=size_diff_bytes,
    )
    total_groups = len(groups)
    if per_page <= 0:
        per_page = 10
    total_pages = (total_groups + per_page - 1) // per_page if total_groups > 0 else 1
    if page < 1:
        page = 1
    if page > total_pages:
        page = total_pages
    start = (page - 1) * per_page
    end = start + per_page
    page_groups = groups[start:end]
    total_files = sum(int(g.get("count") or 0) for g in groups)
    return jsonify(
        {
            "success": True,
            "groups": page_groups,
            "page": page,
            "per_page": per_page,
            "total_pages": total_pages,
            "total_groups": total_groups,
            "total_files": total_files,
        }
    )


@app.route("/api/file/remark", methods=["POST"])
def api_file_remark() -> Any:
    """
    Create or update remark for a file path.

    Request JSON body:
        {
          "path": "/absolute/file/path",
          "remark": "some text"
        }

    :return: JSON with success status.
    """
    data = request.get_json(silent=True) or {}
    path = data.get("path", "")
    remark = data.get("remark", "")

    if not isinstance(path, str) or not path:
        return jsonify({"success": False, "message": "文件路径不能为空。"}), 400

    try:
        set_remark(path, remark)

        # Update cached items so UI refresh is consistent.
        for item in SCAN_RESULTS:
            if item.get("full_path") == path:
                item["remark"] = remark
                break

        return jsonify({"success": True, "message": "备注已保存。"})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"保存备注失败：{exc}"}), 500


@app.route("/api/file/delete", methods=["POST"])
def api_file_delete() -> Any:
    """
    Delete a file by moving it to the trash using send2trash.

    Request JSON body:
        {
          "path": "/absolute/file/path"
        }

    :return: JSON with success status.
    """
    global SCAN_RESULTS

    data = request.get_json(silent=True) or {}
    path = data.get("path", "")

    if not isinstance(path, str) or not path:
        return jsonify({"success": False, "message": "文件路径不能为空。"}), 400

    if not os.path.isfile(path):
        return jsonify({"success": False, "message": "文件不存在。"}), 400

    try:
        send2trash(path)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"删除失败：{exc}"}), 500

    # Remove from cache
    SCAN_RESULTS = [item for item in SCAN_RESULTS if item.get("full_path") != path]

    return jsonify({"success": True, "message": "文件已移动到废纸篓。"})


@app.route("/api/file/rename", methods=["POST"])
def api_file_rename() -> Any:
    """
    Rename a file, ensuring no duplicate name in the same directory.

    Request JSON body:
        {
          "path": "/absolute/file/path",
          "new_name": "new_filename.ext"
        }

    :return: JSON with success status and updated item if ok.
    """
    global SCAN_RESULTS

    data = request.get_json(silent=True) or {}
    path = data.get("path", "")
    new_name = data.get("new_name", "")

    if not isinstance(path, str) or not path:
        return jsonify({"success": False, "message": "文件路径不能为空。"}), 400

    if not isinstance(new_name, str) or not new_name:
        return jsonify({"success": False, "message": "新文件名不能为空。"}), 400

    if "/" in new_name or "\\" in new_name:
        return jsonify({"success": False, "message": "新文件名不能包含路径分隔符。"}), 400

    if not os.path.isfile(path):
        return jsonify({"success": False, "message": "原文件不存在。"}), 400

    directory = os.path.dirname(path)
    new_path = os.path.join(directory, new_name)

    if os.path.exists(new_path):
        return jsonify({"success": False, "message": "同目录下已存在同名文件。"}), 400

    try:
        os.rename(path, new_path)

        # Update remark path in database if exists
        try:
            if get_remark(path) is not None:
                update_path(path, new_path)
        except Exception:
            # Ignore remark migration failures to avoid breaking rename.
            pass

        # Update cached items
        updated_item: Optional[Dict[str, Any]] = None
        for item in SCAN_RESULTS:
            if item.get("full_path") == path:
                item["full_path"] = new_path
                item["name"] = new_name
                item["folder_path"] = directory
                item["is_hidden"] = os.path.basename(new_name).startswith(".")
                updated_item = item
                break

        return jsonify(
            {
                "success": True,
                "message": "重命名成功。",
                "item": updated_item,
            }
        )
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"重命名失败：{exc}"}), 500


@app.route("/api/file/open", methods=["POST"])
def api_file_open() -> Any:
    """
    Open a file with the default system application on macOS.

    Request JSON body:
        {
          "path": "/absolute/file/path"
        }

    :return: JSON with success status.
    """
    data = request.get_json(silent=True) or {}
    path = data.get("path", "")

    if not isinstance(path, str) or not path:
        return jsonify({"success": False, "message": "文件路径不能为空。"}), 400

    if not os.path.isfile(path):
        return jsonify({"success": False, "message": "文件不存在。"}), 400

    try:
        # Use the macOS 'open' command to open the file with default app.
        os.system(f'open "{path}"')
        return jsonify({"success": True, "message": "已请求使用系统默认程序打开文件。"})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"打开文件失败：{exc}"}), 500


def _checkin_state_snapshot_has_data(data: Dict[str, Any]) -> bool:
    """
    判断打卡快照是否包含有效业务数据（events / records / 非空 dateLabels）。

    注意：即使 calendar_events 表为空，get_calendar_events() 也会返回
    dateLabels = { "specific": {}, "annual": {} }，外层 dict 在 Python 中为真值；
    必须用「具体键是否有内容」判断，否则会误判为“有数据”。
    """
    if not data or not isinstance(data, dict):
        return False
    if data.get("events"):
        return True
    if data.get("records"):
        return True
    dl = data.get("dateLabels") or {}
    if not isinstance(dl, dict):
        return False
    spec = dl.get("specific") or {}
    ann = dl.get("annual") or {}
    return bool(spec) or bool(ann)


@app.route("/api/checkin/state", methods=["GET"])
def api_checkin_get_state() -> Any:
    """
    获取打卡状态（events, records, dateLabels）。

    完整快照以 app_state.checkin_data 为准：POST /api/checkin/state 写入此处，
    events/records 不会写入 calendar_events 表（该表目前主要承载部分 dateLabels）。

    若优先读 calendar_events，会在「仅有标签写入表、事件仍在 app_state」时丢失事件，
    因此必须先读 app_state，再在无有效快照时回退 calendar_events。
    """
    try:
        raw = get_app_state(CHECKIN_STATE_KEY)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取打卡数据失败：{exc}"}), 500

    data_from_app: Optional[Dict[str, Any]] = None
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                data_from_app = parsed
        except Exception:
            data_from_app = None

    if data_from_app is not None:
        data_from_app.setdefault("events", [])
        data_from_app.setdefault("records", [])
        data_from_app.setdefault("dateLabels", {"specific": {}, "annual": {}})
        if _checkin_state_snapshot_has_data(data_from_app):
            return jsonify({"success": True, "data": data_from_app})

    try:
        cal = get_calendar_events()
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取打卡数据失败：{exc}"}), 500

    if isinstance(cal, dict):
        cal.setdefault("events", [])
        cal.setdefault("records", [])
        cal.setdefault("dateLabels", {"specific": {}, "annual": {}})
        if _checkin_state_snapshot_has_data(cal):
            return jsonify({"success": True, "data": cal})

    if data_from_app is not None:
        return jsonify({"success": True, "data": data_from_app})

    return jsonify({"success": True, "data": DEFAULT_CHECKIN_STATE.copy()})


@app.route("/api/checkin/state", methods=["POST"])
def api_checkin_set_state() -> Any:
    """
    Persist full checkin state (events, records, dateLabels) on the server.
    The client sends the完整数据快照，每次覆盖写入。

    Expected JSON body:
        {
          "events": [...],
          "records": [...],
          "dateLabels": { "specific": {...}, "annual": {...} }
        }
    """
    body = request.get_json(silent=True) or {}
    data: Dict[str, Any] = {
        "events": body.get("events") or [],
        "records": body.get("records") or [],
        "dateLabels": body.get("dateLabels") or {"specific": {}, "annual": {}},
    }
    try:
        # 统一写入 calendar_events 表
        set_calendar_state(data)
        # 兼容旧版：同时更新 app_state，方便回滚或备份
        try:
            payload = json.dumps(data, ensure_ascii=False)
            set_app_state(CHECKIN_STATE_KEY, payload)
        except Exception:
            pass
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"保存打卡数据失败：{exc}"}), 500


@app.route("/api/checkin/mark-history-complete", methods=["POST"])
def api_checkin_mark_history_complete() -> Any:
    """
    兼容旧客户端：不再自动将历史日期补全为「已完成」。

    打卡完成状态仅由用户在日历中手动勾选产生（写入 records）。
    此接口仅返回当前打卡状态，不新增、不修改 records，不写库。
    """
    try:
        raw = get_app_state(CHECKIN_STATE_KEY)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取打卡数据失败：{exc}"}), 500

    if not raw:
        data: Dict[str, Any] = DEFAULT_CHECKIN_STATE.copy()
    else:
        try:
            data = json.loads(raw)
        except Exception:
            data = DEFAULT_CHECKIN_STATE.copy()

    if not isinstance(data, dict):
        data = DEFAULT_CHECKIN_STATE.copy()

    return jsonify({"success": True, "added": 0, "data": data})


def _load_checkin_state_from_app_state() -> Dict[str, Any]:
    raw = None
    try:
        raw = get_app_state(CHECKIN_STATE_KEY)
    except Exception:
        raw = None
    if not raw:
        return DEFAULT_CHECKIN_STATE.copy()
    try:
        data = json.loads(raw)
    except Exception:
        data = DEFAULT_CHECKIN_STATE.copy()
    if not isinstance(data, dict):
        data = DEFAULT_CHECKIN_STATE.copy()
    data.setdefault("events", [])
    data.setdefault("records", [])
    data.setdefault("dateLabels", {"specific": {}, "annual": {}})
    return data


def _load_caldav_config() -> Dict[str, Any]:
    raw = None
    try:
        raw = get_app_state(CALDAV_CONFIG_KEY)
    except Exception:
        raw = None
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def _save_caldav_config(config: Dict[str, Any]) -> None:
    payload = json.dumps(config, ensure_ascii=False)
    set_app_state(CALDAV_CONFIG_KEY, payload)


@app.route("/api/calendar/caldav/config", methods=["GET"])
def api_calendar_caldav_config_get() -> Any:
    try:
        cfg = _load_caldav_config()
        # Do not expose password back to the browser.
        if isinstance(cfg, dict) and "password" in cfg:
            cfg.pop("password", None)
        return jsonify({"success": True, "config": cfg})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取 CalDAV 配置失败：{exc}"}), 500


@app.route("/api/calendar/caldav/config", methods=["POST"])
def api_calendar_caldav_config_set() -> Any:
    body = request.get_json(silent=True) or {}
    config: Dict[str, Any] = {
        "caldav_url": str(body.get("caldav_url") or "").strip(),
        "calendar_url": str(body.get("calendar_url") or "").strip(),
        "username": str(body.get("username") or "").strip(),
        "password": str(body.get("password") or ""),
    }
    # Minimal validation
    if not config["caldav_url"] or not config["calendar_url"] or not config["username"]:
        return jsonify({"success": False, "message": "CalDAV 配置不完整"}), 400

    try:
        _save_caldav_config(config)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"保存 CalDAV 配置失败：{exc}"}), 500

    return jsonify({"success": True})


@app.route("/api/calendar/caldav/sync", methods=["POST"])
def api_calendar_caldav_sync() -> Any:
    config = _load_caldav_config()
    if not config:
        return jsonify({"success": False, "message": "尚未配置 CalDAV"}), 400

    try:
        checkin_data = _load_checkin_state_from_app_state()
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取打卡数据失败：{exc}"}), 500

    # default 90 days window (matches the earlier selection B)
    window_days = int((request.get_json(silent=True) or {}).get("window_days") or 90)
    if window_days < 1:
        window_days = 90

    try:
        result = sync_checkin_to_caldav(config, checkin_data, window_days=window_days)
        code = 200 if result.get("success") else 500
        return jsonify(result), code
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"CalDAV 同步失败：{exc}"}), 500


_CALDAV_SYNC_LOCKED = False


def _start_caldav_scheduler() -> None:
    """
    Simple background scheduler: run sync every hour if CalDAV config exists.
    Note: Flask debug mode uses reloader; caller should only invoke in the main reloader process.
    """
    import threading
    import time

    def job_loop() -> None:
        global _CALDAV_SYNC_LOCKED
        while True:
            try:
                if _CALDAV_SYNC_LOCKED:
                    time.sleep(60)
                    continue
                cfg = _load_caldav_config()
                if cfg:
                    _CALDAV_SYNC_LOCKED = True
                    data = _load_checkin_state_from_app_state()
                    # ignore result details, keep it best-effort
                    sync_checkin_to_caldav(cfg, data, window_days=90)
                _CALDAV_SYNC_LOCKED = False
            except Exception:
                # best-effort background job: ignore errors
                _CALDAV_SYNC_LOCKED = False
            finally:
                time.sleep(3600)

    t = threading.Thread(target=job_loop, daemon=True)
    t.start()


@app.route("/api/vocab/state", methods=["GET"])
def api_vocab_get_state() -> Any:
    """
    获取服务端保存的单词本数据。
    """
    # 优先从 vocab_words / vocab_tags 读取；若数据库尚未初始化数据，则回退到历史 app_state 存储
    try:
        items, tags = get_all_vocab_words()
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取词汇数据失败：{exc}"}), 500

    if items or tags:
        data_out: Dict[str, Any] = {"items": items, "tags": tags}
        return jsonify({"success": True, "data": data_out})

    # 数据库无记录时，兼容旧版 app_state 存储
    try:
        raw = get_app_state(VOCAB_STATE_KEY)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取词汇数据失败：{exc}"}), 500

    if not raw:
        return jsonify({"success": True, "data": DEFAULT_VOCAB_STATE})
    try:
        data = json.loads(raw)
    except Exception:
        data = DEFAULT_VOCAB_STATE
    if not isinstance(data, dict):
        data = DEFAULT_VOCAB_STATE
    items = data.get("items") or []
    if not isinstance(items, list):
        items = []

    def _build_tags_from_items(raw_items: List[Dict[str, Any]]) -> List[Dict[str, str]]:
        seen = set()
        out: List[Dict[str, str]] = []
        for it in raw_items:
            if not isinstance(it, dict):
                continue
            # 历史迁移：所有已有标签统一按英文标签处理
            scope = "english"
            tags = it.get("tags") or []
            if not isinstance(tags, list):
                continue
            for tag in tags:
                name = str(tag or "").strip()
                if not name:
                    continue
                key = (name, scope)
                if key in seen:
                    continue
                seen.add(key)
                out.append({"name": name, "scope": scope})
        return out

    tags = data.get("tags")
    # 如果 tags 字段不存在或为空列表，则根据历史 items 迁移生成
    if not isinstance(tags, list) or not tags:
        tags = _build_tags_from_items(items)

    data_out: Dict[str, Any] = {"items": items, "tags": tags}
    return jsonify({"success": True, "data": data_out})


@app.route("/api/vocab/state", methods=["POST"])
def api_vocab_set_state() -> Any:
    """
    覆盖写入单词本数据。前端每次提交完整 items 列表。

    Expected JSON:
        { "items": [ ...词汇项... ] }
    """
    body = request.get_json(silent=True) or {}
    items = body.get("items") or []
    if not isinstance(items, list):
        items = []
    raw_tags = body.get("tags") or []
    tags: List[Dict[str, Any]] = []
    if isinstance(raw_tags, list):
        seen = set()
        for t in raw_tags:
            if not isinstance(t, dict):
                continue
            name = str(t.get("name") or "").strip()
            scope = str(t.get("scope") or "english").lower()
            if scope not in ("english", "chinese"):
                scope = "english"
            if not name:
                continue
            key = (name, scope)
            if key in seen:
                continue
            seen.add(key)
            tags.append({"name": name, "scope": scope})
    data: Dict[str, Any] = {"items": items, "tags": tags}
    try:
        # 统一写入 vocab_words / vocab_tags 表
        set_vocab_state(items, tags)
        # 兼容旧版：同时更新 app_state，方便后续一次性导入与回滚
        try:
            payload = json.dumps(data, ensure_ascii=False)
            set_app_state(VOCAB_STATE_KEY, payload)
        except Exception:
            # app_state 失败不影响主流程
            pass
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"保存词汇数据失败：{exc}"}), 500


def _vocab_input_is_chinese(text: str) -> bool:
    """输入是否主要为中文（含汉字即按中文词条处理，与前端 detectLanguage 一致）。"""
    s = (text or "").strip()
    if not s:
        return False
    return bool(re.search(r"[\u4e00-\u9fff]", s))


def _call_llm_for_vocab(text: str) -> Dict[str, Any]:
    """
    调用大语言模型，将原始查询文本解析为结构化的单词信息。

    为了方便本地配置，这里约定：
    - 使用 OpenAI 兼容接口
    - 必须在环境变量中提供 OPENAI_API_KEY
    - 可选：OPENAI_API_BASE、OPENAI_VOCAB_MODEL

    如果未配置密钥或调用失败，将抛出异常，由上层捕获并返回错误给前端。
    """
    import urllib.request
    import urllib.error

    cfg = _load_llm_config()
    # 优先使用本地配置文件中的 key / base / model，其次回退到环境变量
    api_key = cfg["api_key"] or os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_TOKEN")
    if not api_key:
        raise RuntimeError("服务端未配置 OPENAI_API_KEY，无法使用大模型查询。")

    base_url = cfg["base_url"] or os.environ.get("OPENAI_API_BASE", "https://api.openai.com/v1")
    model = cfg["model"] or os.environ.get("OPENAI_VOCAB_MODEL", "gpt-4o-mini")

    pronunciation_comment = '  \"pronunciation\": string,     // 音标或发音描述，可为空\n'
    meaning_zh_comment = (
        '  \"meaning_zh\": string,        // 中文释义，要求每个义项前必须带有词性缩写（如 \"adj.\"、\"n.\"、\"v.\" 等），多义用分号或换行分隔，例如：\"adj. 优良的；能干的；……；n. 善；好事；……\"\n'
    )
    example_comment = (
        '  \"example\": string            // 一个代表性英文例句，尽量简单，同时附带中文翻译，例如：\"I wear sweatpants at home. 在家时我穿运动休闲裤。\"\n'
    )

    system_prompt = (
        "你是一个精确的英汉词典引擎，请根据用户输入的单词或短语，返回 ONLY JSON，不要包含任何多余文字。\n"
        "JSON 结构严格为：\n"
        "{\n"
        '  \"word\": string,              // 标准词条形式\n'
        + pronunciation_comment
        + meaning_zh_comment
        + '  \"meaning_en\": string,        // 英文释义，可为空\n'
        + '  \"synonyms\": string[],        // 同义词列表，只包含单词，不要解释\n'
        + '  \"past\": string,              // 过去式，可为空\n'
        + '  \"past_participle\": string,   // 过去分词，可为空\n'
        + '  \"present_participle\": string,// 现在分词，可为空\n'
        + '  \"third_person_singular\": string, // 第三人称单数，可为空\n'
        + '  \"comparative\": string,       // 比较级，可为空\n'
        + '  \"superlative\": string,       // 最高级，可为空\n'
        + '  \"plural\": string,            // 复数形式，可为空\n'
        + example_comment
        + "}\n"
        + '确保 meaning_zh 中的每个义项都清晰标明词性（如 "adj."、"n."），并且始终返回合法 JSON。\n'
    )

    user_prompt = f"查询单词或短语：{text}"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.2,
    }

    url = f"{base_url.rstrip('/')}/chat/completions"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {api_key}")

    # 本地开发环境：关闭 SSL 证书校验，避免 macOS 上的 CA 配置问题
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            resp_data = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:  # pragma: no cover - 网络/配置类问题
        raise RuntimeError(f"大模型接口 HTTP 错误：{exc.code}") from exc
    except urllib.error.URLError as exc:  # pragma: no cover
        raise RuntimeError(f"大模型接口网络错误：{exc.reason}") from exc

    try:
        obj = json.loads(resp_data)
        content = obj["choices"][0]["message"]["content"]
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("解析大模型返回内容失败。") from exc

    # content 可能被模型包在 ```json ``` 中，做一次清洗
    content_str = str(content).strip()
    if content_str.startswith("```"):
        # 去掉 ```json ... ``` 包裹
        content_str = content_str.strip("`")
        # 去掉可能的语言标签
        idx = content_str.find("{")
        if idx >= 0:
            content_str = content_str[idx:]

    try:
        data = json.loads(content_str)
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("大模型未返回合法 JSON。") from exc

    if not isinstance(data, dict):
        raise RuntimeError("大模型返回 JSON 结构不是对象。")

    # 做一次轻量兜底，避免前端取值时报错
    def _s(key: str) -> str:
        v = data.get(key)
        return "" if v is None else str(v)

    result: Dict[str, Any] = {
        "word": _s("word"),
        "pronunciation": _s("pronunciation"),
        "meaning_zh": _s("meaning_zh"),
        "meaning_en": _s("meaning_en"),
        "synonyms": data.get("synonyms") or [],
        "past": _s("past"),
        "past_participle": _s("past_participle"),
        "present_participle": _s("present_participle"),
        "third_person_singular": _s("third_person_singular"),
        "comparative": _s("comparative"),
        "superlative": _s("superlative"),
        "plural": _s("plural"),
        "example": _s("example"),
    }
    if not isinstance(result["synonyms"], list):
        result["synonyms"] = []
    result["synonyms"] = [str(x) for x in result["synonyms"] if x]
    return result


@app.route("/api/vocab/llm-query", methods=["POST"])
def api_vocab_llm_query() -> Any:
    """
    使用大语言模型查询单词信息，并返回结构化字段。
    """
    body = request.get_json(silent=True) or {}
    text = str(body.get("text") or "").strip()
    if not text:
        return jsonify({"success": False, "message": "请输入要查询的单词"}), 400

    try:
        if _vocab_input_is_chinese(text):
            return jsonify({"success": False, "message": "当前仅支持英文单词/词组查询"}), 400

        data = _call_llm_for_vocab(text)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500

    return jsonify({"success": True, "data": data})


@app.route("/api/todos/state", methods=["GET"])
def api_todos_get_state() -> Any:
    """
    获取服务端保存的待办事项数据。
    """
    try:
        items = get_all_todos()
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取待办数据失败：{exc}"}), 500

    if items:
        return jsonify({"success": True, "data": {"items": items}})

    try:
        raw = get_app_state(TODOS_STATE_KEY)
    except Exception as exc:  # pylint: disable-broad-except
        return jsonify({"success": False, "message": f"读取待办数据失败：{exc}"}), 500

    if not raw:
        return jsonify({"success": True, "data": DEFAULT_TODOS_STATE})
    try:
        data = json.loads(raw)
    except Exception:
        data = DEFAULT_TODOS_STATE
    if not isinstance(data, dict):
        data = DEFAULT_TODOS_STATE
    data.setdefault("items", [])
    return jsonify({"success": True, "data": data})


@app.route("/api/todos/state", methods=["POST"])
def api_todos_set_state() -> Any:
    """
    覆盖写入待办事项数据。前端每次提交完整 items 列表。

    Expected JSON:
        { "items": [ ...待办项... ] }
    """
    body = request.get_json(silent=True) or {}
    items = body.get("items") or []
    if not isinstance(items, list):
        items = []
    data: Dict[str, Any] = {"items": items}
    try:
        # 统一写入 todos 表
        set_todos_state(items)
        # 兼容旧版：同时更新 app_state，方便回滚或备份
        try:
            payload = json.dumps(data, ensure_ascii=False)
            set_app_state(TODOS_STATE_KEY, payload)
        except Exception:
            pass
        # 日历按 todo_instances 展示：主列表变更后补全「今天」缺失的实例，避免条数不一致
        try:
            _sync_pending_todo_instances_missing_for_date(datetime.now().strftime("%Y-%m-%d"))
        except Exception:
            pass
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"保存待办数据失败：{exc}"}), 500


def main() -> None:
    """
    Application entry point for running the Flask development server.
    - host="0.0.0.0" 允许同一局域网内其他设备（如手机）通过电脑 IP 访问。
    - 端口默认 5001，可用环境变量 PORT 覆盖。
    - 同 Wi-Fi 访问示例：http://<电脑局域网IP>:<PORT>/home （首页会提示推测地址）
    """
    port = int(os.environ.get("PORT", 5001))
    # Start CalDAV hourly sync scheduler only in the reloader "main" process.
    # Flask debug mode may spawn multiple processes due to reloader, so guard to avoid duplicates.
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        _start_caldav_scheduler()
    app.run(host="0.0.0.0", port=port, debug=True)


if __name__ == "__main__":
    main()

