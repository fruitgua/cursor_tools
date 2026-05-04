import os
import re
import sqlite3
import json
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict, Tuple, Any, Set


DB_NAME = "file_remarks.db"


def get_db_path() -> str:
    """
    Get the absolute path to the SQLite database file.

    :return: Absolute database file path.
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_dir, DB_NAME)


def get_connection() -> sqlite3.Connection:
    """
    Create and return a new SQLite connection.

    :return: SQLite connection object.
    """
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _migrate_content_persons_profile_columns(conn: sqlite3.Connection) -> None:
    """Add profile / liked / name_initial columns to legacy content_persons."""
    alters = [
        ("name_initial", "TEXT NOT NULL DEFAULT ''"),
        ("liked", "INTEGER NOT NULL DEFAULT 0"),
        ("gender", "TEXT NOT NULL DEFAULT ''"),
        ("education", "TEXT NOT NULL DEFAULT ''"),
        ("birthday", "TEXT NOT NULL DEFAULT ''"),
        ("real_name", "TEXT NOT NULL DEFAULT ''"),
        ("bio_note", "TEXT NOT NULL DEFAULT ''"),
    ]
    for col, decl in alters:
        try:
            conn.execute(f"ALTER TABLE content_persons ADD COLUMN {col} {decl}")
        except sqlite3.OperationalError:
            pass


def _compute_person_name_initial(display_name: str) -> str:
    """First character -> A–Z for library tabs (pypinyin for CJK; deterministic fallback)."""
    s = (display_name or "").strip()
    if not s:
        return ""
    ch = s[0]
    o = ord(ch)
    if 65 <= o <= 90:
        return ch
    if 97 <= o <= 122:
        return chr(o - 32)
    if 48 <= o <= 57:
        return ""
    # CJK & extension blocks: use pypinyin only. Never guess from Unicode code point — that maps
    # unrelated characters to the same letter (e.g. 吴/周/甜/曾 all -> "C") and breaks A–Z tabs.
    is_cjk = (
        (0x4E00 <= o <= 0x9FFF)
        or (0x3400 <= o <= 0x4DBF)
        or (0x20000 <= o <= 0x2A6DF)
        or (0x3007 == o)
    )

    if is_cjk:
        try:
            from pypinyin import lazy_pinyin, Style

            for style in (Style.FIRST_LETTER, Style.NORMAL):
                arr = lazy_pinyin(ch, style=style)
                if not arr or not arr[0]:
                    continue
                token = str(arr[0]).strip()
                if not token:
                    continue
                c = token[0].upper()
                if len(c) == 1 and "A" <= c <= "Z":
                    return c
        except ImportError:
            pass
        except Exception:
            pass
        return ""
    return ""


def _backfill_content_person_name_initials(conn: sqlite3.Connection) -> None:
    """Recompute name_initial when it differs from _compute_person_name_initial (e.g. after fixing pinyin logic)."""
    cur = conn.execute(
        """
        SELECT id, display_name, COALESCE(name_initial, '') AS ni
        FROM content_persons
        WHERE trim(display_name) != ''
        """
    )
    for row in cur.fetchall():
        dn = str(row["display_name"] or "")
        want = _compute_person_name_initial(dn)
        have = str(row["ni"] or "").strip().upper()
        if want == have:
            continue
        conn.execute(
            "UPDATE content_persons SET name_initial = ? WHERE id = ?",
            (want, str(row["id"])),
        )


def init_db() -> None:
    """
    Initialize the SQLite database, creating tables if they do not exist.

    The table structure:
        remarks (
            path TEXT PRIMARY KEY,
            remark TEXT
        )
    """
    conn = get_connection()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS remarks (
                path TEXT PRIMARY KEY,
                remark TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
            )
            """
        )
        conn.commit()
        # 兼容旧版 notes 表：补充 updated_at 字段
        try:
            conn.execute("ALTER TABLE notes ADD COLUMN updated_at REAL NOT NULL DEFAULT 0")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        # 对历史数据：若 updated_at 为空则回填 created_at
        try:
            conn.execute("UPDATE notes SET updated_at = created_at WHERE updated_at = 0 OR updated_at IS NULL")
            conn.commit()
        except Exception:
            pass
        _migrate_notes_category(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS bookmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
            )
            """
        )
        conn.commit()
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
            )
            """
        )
        conn.commit()
        # 新增：统一存储词汇、标签、待办、日历事件等轻量业务数据的表
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS vocab_words (
                id TEXT PRIMARY KEY,
                word TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'english',
                meaning_zh TEXT NOT NULL DEFAULT '',
                meaning_en TEXT NOT NULL DEFAULT '',
                meaning_raw TEXT NOT NULL DEFAULT '',
                pronunciation TEXT NOT NULL DEFAULT '',
                example TEXT NOT NULL DEFAULT '',
                past_tense TEXT NOT NULL DEFAULT '',
                past_participle TEXT NOT NULL DEFAULT '',
                present_participle TEXT NOT NULL DEFAULT '',
                third_person_singular TEXT NOT NULL DEFAULT '',
                comparative TEXT NOT NULL DEFAULT '',
                superlative TEXT NOT NULL DEFAULT '',
                plural TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '',       -- JSON array string
                synonyms TEXT NOT NULL DEFAULT '',   -- JSON array string
                level INTEGER NOT NULL DEFAULT 1,
                review_count INTEGER NOT NULL DEFAULT 0,
                next_review TEXT NOT NULL DEFAULT '',
                quiz_count INTEGER NOT NULL DEFAULT 0,
                quiz_correct INTEGER NOT NULL DEFAULT 0,
                quiz_last_date TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS vocab_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                scope TEXT NOT NULL DEFAULT 'english'
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                due_time TEXT NOT NULL DEFAULT '',
                complete_date TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                remind_time TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
            )
            """
        )
        conn.commit()
        # 兼容旧版 todos 表：补充 complete_date 字段
        try:
            conn.execute("ALTER TABLE todos ADD COLUMN complete_date TEXT NOT NULL DEFAULT ''")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS calendar_events (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                meta TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS diaries (
                date TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                today_diet TEXT NOT NULL DEFAULT '',
                exercise_summary TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
            )
            """
        )
        try:
            conn.execute("ALTER TABLE diaries ADD COLUMN today_diet TEXT NOT NULL DEFAULT ''")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE diaries ADD COLUMN exercise_summary TEXT NOT NULL DEFAULT ''")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ledger_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                UNIQUE(kind, name)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ledger_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                kind TEXT NOT NULL,
                tag_id INTEGER NOT NULL,
                tag_name_snapshot TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                annotation TEXT NOT NULL DEFAULT '',
                amount REAL NOT NULL DEFAULT 0,
                expense_nature TEXT NOT NULL DEFAULT 'daily',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
            )
            """
        )
        try:
            conn.execute("ALTER TABLE ledger_entries ADD COLUMN annotation TEXT NOT NULL DEFAULT ''")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute(
                "ALTER TABLE ledger_entries ADD COLUMN expense_nature TEXT NOT NULL DEFAULT 'daily'"
            )
            conn.commit()
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("UPDATE ledger_entries SET expense_nature = '' WHERE kind = 'income'")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ledger_budgets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scope TEXT NOT NULL,
                period_start TEXT NOT NULL,
                daily_budget REAL NOT NULL DEFAULT 0,
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                CHECK(scope IN ('week', 'month')),
                UNIQUE(scope, period_start)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ledger_budget_policies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scope TEXT NOT NULL,
                amount_per_period REAL NOT NULL DEFAULT 0,
                range_start TEXT NOT NULL,
                range_end TEXT NOT NULL,
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                CHECK(scope IN ('week', 'month'))
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ledger_budget_cells (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                granularity TEXT NOT NULL,
                period_start TEXT NOT NULL,
                period_end TEXT NOT NULL,
                amount REAL NOT NULL DEFAULT 0,
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                CHECK(granularity IN ('week', 'month')),
                UNIQUE(granularity, period_start)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ledger_entries_archive (
                id INTEGER NOT NULL PRIMARY KEY,
                date TEXT NOT NULL,
                kind TEXT NOT NULL,
                tag_id INTEGER NOT NULL,
                tag_name_snapshot TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                annotation TEXT NOT NULL DEFAULT '',
                amount REAL NOT NULL DEFAULT 0,
                expense_nature TEXT NOT NULL DEFAULT 'daily',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                archived_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_ledger_entries_date ON ledger_entries(date)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_ledger_entries_archive_date ON ledger_entries_archive(date)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS todo_instances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_todo_id TEXT NOT NULL,
                date TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                complete_date TEXT NOT NULL DEFAULT '',
                content_snapshot TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                UNIQUE(source_todo_id, date)
            )
            """
        )
        # 兼容旧版 todo_instances 表：补充 complete_date 字段
        try:
            conn.execute("ALTER TABLE todo_instances ADD COLUMN complete_date TEXT NOT NULL DEFAULT ''")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        try:
            _migrate_dedupe_done_todo_instances(conn)
        except Exception:
            pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ip_access_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                ip TEXT NOT NULL,
                path TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS content_records (
                id TEXT PRIMARY KEY,
                record_type TEXT NOT NULL,
                submit_date TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                creator TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                rating INTEGER NOT NULL DEFAULT 0,
                episode_count TEXT NOT NULL DEFAULT '',
                summary TEXT NOT NULL DEFAULT '',
                review TEXT NOT NULL DEFAULT '',
                original_work TEXT NOT NULL DEFAULT '',
                release_date TEXT NOT NULL DEFAULT '',
                related_series TEXT NOT NULL DEFAULT '',
                cover_url TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT 'manual',
                source_id TEXT NOT NULL DEFAULT '',
                ext_json TEXT NOT NULL DEFAULT '{}',
                list_status TEXT NOT NULL DEFAULT 'done',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                CHECK(record_type IN ('watch', 'book')),
                CHECK(rating >= 0 AND rating <= 5)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS content_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                record_type TEXT NOT NULL DEFAULT 'all',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                CHECK(record_type IN ('watch', 'book', 'all')),
                UNIQUE(name)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS content_record_tags (
                record_id TEXT NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY(record_id, tag_id),
                FOREIGN KEY(record_id) REFERENCES content_records(id) ON DELETE CASCADE,
                FOREIGN KEY(tag_id) REFERENCES content_tags(id) ON DELETE CASCADE
            )
            """
        )
        _migrate_content_records_dr_re_ids(conn)
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_records_type_date
            ON content_records(record_type, submit_date)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_records_title
            ON content_records(title)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_records_creator
            ON content_records(creator)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_records_rating
            ON content_records(rating)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_record_tags_tag_id
            ON content_record_tags(tag_id)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS content_persons (
                id TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                display_name TEXT NOT NULL,
                professions_json TEXT NOT NULL DEFAULT '[]',
                name_initial TEXT NOT NULL DEFAULT '',
                liked INTEGER NOT NULL DEFAULT 0,
                gender TEXT NOT NULL DEFAULT '',
                education TEXT NOT NULL DEFAULT '',
                birthday TEXT NOT NULL DEFAULT '',
                real_name TEXT NOT NULL DEFAULT '',
                bio_note TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                CHECK(scope IN ('watch', 'book')),
                CHECK(liked IN (0, 1))
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS content_record_persons (
                record_id TEXT NOT NULL,
                person_id TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (record_id, person_id),
                FOREIGN KEY (record_id) REFERENCES content_records(id) ON DELETE CASCADE,
                FOREIGN KEY (person_id) REFERENCES content_persons(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_record_persons_person_id
            ON content_record_persons(person_id)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS content_person_deleted_ids (
                id TEXT PRIMARY KEY
            )
            """
        )
        _migrate_content_persons_profile_columns(conn)
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_persons_scope_initial
            ON content_persons(scope, name_initial)
            """
        )
        _migrate_content_persons_from_existing_records(conn)
        _backfill_content_person_name_initials(conn)
        try:
            conn.execute(
                "ALTER TABLE content_records ADD COLUMN list_status TEXT NOT NULL DEFAULT 'done'"
            )
            conn.commit()
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute(
                "ALTER TABLE content_records ADD COLUMN episode_count TEXT NOT NULL DEFAULT ''"
            )
            conn.commit()
        except sqlite3.OperationalError:
            pass
        _migrate_content_tags_share_by_name(conn)
        conn.commit()
    finally:
        conn.close()


PERSON_PUBLIC_ID_RE = re.compile(r"^(AT|WR)(\d{6})$", re.IGNORECASE)


def is_valid_content_person_public_id(s: Any) -> bool:
    return bool(s and PERSON_PUBLIC_ID_RE.match(str(s).strip()))


def normalize_content_person_public_id(s: Any) -> str:
    t = str(s or "").strip().upper()
    if not PERSON_PUBLIC_ID_RE.match(t):
        raise ValueError("invalid content person id")
    return t[:2] + t[2:]


def _person_professions_list(raw: str) -> List[str]:
    try:
        v = json.loads(raw or "[]")
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
    except Exception:
        pass
    return []


def _person_primary_role_label(professions_json: str, person_id: str) -> str:
    labels = {
        "actor": "演员",
        "author": "作者",
        "director": "导演",
        "writer": "脚本",
        "musician": "音乐人",
        "voice_actor": "声优",
    }
    order = ("actor", "author", "director", "writer", "musician", "voice_actor")
    profs = _person_professions_list(professions_json)
    for k in order:
        if k in profs:
            return labels.get(k, k)
    pid = str(person_id or "").strip().upper()
    if pid.startswith("AT"):
        return "演员"
    if pid.startswith("WR"):
        return "作者"
    return "人物"


def _default_primary_profession_for_record_type(record_type: str) -> str:
    rt = str(record_type or "").strip()
    if rt == "book":
        return "author"
    return "actor"


def _creator_name_list_from_record(ext_json: str, creator: str) -> List[str]:
    names: List[str] = []
    try:
        d = json.loads(ext_json or "{}")
        if isinstance(d, dict) and isinstance(d.get("creator_names"), list):
            for x in d["creator_names"]:
                s = str(x).strip()
                if s:
                    names.append(s)
    except Exception:
        pass
    if not names:
        raw = str(creator or "").strip()
        if raw:
            for part in re.split(r"[\s·｜|、,，;；/]+", raw):
                s = part.strip()
                if s:
                    names.append(s)
    seen: Set[str] = set()
    out: List[str] = []
    for n in names:
        k = n.casefold()
        if k in seen:
            continue
        seen.add(k)
        out.append(n)
    return out


def _max_issued_person_sequence(conn: sqlite3.Connection, prefix: str) -> int:
    """Max AT/WR numeric suffix among现存人物与已删除占位，保证删除后不回收编号。"""
    if prefix not in ("AT", "WR"):
        return 0
    glob_pat = f"{prefix}*"
    cur = conn.execute(
        """
        SELECT MAX(seq) AS m FROM (
            SELECT CAST(SUBSTR(id, 3) AS INTEGER) AS seq
            FROM content_persons
            WHERE id GLOB ? AND LENGTH(id) = 8
            UNION ALL
            SELECT CAST(SUBSTR(id, 3) AS INTEGER) AS seq
            FROM content_person_deleted_ids
            WHERE id GLOB ? AND LENGTH(id) = 8
        )
        """,
        (glob_pat, glob_pat),
    )
    row = cur.fetchone()
    try:
        v = row["m"] if row else None
        return int(v) if v is not None else 0
    except (TypeError, ValueError):
        return 0


def _allocate_next_person_id(conn: sqlite3.Connection, prefix: str) -> str:
    if prefix not in ("AT", "WR"):
        raise ValueError("invalid person id prefix")
    n = _max_issued_person_sequence(conn, prefix)
    return prefix + str(n + 1).zfill(6)


def _find_or_create_content_person(conn: sqlite3.Connection, scope: str, display_name: str, primary: str) -> str:
    name = (display_name or "").strip()
    if not name:
        raise ValueError("empty person display name")
    sc = str(scope or "").strip()
    if sc not in ("watch", "book"):
        raise ValueError("invalid person scope")
    pr = str(primary or "").strip()
    if pr not in ("actor", "author"):
        raise ValueError("invalid primary profession")

    def pick_existing(rows: List[Any]) -> Optional[str]:
        for r in rows:
            if pr in _person_professions_list(str(r["professions_json"] or "")):
                return str(r["id"])
        return None

    cur = conn.execute(
        """
        SELECT id, professions_json
        FROM content_persons
        WHERE scope = ? AND display_name = ?
        """,
        (sc, name),
    )
    rows = cur.fetchall()
    hit = pick_existing(rows)
    if hit:
        conn.execute(
            "UPDATE content_persons SET updated_at = strftime('%s', 'now') WHERE id = ?",
            (hit,),
        )
        return hit

    cand = name
    n = 2
    while True:
        cur = conn.execute(
            """
            SELECT id, professions_json
            FROM content_persons
            WHERE scope = ? AND display_name = ?
            """,
            (sc, cand),
        )
        rows = cur.fetchall()
        if not rows:
            break
        hit = pick_existing(rows)
        if hit:
            return hit
        cand = f"{name}（{n}）"
        n += 1
        if n > 500:
            raise ValueError("too many person name collisions")

    pref = "AT" if pr == "actor" else "WR"
    new_id = _allocate_next_person_id(conn, pref)
    prof_json = json.dumps([pr], ensure_ascii=False)
    ni = _compute_person_name_initial(cand)
    conn.execute(
        """
        INSERT INTO content_persons (
            id, scope, display_name, professions_json, name_initial,
            liked, gender, education, birthday, real_name, bio_note,
            created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 0, '', '', '', '', '', strftime('%s', 'now'), strftime('%s', 'now'))
        """,
        (new_id, sc, cand, prof_json, ni),
    )
    return new_id


def sync_content_record_persons(record_id: str, conn: Optional[sqlite3.Connection] = None) -> None:
    """
    Replace content_record_persons links from ext_json.creator_names / creator field.
    watch -> primary profession actor (AT ids); book -> author (WR ids).
    """
    own = conn is None
    if own:
        conn = get_connection()
    try:
        rid = normalize_content_record_public_id(record_id)
        cur = conn.execute(
            "SELECT id, record_type, creator, ext_json FROM content_records WHERE id = ?",
            (rid,),
        )
        row = cur.fetchone()
        if not row:
            return
        rt = str(row["record_type"] or "").strip()
        if rt not in ("watch", "book"):
            return
        primary = _default_primary_profession_for_record_type(rt)
        names = _creator_name_list_from_record(str(row["ext_json"] or "{}"), str(row["creator"] or ""))
        conn.execute("DELETE FROM content_record_persons WHERE record_id = ?", (rid,))
        for i, nm in enumerate(names):
            pid = _find_or_create_content_person(conn, rt, nm, primary)
            conn.execute(
                """
                INSERT OR REPLACE INTO content_record_persons (record_id, person_id, sort_order)
                VALUES (?, ?, ?)
                """,
                (rid, pid, i),
            )
        if own:
            conn.commit()
    except Exception:
        if own:
            conn.rollback()
        raise
    finally:
        if own:
            conn.close()


def _migrate_content_persons_from_existing_records(conn: sqlite3.Connection) -> None:
    """One-time backfill when content_persons is empty."""
    cur = conn.execute("SELECT COUNT(*) AS c FROM content_persons")
    if int(cur.fetchone()["c"] or 0) > 0:
        return
    cur = conn.execute("SELECT id FROM content_records ORDER BY submit_date ASC, id ASC")
    for row in cur.fetchall():
        sync_content_record_persons(str(row["id"]), conn=conn)


def query_content_persons(
    scope: str = "",
    name_kw: str = "",
    letter: str = "",
    page: int = 1,
    page_size: int = 80,
) -> Tuple[List[Dict[str, Any]], int]:
    """List persons with work counts; pagination; optional name + A–Z initial filters."""
    sc = str(scope or "").strip().lower()
    kw = (name_kw or "").strip()
    let = str(letter or "").strip().upper()
    if len(let) != 1 or let < "A" or let > "Z":
        let = ""
    try:
        ps = max(1, min(int(page_size or 80), 100))
    except (TypeError, ValueError):
        ps = 80
    try:
        pg = max(1, int(page or 1))
    except (TypeError, ValueError):
        pg = 1
    offset = (pg - 1) * ps

    clauses: List[str] = ["1=1"]
    params: List[Any] = []
    if sc in ("watch", "book"):
        clauses.append("p.scope = ?")
        params.append(sc)
    if kw:
        clauses.append("p.display_name LIKE ?")
        params.append(f"%{kw}%")
    if let:
        clauses.append("UPPER(TRIM(COALESCE(p.name_initial, ''))) = ?")
        params.append(let)
    where_sql = " AND ".join(clauses)

    conn = get_connection()
    try:
        count_cur = conn.execute(
            f"""
            SELECT COUNT(*) AS c FROM (
                SELECT p.id AS _i
                FROM content_persons p
                LEFT JOIN content_record_persons l ON l.person_id = p.id
                WHERE {where_sql}
                GROUP BY p.id
            ) AS _t
            """,
            tuple(params),
        )
        total = int(count_cur.fetchone()["c"] or 0)

        cur = conn.execute(
            f"""
            SELECT
                p.id,
                p.scope,
                p.display_name,
                p.professions_json,
                p.name_initial,
                p.liked,
                p.gender,
                p.education,
                p.birthday,
                p.real_name,
                p.bio_note,
                COUNT(l.record_id) AS work_count
            FROM content_persons p
            LEFT JOIN content_record_persons l ON l.person_id = p.id
            WHERE {where_sql}
            GROUP BY p.id
            ORDER BY p.liked DESC, p.display_name COLLATE NOCASE ASC
            LIMIT ? OFFSET ?
            """,
            tuple(params) + (ps, offset),
        )
        out: List[Dict[str, Any]] = []
        for r in cur.fetchall():
            out.append(
                {
                    "id": str(r["id"]),
                    "scope": str(r["scope"] or ""),
                    "display_name": str(r["display_name"] or ""),
                    "professions_json": str(r["professions_json"] or "[]"),
                    "name_initial": str(r["name_initial"] or ""),
                    "liked": int(r["liked"] or 0),
                    "gender": str(r["gender"] or ""),
                    "education": str(r["education"] or ""),
                    "birthday": str(r["birthday"] or ""),
                    "real_name": str(r["real_name"] or ""),
                    "bio_note": str(r["bio_note"] or ""),
                    "work_count": int(r["work_count"] or 0),
                }
            )
        return out, total
    finally:
        conn.close()


def get_content_person(person_id: str) -> Optional[Dict[str, Any]]:
    """Single person row + work_count + primary_role_label for drawer."""
    pid = normalize_content_person_public_id(person_id)
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT
                p.id, p.scope, p.display_name, p.professions_json, p.name_initial, p.liked,
                p.gender, p.education, p.birthday, p.real_name, p.bio_note,
                p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM content_record_persons lp WHERE lp.person_id = p.id) AS work_count
            FROM content_persons p
            WHERE p.id = ?
            LIMIT 1
            """,
            (pid,),
        )
        r = cur.fetchone()
        if not r:
            return None
        pj = str(r["professions_json"] or "[]")
        return {
            "id": str(r["id"]),
            "scope": str(r["scope"] or ""),
            "display_name": str(r["display_name"] or ""),
            "professions_json": pj,
            "name_initial": str(r["name_initial"] or ""),
            "liked": int(r["liked"] or 0),
            "gender": str(r["gender"] or ""),
            "education": str(r["education"] or ""),
            "birthday": str(r["birthday"] or ""),
            "real_name": str(r["real_name"] or ""),
            "bio_note": str(r["bio_note"] or ""),
            "work_count": int(r["work_count"] or 0),
            "primary_role_label": _person_primary_role_label(pj, str(r["id"])),
        }
    finally:
        conn.close()


def get_content_person_works(person_id: str) -> List[Dict[str, Any]]:
    """Linked works: rating desc, then submit_date desc."""
    pid = normalize_content_person_public_id(person_id)
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT r.id, r.title, r.record_type, r.submit_date, r.rating, r.list_status
            FROM content_records r
            INNER JOIN content_record_persons l ON l.record_id = r.id
            WHERE l.person_id = ?
            ORDER BY r.rating DESC, r.submit_date DESC, r.updated_at DESC, r.id DESC
            """,
            (pid,),
        )
        return [
            {
                "id": str(r["id"]),
                "title": str(r["title"] or "").strip(),
                "record_type": str(r["record_type"] or "").strip(),
                "submit_date": str(r["submit_date"] or "").strip(),
                "rating": int(r["rating"] or 0),
                "list_status": str(r["list_status"] or "done"),
            }
            for r in cur.fetchall()
        ]
    finally:
        conn.close()


def delete_content_person_when_no_links(person_id: str) -> Tuple[bool, str]:
    """
    Delete a person row only when no content_record_persons links exist.
    Records the id in content_person_deleted_ids so new allocations never reuse the number.
    """
    try:
        pid = normalize_content_person_public_id(person_id)
    except ValueError:
        return False, "人物 ID 格式无效"
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT COUNT(*) AS c FROM content_record_persons WHERE person_id = ?",
            (pid,),
        )
        if int(cur.fetchone()["c"] or 0) > 0:
            return False, "该人物仍有关联作品，无法删除。请先在光影文卷中移除相关作品的创作者后再试。"

        cur2 = conn.execute("SELECT 1 FROM content_persons WHERE id = ?", (pid,))
        if not cur2.fetchone():
            return False, "人物不存在或已删除"

        conn.execute("BEGIN")
        conn.execute("DELETE FROM content_persons WHERE id = ?", (pid,))
        conn.execute("INSERT OR IGNORE INTO content_person_deleted_ids (id) VALUES (?)", (pid,))
        conn.commit()
        return True, ""
    except Exception as exc:  # pylint: disable=broad-except
        try:
            conn.rollback()
        except Exception:
            pass
        return False, f"删除失败：{exc}"
    finally:
        conn.close()


def toggle_content_person_liked(person_id: str) -> Optional[int]:
    """Flip liked flag; returns new value 0/1, or None if person missing."""
    pid = normalize_content_person_public_id(person_id)
    conn = get_connection()
    try:
        cur = conn.execute("SELECT liked FROM content_persons WHERE id = ?", (pid,))
        row = cur.fetchone()
        if not row:
            return None
        newv = 0 if int(row["liked"] or 0) else 1
        conn.execute(
            """
            UPDATE content_persons
            SET liked = ?, updated_at = strftime('%s', 'now')
            WHERE id = ?
            """,
            (newv, pid),
        )
        conn.commit()
        return newv
    finally:
        conn.close()


def update_content_person_profile(
    person_id: str,
    gender: str = "",
    education: str = "",
    birthday: str = "",
    real_name: str = "",
    bio_note: str = "",
) -> bool:
    """Update basic profile fields (not display_name)."""
    pid = normalize_content_person_public_id(person_id)
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            UPDATE content_persons
            SET gender = ?, education = ?, birthday = ?, real_name = ?, bio_note = ?,
                updated_at = strftime('%s', 'now')
            WHERE id = ?
            """,
            (
                str(gender or "").strip(),
                str(education or "").strip(),
                str(birthday or "").strip(),
                str(real_name or "").strip(),
                str(bio_note or "").strip(),
                pid,
            ),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def search_content_person_suggest(
    keyword: str,
    record_type: str,
    exclude_names: Optional[List[str]] = None,
    limit: int = 40,
) -> List[Dict[str, Any]]:
    """Match content_persons.display_name for creator picker (LIKE %kw%)."""
    kw = (keyword or "").strip()
    if not kw:
        return []
    rt = str(record_type or "").strip().lower()
    if rt not in ("watch", "book"):
        return []
    try:
        lim = int(limit)
    except (TypeError, ValueError):
        lim = 40
    lim = max(1, min(lim, 80))
    exclude_cf: Set[str] = set()
    for x in exclude_names or []:
        s = str(x or "").strip()
        if s:
            exclude_cf.add(s.casefold())
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT id, display_name, professions_json, scope
            FROM content_persons
            WHERE scope = ? AND display_name LIKE ?
            ORDER BY display_name COLLATE NOCASE ASC
            LIMIT ?
            """,
            (rt, f"%{kw}%", lim * 3),
        )
        out: List[Dict[str, Any]] = []
        for r in cur.fetchall():
            dn = str(r["display_name"] or "").strip()
            if not dn or dn.casefold() in exclude_cf:
                continue
            out.append(
                {
                    "id": str(r["id"]),
                    "display_name": dn,
                    "professions_json": str(r["professions_json"] or "[]"),
                    "scope": str(r["scope"] or ""),
                }
            )
            if len(out) >= lim:
                break
        return out
    finally:
        conn.close()


def get_remark(path: str) -> Optional[str]:
    """
    Retrieve remark text for a specific file path.

    :param path: Absolute file path as unique key.
    :return: Remark string if exists, otherwise None.
    """
    conn = get_connection()
    try:
        cur = conn.execute("SELECT remark FROM remarks WHERE path = ?", (path,))
        row = cur.fetchone()
        if row is None:
            return None
        return row["remark"]
    finally:
        conn.close()


def set_remark(path: str, remark: str) -> None:
    """
    Insert or update remark text for a file path.

    :param path: Absolute file path as unique key.
    :param remark: Remark text to store.
    """
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO remarks (path, remark)
            VALUES (?, ?)
            ON CONFLICT(path) DO UPDATE SET remark = excluded.remark
            """,
            (path, remark),
        )
        conn.commit()
    finally:
        conn.close()


def get_app_state(key: str) -> Optional[str]:
    """
    Retrieve arbitrary application state by key.

    :param key: Logical key name, e.g. "checkin_data".
    :return: JSON string value if exists, otherwise None.
    """
    conn = get_connection()
    try:
        cur = conn.execute("SELECT value FROM app_state WHERE key = ?", (key,))
        row = cur.fetchone()
        if row is None:
            return None
        return row["value"]
    finally:
        conn.close()


def set_app_state(key: str, value: str) -> None:
    """
    Insert or update arbitrary application state by key.

    :param key: Logical key name, e.g. "checkin_data".
    :param value: JSON string to store.
    """
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO app_state (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = strftime('%s', 'now')
            """,
            (key, value),
        )
        conn.commit()
    finally:
        conn.close()


def get_all_vocab_words() -> Tuple[List[Dict], List[Dict]]:
    """
    从 vocab_words / vocab_tags 表加载单词本完整状态。

    :return: (items, tags)
    """
    conn = get_connection()
    try:
        # 词汇列表
        cur = conn.execute(
            """
            SELECT
                id,
                word,
                type,
                meaning_zh,
                meaning_en,
                meaning_raw,
                pronunciation,
                example,
                past_tense,
                past_participle,
                present_participle,
                third_person_singular,
                comparative,
                superlative,
                plural,
                tags,
                synonyms,
                level,
                review_count,
                next_review,
                quiz_count,
                quiz_correct,
                quiz_last_date
            FROM vocab_words
            ORDER BY created_at ASC, id ASC
            """
        )
        rows = cur.fetchall()
        items: List[Dict] = []
        for row in rows:
            try:
                tags_raw = row["tags"] or ""
                syn_raw = row["synonyms"] or ""
                tags = json.loads(tags_raw) if tags_raw else []
                synonyms = json.loads(syn_raw) if syn_raw else []
            except Exception:
                tags = []
                synonyms = []
            items.append(
                {
                    "id": row["id"],
                    "word": row["word"] or "",
                    "type": row["type"] or "english",
                    "meaningZh": row["meaning_zh"] or "",
                    "meaningEn": row["meaning_en"] or "",
                    "meaning": row["meaning_raw"] or "",
                    "pronunciation": row["pronunciation"] or "",
                    "example": row["example"] or "",
                    "pastTense": row["past_tense"] or "",
                    "pastParticiple": row["past_participle"] or "",
                    "presentParticiple": row["present_participle"] or "",
                    "thirdPersonSingular": row["third_person_singular"] or "",
                    "comparative": row["comparative"] or "",
                    "superlative": row["superlative"] or "",
                    "plural": row["plural"] or "",
                    "tags": tags if isinstance(tags, list) else [],
                    "synonyms": synonyms if isinstance(synonyms, list) else [],
                    "level": row["level"],
                    "reviewCount": row["review_count"],
                    "nextReview": row["next_review"] or "",
                    "quizCount": row["quiz_count"],
                    "quizCorrect": row["quiz_correct"],
                    "quizLastDate": row["quiz_last_date"] or "",
                }
            )

        # 标签列表
        cur = conn.execute(
            """
            SELECT id, name, scope
            FROM vocab_tags
            ORDER BY name ASC, id ASC
            """
        )
        rows = cur.fetchall()
        tags: List[Dict] = [
            {"name": row["name"] or "", "scope": row["scope"] or "english"}
            for row in rows
        ]
        return items, tags
    finally:
        conn.close()


def set_vocab_state(items: List[Dict], tags: List[Dict]) -> None:
    """
    覆盖写入单词本状态到 vocab_words / vocab_tags 表。
    前端每次提交完整 items / tags 列表。
    """
    conn = get_connection()
    try:
        conn.execute("BEGIN")
        conn.execute("DELETE FROM vocab_words")
        conn.execute("DELETE FROM vocab_tags")

        for it in items:
            if not isinstance(it, dict):
                continue
            vid = str(it.get("id") or "").strip()
            word = str(it.get("word") or "").strip()
            if not vid or not word:
                continue
            vtype = str(it.get("type") or "english").strip() or "english"
            meaning_zh = str(it.get("meaningZh") or it.get("meaning_zh") or "").strip()
            meaning_en = str(it.get("meaningEn") or it.get("meaning_en") or "").strip()
            meaning_raw = str(it.get("meaning") or "").strip()
            pronunciation = str(it.get("pronunciation") or "").strip()
            example = str(it.get("example") or "").strip()
            past_tense = str(it.get("pastTense") or it.get("past_tense") or "").strip()
            past_participle = str(
                it.get("pastParticiple") or it.get("past_participle") or ""
            ).strip()
            present_participle = str(
                it.get("presentParticiple") or it.get("present_participle") or ""
            ).strip()
            third_person_singular = str(
                it.get("thirdPersonSingular") or it.get("third_person_singular") or ""
            ).strip()
            comparative = str(
                it.get("comparative") or it.get("comparative_form") or ""
            ).strip()
            superlative = str(
                it.get("superlative") or it.get("superlative_form") or ""
            ).strip()
            plural = str(it.get("plural") or "").strip()
            tag_list = it.get("tags") or []
            syn_list = it.get("synonyms") or []
            try:
                tags_json = json.dumps(tag_list, ensure_ascii=False)
            except Exception:
                tags_json = "[]"
            try:
                syn_json = json.dumps(syn_list, ensure_ascii=False)
            except Exception:
                syn_json = "[]"
            level = int(it.get("level") or 1)
            review_count = int(it.get("reviewCount") or it.get("review_count") or 0)
            next_review = str(it.get("nextReview") or it.get("next_review") or "").strip()
            quiz_count = int(it.get("quizCount") or it.get("quiz_count") or 0)
            quiz_correct = int(it.get("quizCorrect") or it.get("quiz_correct") or 0)
            quiz_last_date = str(
                it.get("quizLastDate") or it.get("quiz_last_date") or ""
            ).strip()

            conn.execute(
                """
                INSERT INTO vocab_words (
                    id, word, type,
                    meaning_zh, meaning_en, meaning_raw,
                    pronunciation, example,
                    past_tense, past_participle, present_participle,
                    third_person_singular, comparative, superlative, plural,
                    tags, synonyms,
                    level, review_count, next_review,
                    quiz_count, quiz_correct, quiz_last_date,
                    created_at, updated_at
                ) VALUES (
                    ?, ?, ?,
                    ?, ?, ?,
                    ?, ?,
                    ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?,
                    ?, ?, ?,
                    ?, ?, ?,
                    strftime('%s', 'now'), strftime('%s', 'now')
                )
                ON CONFLICT(id) DO UPDATE SET
                    word = excluded.word,
                    type = excluded.type,
                    meaning_zh = excluded.meaning_zh,
                    meaning_en = excluded.meaning_en,
                    meaning_raw = excluded.meaning_raw,
                    pronunciation = excluded.pronunciation,
                    example = excluded.example,
                    past_tense = excluded.past_tense,
                    past_participle = excluded.past_participle,
                    present_participle = excluded.present_participle,
                    third_person_singular = excluded.third_person_singular,
                    comparative = excluded.comparative,
                    superlative = excluded.superlative,
                    plural = excluded.plural,
                    tags = excluded.tags,
                    synonyms = excluded.synonyms,
                    level = excluded.level,
                    review_count = excluded.review_count,
                    next_review = excluded.next_review,
                    quiz_count = excluded.quiz_count,
                    quiz_correct = excluded.quiz_correct,
                    quiz_last_date = excluded.quiz_last_date,
                    updated_at = excluded.updated_at
                """,
                (
                    vid,
                    word,
                    vtype,
                    meaning_zh,
                    meaning_en,
                    meaning_raw,
                    pronunciation,
                    example,
                    past_tense,
                    past_participle,
                    present_participle,
                    third_person_singular,
                    comparative,
                    superlative,
                    plural,
                    tags_json,
                    syn_json,
                    level,
                    review_count,
                    next_review,
                    quiz_count,
                    quiz_correct,
                    quiz_last_date,
                ),
            )

        seen_tag_keys = set()
        for t in tags:
            if not isinstance(t, dict):
                continue
            name = str(t.get("name") or "").strip()
            scope = str(t.get("scope") or "english").lower()
            if scope not in ("english", "chinese"):
                scope = "english"
            if not name:
                continue
            key = (name, scope)
            if key in seen_tag_keys:
                continue
            seen_tag_keys.add(key)
            conn.execute(
                "INSERT INTO vocab_tags (name, scope) VALUES (?, ?)", (name, scope)
            )

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_all_todos() -> List[Dict]:
    """
    从 todos 表加载所有待办事项，按创建时间排序。
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT
                id,
                content,
                status,
                due_time,
                complete_date,
                category,
                remind_time,
                created_at,
                updated_at
            FROM todos
            ORDER BY created_at ASC, id ASC
            """
        )
        rows = cur.fetchall()
        items: List[Dict] = []
        for row in rows:
            complete_date = row["complete_date"] or ""
            # 兼容历史数据：旧版未持久化 complete_date，done 状态时回退到 updated_at 日期
            if not complete_date and (row["status"] or "") == "done" and row["updated_at"]:
                try:
                    ts = float(row["updated_at"])
                    dt = datetime.fromtimestamp(ts)
                    complete_date = dt.strftime("%Y/%m/%d")
                except Exception:
                    complete_date = ""
            items.append(
                {
                    "id": row["id"],
                    "content": row["content"] or "",
                    "status": row["status"] or "pending",
                    "dueTime": row["due_time"] or "",
                    "completeDate": complete_date,
                    "category": row["category"] or "",
                    "remindTime": row["remind_time"] or "",
                }
            )
        return items
    finally:
        conn.close()


def set_todos_state(items: List[Dict]) -> None:
    """
    覆盖写入待办事项列表到 todos 表。
    """
    conn = get_connection()
    try:
        conn.execute("BEGIN")
        conn.execute("DELETE FROM todos")

        for it in items:
            if not isinstance(it, dict):
                continue
            tid = str(it.get("id") or "").strip()
            content = str(it.get("content") or "").strip()
            if not tid or not content:
                continue
            status = str(it.get("status") or "pending").strip() or "pending"
            due_time = str(it.get("dueTime") or it.get("due_time") or "").strip()
            complete_date = str(it.get("completeDate") or it.get("complete_date") or "").strip()
            category = str(it.get("category") or "").strip()
            remind_time = str(it.get("remindTime") or it.get("remind_time") or "").strip()

            conn.execute(
                """
                INSERT INTO todos (
                    id,
                    content,
                    status,
                    due_time,
                    complete_date,
                    category,
                    remind_time,
                    created_at,
                    updated_at
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now')
                )
                ON CONFLICT(id) DO UPDATE SET
                    content = excluded.content,
                    status = excluded.status,
                    due_time = excluded.due_time,
                    complete_date = excluded.complete_date,
                    category = excluded.category,
                    remind_time = excluded.remind_time,
                    updated_at = excluded.updated_at
                """,
                (tid, content, status, due_time, complete_date, category, remind_time),
            )

        # 主待办已删除时，清理仍挂在日历上的孤儿实例，避免月历待办数不更新
        conn.execute(
            """
            DELETE FROM todo_instances
            WHERE NOT EXISTS (SELECT 1 FROM todos t WHERE t.id = todo_instances.source_todo_id)
            """
        )

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_calendar_events() -> Dict[str, Any]:
    """
    从 calendar_events 表加载所有事件，组装为与旧 CHECKIN_STATE 兼容的结构：
    - events: 仍然留给前端原有事件结构使用（目前可先置空）
    - records: 从 kind='record' 类型映射（如有需要后续细化）
    - dateLabels: 从 kind='label' 类型构建 specific/annual。
    为保持轻量，这里先将所有事件按 date 聚合到 specific 中。
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT id, date, kind, title, content, meta
            FROM calendar_events
            ORDER BY date ASC, created_at ASC
            """
        )
        rows = cur.fetchall()
        events: List[Dict] = []
        records: List[Dict] = []
        specific: Dict[str, Any] = {}
        annual: Dict[str, Any] = {}

        for row in rows:
            kind = row["kind"] or ""
            date_str = row["date"] or ""
            meta_json = row["meta"] or ""
            try:
                meta = json.loads(meta_json) if meta_json else {}
            except Exception:
                meta = {}
            base = {
                "id": row["id"],
                "date": date_str,
                "kind": kind,
                "title": row["title"] or "",
                "content": row["content"] or "",
                "meta": meta,
            }
            # 简单映射：label -> dateLabels.specific，record -> records，其它暂放入 events
            if kind == "label":
                if date_str:
                    specific.setdefault(date_str, []).append(base)
            elif kind == "record":
                records.append(base)
            else:
                events.append(base)

        return {
            "events": events,
            "records": records,
            "dateLabels": {
                "specific": specific,
                "annual": annual,
            },
        }
    finally:
        conn.close()


def set_calendar_state(data: Dict[str, Any]) -> None:
    """
    覆盖写入日历打卡状态到 calendar_events 表。
    目前仅将 dateLabels.specific/annual 转化为 label 事件保存，其余 events/records 预留。
    """
    conn = get_connection()
    try:
        conn.execute("BEGIN")
        conn.execute("DELETE FROM calendar_events")

        date_labels = data.get("dateLabels") or {}
        specific = date_labels.get("specific") or {}
        annual = date_labels.get("annual") or {}

        # 将 specific 中的每个日期的标签写入表
        for date_str, items in specific.items():
            if not isinstance(items, list):
                continue
            for it in items:
                if not isinstance(it, dict):
                    continue
                eid = str(it.get("id") or "").strip() or f"lbl-{date_str}"
                title = str(it.get("title") or "").strip()
                content = str(it.get("content") or "").strip()
                meta = it.get("meta") or {}
                try:
                    meta_json = json.dumps(meta, ensure_ascii=False)
                except Exception:
                    meta_json = "{}"
                conn.execute(
                    """
                    INSERT INTO calendar_events (
                        id,
                        date,
                        kind,
                        title,
                        content,
                        meta,
                        created_at,
                        updated_at
                    ) VALUES (
                        ?, ?, 'label', ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now')
                    )
                    ON CONFLICT(id) DO UPDATE SET
                        date = excluded.date,
                        kind = excluded.kind,
                        title = excluded.title,
                        content = excluded.content,
                        meta = excluded.meta,
                        updated_at = excluded.updated_at
                    """,
                    (eid, date_str, title, content, meta_json),
                )

        # annual 目前仅占位，若后续有需要可展开为重复事件
        # for key, items in annual.items(): ...

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _migrate_notes_category(conn: sqlite3.Connection) -> None:
    """
    Migrate historical notes: set category to '其他' if empty.

    Note: categories are user-managed now, so we no longer force them into a fixed whitelist.
    """
    try:
        conn.execute(
            """
            UPDATE notes SET category = '其他'
            WHERE category IS NULL OR category = ''
            """
        )
        conn.commit()
    except sqlite3.OperationalError:
        pass


def count_notes_in_category(category: str) -> int:
    """Count notes in a given category."""
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT COUNT(1) AS cnt FROM notes WHERE category = ?",
            (category or "",),
        )
        row = cur.fetchone()
        return int(row["cnt"] or 0) if row else 0
    finally:
        conn.close()


def rename_notes_category(old_category: str, new_category: str) -> int:
    """Rename category for all notes. Returns affected rows."""
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE notes SET category = ? WHERE category = ?",
            (new_category or "", old_category or ""),
        )
        conn.commit()
        return int(cur.rowcount or 0)
    finally:
        conn.close()


def get_all_notes() -> list:
    """
    Retrieve all notes ordered by created_at descending.

    :return: List of dicts with id, title, category, content, created_at.
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, title, category, content, created_at, updated_at FROM notes ORDER BY created_at DESC"
        )
        rows = cur.fetchall()
        return [
            {
                "id": row["id"],
                "title": row["title"] or "",
                "category": row["category"] or "",
                "content": row["content"] or "",
                "created_at": row["created_at"],
                "updated_at": row["updated_at"] if row["updated_at"] is not None else row["created_at"],
            }
            for row in rows
        ]
    finally:
        conn.close()


def get_note(note_id: int) -> Optional[dict]:
    """
    Get a single note by id.

    :param note_id: Note id.
    :return: Note dict or None.
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, title, category, content, created_at, updated_at FROM notes WHERE id = ?",
            (note_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "title": row["title"] or "",
            "category": row["category"] or "",
            "content": row["content"] or "",
            "created_at": row["created_at"],
            "updated_at": row["updated_at"] if row["updated_at"] is not None else row["created_at"],
        }
    finally:
        conn.close()


def add_note(title: str, category: str, content: str) -> int:
    """
    Insert a new note.

    :return: The id of the inserted row.
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO notes (title, category, content, updated_at) VALUES (?, ?, ?, strftime('%s', 'now'))",
            (title or "", category or "", content or ""),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def update_note(note_id: int, title: str, category: str, content: str) -> bool:
    """
    Update an existing note.

    :return: True if updated, False if not found.
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            UPDATE notes SET title = ?, category = ?, content = ?, updated_at = strftime('%s', 'now')
            WHERE id = ?
            """,
            (title or "", category or "", content or "", note_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_note(note_id: int) -> bool:
    """
    Delete a note by id.

    :return: True if deleted, False if not found.
    """
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def get_all_bookmarks() -> list:
    """
    Retrieve all bookmarks ordered by id.
    :return: List of dicts with id, title, url, category, created_at.
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, title, url, category, created_at FROM bookmarks ORDER BY id ASC"
        )
        rows = cur.fetchall()
        return [
            {
                "id": row["id"],
                "title": row["title"] or "",
                "url": row["url"] or "",
                "category": row["category"] or "",
                "created_at": row["created_at"],
            }
            for row in rows
        ]
    finally:
        conn.close()


def get_bookmark(bookmark_id: int) -> Optional[dict]:
    """Get a single bookmark by id."""
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, title, url, category, created_at FROM bookmarks WHERE id = ?",
            (bookmark_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "title": row["title"] or "",
            "url": row["url"] or "",
            "category": row["category"] or "",
            "created_at": row["created_at"],
        }
    finally:
        conn.close()


def add_bookmark(title: str, url: str, category: str = "") -> int:
    """Insert a new bookmark. Returns the id."""
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO bookmarks (title, url, category) VALUES (?, ?, ?)",
            (title or "", url or "", category or ""),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def update_bookmark(bookmark_id: int, title: str, url: str, category: str = "") -> bool:
    """Update an existing bookmark."""
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE bookmarks SET title = ?, url = ?, category = ? WHERE id = ?",
            (title or "", url or "", category or "", bookmark_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_bookmark(bookmark_id: int) -> bool:
    """Delete a bookmark by id."""
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM bookmarks WHERE id = ?", (bookmark_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def swap_bookmarks(bookmark_id1: int, bookmark_id2: int) -> bool:
    """Swap the content of two bookmarks."""
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, title, url, category FROM bookmarks WHERE id IN (?, ?)",
            (bookmark_id1, bookmark_id2),
        )
        rows = cur.fetchall()
        if len(rows) != 2:
            return False
        data = {
            row["id"]: {
                "title": row["title"] or "",
                "url": row["url"] or "",
                "category": row["category"] or "",
            }
            for row in rows
        }
        if bookmark_id1 not in data or bookmark_id2 not in data:
            return False
        d1, d2 = data[bookmark_id1], data[bookmark_id2]
        conn.execute(
            "UPDATE bookmarks SET title = ?, url = ?, category = ? WHERE id = ?",
            (d2["title"], d2["url"], d2["category"] or "", bookmark_id1),
        )
        conn.execute(
            "UPDATE bookmarks SET title = ?, url = ?, category = ? WHERE id = ?",
            (d1["title"], d1["url"], d1["category"] or "", bookmark_id2),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def update_path(old_path: str, new_path: str) -> None:
    """
    Update the key path when a file is renamed.

    :param old_path: Original absolute file path.
    :param new_path: New absolute file path.
    """
    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE remarks SET path = ? WHERE path = ?
            """,
            (new_path, old_path),
        )
        conn.commit()
    finally:
        conn.close()


def add_ip_access_log(ts: str, ip: str, path: str) -> None:
    """Append one access log row (ts is a formatted string)."""
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO ip_access_logs (ts, ip, path) VALUES (?, ?, ?)",
            (ts or "", ip or "", path or ""),
        )
        conn.commit()
    finally:
        conn.close()


def count_distinct_access_ips() -> int:
    """Return distinct IP count from access logs."""
    conn = get_connection()
    try:
        cur = conn.execute("SELECT COUNT(DISTINCT ip) AS c FROM ip_access_logs")
        row = cur.fetchone()
        return int(row["c"] or 0) if row is not None else 0
    finally:
        conn.close()


def get_recent_online_ip_stats(within_minutes: int = 15) -> Tuple[int, List[str]]:
    """
    基于 ip_access_logs.ts（YYYY-MM-DD HH:MM:SS），统计最近 within_minutes 内有过请求的独立 IP。
    用于首页「在线链接」口径（无长连接时以近期访问近似在线）。
    返回 (数量, IP 列表升序)。
    """
    try:
        mins = int(within_minutes)
    except Exception:
        mins = 15
    mins = max(1, min(mins, 24 * 60))
    cutoff = (datetime.now() - timedelta(minutes=mins)).strftime("%Y-%m-%d %H:%M:%S")
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT DISTINCT TRIM(ip) AS ip
            FROM ip_access_logs
            WHERE ts >= ? AND TRIM(COALESCE(ip, '')) <> ''
            ORDER BY ip ASC
            """,
            (cutoff,),
        )
        ips: List[str] = []
        for row in cur.fetchall():
            v = str(row["ip"] or "").strip()
            if v:
                ips.append(v)
        return (len(ips), ips)
    finally:
        conn.close()


def count_ip_access_logs() -> int:
    """Return total access log rows."""
    conn = get_connection()
    try:
        cur = conn.execute("SELECT COUNT(1) AS c FROM ip_access_logs")
        row = cur.fetchone()
        return int(row["c"] or 0) if row is not None else 0
    finally:
        conn.close()


def get_ip_access_logs(limit: int = 20, offset: int = 0) -> List[Dict]:
    """Get access logs ordered by newest first."""
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT id, ts, ip, path
            FROM ip_access_logs
            ORDER BY id DESC
            LIMIT ? OFFSET ?
            """,
            (int(limit), int(offset)),
        )
        rows = cur.fetchall()
        return [
            {"id": row["id"], "ts": row["ts"] or "", "ip": row["ip"] or "", "path": row["path"] or ""}
            for row in rows
        ]
    finally:
        conn.close()


def list_distinct_ips_in_log_range(start_ts: str, end_ts: str) -> List[str]:
    """
    在给定时间范围内（含端点，ts 为 YYYY-MM-DD HH:MM:SS 字符串）出现过的访问 IP，升序去重。
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT DISTINCT TRIM(ip) AS ip
            FROM ip_access_logs
            WHERE ts >= ? AND ts <= ? AND TRIM(ip) <> ''
            ORDER BY ip ASC
            """,
            (start_ts or "", end_ts or ""),
        )
        out: List[str] = []
        for row in cur.fetchall():
            v = str(row["ip"] or "").strip()
            if v:
                out.append(v)
        return out
    finally:
        conn.close()


def count_ip_access_logs_filtered(start_ts: str, end_ts: str, ip: Optional[str] = None) -> int:
    """统计时间范围内的访问日志条数，可选按 IP 精确匹配。"""
    conn = get_connection()
    try:
        ip_val = (ip or "").strip()
        if ip_val:
            cur = conn.execute(
                """
                SELECT COUNT(1) AS c
                FROM ip_access_logs
                WHERE ts >= ? AND ts <= ? AND ip = ?
                """,
                (start_ts or "", end_ts or "", ip_val),
            )
        else:
            cur = conn.execute(
                """
                SELECT COUNT(1) AS c
                FROM ip_access_logs
                WHERE ts >= ? AND ts <= ?
                """,
                (start_ts or "", end_ts or ""),
            )
        row = cur.fetchone()
        return int(row["c"] or 0) if row is not None else 0
    finally:
        conn.close()


def get_ip_access_logs_filtered(
    limit: int, offset: int, start_ts: str, end_ts: str, ip: Optional[str] = None
) -> List[Dict]:
    """分页查询时间范围内的访问日志，可选按 IP 精确匹配。"""
    conn = get_connection()
    try:
        ip_val = (ip or "").strip()
        if ip_val:
            cur = conn.execute(
                """
                SELECT id, ts, ip, path
                FROM ip_access_logs
                WHERE ts >= ? AND ts <= ? AND ip = ?
                ORDER BY id DESC
                LIMIT ? OFFSET ?
                """,
                (start_ts or "", end_ts or "", ip_val, int(limit), int(offset)),
            )
        else:
            cur = conn.execute(
                """
                SELECT id, ts, ip, path
                FROM ip_access_logs
                WHERE ts >= ? AND ts <= ?
                ORDER BY id DESC
                LIMIT ? OFFSET ?
                """,
                (start_ts or "", end_ts or "", int(limit), int(offset)),
            )
        rows = cur.fetchall()
        return [
            {"id": row["id"], "ts": row["ts"] or "", "ip": row["ip"] or "", "path": row["path"] or ""}
            for row in rows
        ]
    finally:
        conn.close()


def get_diary(date: str) -> Optional[Dict[str, Any]]:
    """Get diary by date (YYYY-MM-DD)."""
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT date, title, content, today_diet, exercise_summary, created_at, updated_at FROM diaries WHERE date = ?",
            (date or "",),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return {
            "date": row["date"],
            "title": row["title"] or "",
            "content": row["content"] or "",
            "today_diet": row["today_diet"] if "today_diet" in row.keys() else "",
            "exercise_summary": row["exercise_summary"] if "exercise_summary" in row.keys() else "",
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
    finally:
        conn.close()


def upsert_diary(
    date: str,
    title: str,
    content: str,
    today_diet: str = "",
    exercise_summary: str = "",
) -> None:
    """Insert or update diary for a date."""
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO diaries (date, title, content, today_diet, exercise_summary)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                title = excluded.title,
                content = excluded.content,
                today_diet = excluded.today_diet,
                exercise_summary = excluded.exercise_summary,
                updated_at = strftime('%s', 'now')
            """,
            (date or "", title or "", content or "", today_diet or "", exercise_summary or ""),
        )
        conn.commit()
    finally:
        conn.close()


def list_diaries_between(start_date: str, end_date: str) -> List[Dict[str, Any]]:
    """List diaries between start_date and end_date (inclusive), ordered by date desc."""
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT date, title, created_at, updated_at
            FROM diaries
            WHERE date >= ? AND date <= ?
            ORDER BY date DESC
            """,
            (start_date or "", end_date or ""),
        )
        rows = cur.fetchall()
        return [
            {
                "date": row["date"],
                "title": row["title"] or "",
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]
    finally:
        conn.close()


def get_ledger_tags(kind: str) -> List[Dict[str, Any]]:
    """Get ledger tags by kind (income/expense)."""
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, kind, name, created_at FROM ledger_tags WHERE kind = ? ORDER BY name ASC",
            (kind or "",),
        )
        rows = cur.fetchall()
        return [
            {
                "id": row["id"],
                "kind": row["kind"] or "",
                "name": row["name"] or "",
                "created_at": row["created_at"],
            }
            for row in rows
        ]
    finally:
        conn.close()


def add_ledger_tag(kind: str, name: str) -> int:
    """Insert new ledger tag; returns id."""
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO ledger_tags (kind, name) VALUES (?, ?)",
            (kind or "", name or ""),
        )
        conn.commit()
        return int(cur.lastrowid)
    finally:
        conn.close()


def get_ledger_tag_by_id(tag_id: int) -> Optional[Dict[str, Any]]:
    """Get a single ledger tag by id."""
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, kind, name, created_at FROM ledger_tags WHERE id = ?",
            (int(tag_id),),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "kind": row["kind"] or "",
            "name": row["name"] or "",
            "created_at": row["created_at"],
        }
    finally:
        conn.close()


def rename_ledger_tag(tag_id: int, new_name: str) -> bool:
    """Rename an existing ledger tag (also updates entry snapshots)."""
    conn = get_connection()
    try:
        conn.execute("BEGIN")
        cur = conn.execute("UPDATE ledger_tags SET name = ? WHERE id = ?", (new_name or "", int(tag_id)))
        # keep ledger_entries.tag_name_snapshot in sync for this tag_id
        conn.execute(
            "UPDATE ledger_entries SET tag_name_snapshot = ?, updated_at = strftime('%s', 'now') WHERE tag_id = ?",
            (new_name or "", int(tag_id)),
        )
        conn.execute(
            "UPDATE ledger_entries_archive SET tag_name_snapshot = ?, updated_at = strftime('%s', 'now') WHERE tag_id = ?",
            (new_name or "", int(tag_id)),
        )
        conn.commit()
        return cur.rowcount > 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def delete_ledger_tag_if_unused(tag_id: int) -> bool:
    """
    Delete ledger tag when there is no associated ledger_entries (含归档表).
    Returns True if deleted, False otherwise.
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT (
                (SELECT COUNT(1) FROM ledger_entries WHERE tag_id = ?)
                + (SELECT COUNT(1) FROM ledger_entries_archive WHERE tag_id = ?)
            ) AS c
            """,
            (tag_id, tag_id),
        )
        row = cur.fetchone()
        if row and int(row["c"] or 0) > 0:
            return False
        cur2 = conn.execute("DELETE FROM ledger_tags WHERE id = ?", (tag_id,))
        conn.commit()
        return cur2.rowcount > 0
    finally:
        conn.close()


def add_ledger_entry(
    date: str,
    kind: str,
    tag_id: int,
    tag_name_snapshot: str,
    description: str,
    annotation: str,
    amount: float,
    expense_nature: str = "daily",
) -> int:
    """Insert a ledger entry; returns id."""
    stored_nature = "" if (kind or "") == "income" else (expense_nature or "daily")
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            INSERT INTO ledger_entries (date, kind, tag_id, tag_name_snapshot, description, annotation, amount, expense_nature)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                date or "",
                kind or "",
                int(tag_id),
                tag_name_snapshot or "",
                description or "",
                annotation or "",
                float(amount),
                stored_nature,
            ),
        )
        conn.commit()
        return int(cur.lastrowid)
    finally:
        conn.close()


def update_ledger_entry(
    entry_id: int,
    date: str,
    kind: str,
    tag_id: int,
    tag_name_snapshot: str,
    description: str,
    annotation: str,
    amount: float,
    expense_nature: str = "daily",
) -> bool:
    """Update an existing ledger entry."""
    stored_nature = "" if (kind or "") == "income" else (expense_nature or "daily")
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            UPDATE ledger_entries
            SET date = ?, kind = ?, tag_id = ?, tag_name_snapshot = ?, description = ?, annotation = ?, amount = ?, expense_nature = ?, updated_at = strftime('%s', 'now')
            WHERE id = ?
            """,
            (
                date or "",
                kind or "",
                int(tag_id),
                tag_name_snapshot or "",
                description or "",
                annotation or "",
                float(amount),
                stored_nature,
                entry_id,
            ),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_ledger_entry(entry_id: int) -> bool:
    """Delete a ledger entry by id."""
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM ledger_entries WHERE id = ?", (entry_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def ledger_retention_month_start_iso(today: Optional[date] = None) -> str:
    """
    热库保留「当前自然月」及向前共 12 个自然月的数据；
    返回保留区间的首日 YYYY-MM-01（早于该日的流水应归档）。
    """
    d = today or date.today()
    y, m = d.year, d.month
    for _ in range(11):
        if m == 1:
            y -= 1
            m = 12
        else:
            m -= 1
    return f"{y:04d}-{m:02d}-01"


def run_ledger_retention_archive() -> Dict[str, Any]:
    """
    将 ledger_entries 中 date 早于保留下限的记录迁移至 ledger_entries_archive（按行复制后删除）。
    可重复执行：已存在于归档表的 id 不会重复插入。
    """
    cutoff = ledger_retention_month_start_iso()
    conn = get_connection()
    try:
        cur = conn.execute("SELECT COUNT(1) AS c FROM ledger_entries WHERE date < ?", (cutoff,))
        n_before = int(cur.fetchone()["c"] or 0)
        if n_before == 0:
            return {"moved": 0, "cutoff": cutoff}
        conn.execute("BEGIN")
        conn.execute(
            """
            INSERT INTO ledger_entries_archive (
                id, date, kind, tag_id, tag_name_snapshot, description, annotation,
                amount, expense_nature, created_at, updated_at, archived_at
            )
            SELECT e.id, e.date, e.kind, e.tag_id, e.tag_name_snapshot, e.description, e.annotation,
                   e.amount, e.expense_nature, e.created_at, e.updated_at, strftime('%s', 'now')
            FROM ledger_entries e
            WHERE e.date < ?
            AND NOT EXISTS (SELECT 1 FROM ledger_entries_archive a WHERE a.id = e.id)
            """,
            (cutoff,),
        )
        cur2 = conn.execute("DELETE FROM ledger_entries WHERE date < ?", (cutoff,))
        deleted = int(cur2.rowcount or 0)
        conn.commit()
        return {"moved": deleted, "cutoff": cutoff, "candidates": n_before}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def query_ledger_entries_archive_between(
    start_date: str,
    end_date: str,
) -> List[Dict[str, Any]]:
    """归档表按日期区间查询，结构与 query_ledger_entries_between 一致（不含 archived_at 对外字段）。"""
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT id, date, kind, tag_id, tag_name_snapshot, description, annotation, amount,
                   expense_nature, created_at, updated_at
            FROM ledger_entries_archive
            WHERE date >= ? AND date <= ?
            ORDER BY date ASC, id ASC
            """,
            (start_date or "", end_date or ""),
        )
        rows = cur.fetchall()
        return [
            {
                "id": row["id"],
                "date": row["date"],
                "kind": row["kind"],
                "tag_id": row["tag_id"],
                "tag_name": row["tag_name_snapshot"],
                "description": row["description"],
                "annotation": row["annotation"] if "annotation" in row.keys() else "",
                "amount": row["amount"],
                "expense_nature": row["expense_nature"]
                if "expense_nature" in row.keys()
                else "daily",
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]
    finally:
        conn.close()


def query_ledger_entries_between(
    start_date: str,
    end_date: str,
) -> List[Dict[str, Any]]:
    """Query ledger entries between dates, ordered by date then id."""
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT id, date, kind, tag_id, tag_name_snapshot, description, annotation, amount,
                   expense_nature, created_at, updated_at
            FROM ledger_entries
            WHERE date >= ? AND date <= ?
            ORDER BY date ASC, id ASC
            """,
            (start_date or "", end_date or ""),
        )
        rows = cur.fetchall()
        return [
            {
                "id": row["id"],
                "date": row["date"],
                "kind": row["kind"],
                "tag_id": row["tag_id"],
                "tag_name": row["tag_name_snapshot"],
                "description": row["description"],
                "annotation": row["annotation"] if "annotation" in row.keys() else "",
                "amount": row["amount"],
                "expense_nature": row["expense_nature"]
                if "expense_nature" in row.keys()
                else "daily",
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]
    finally:
        conn.close()


def sum_ledger_between(
    start_date: str,
    end_date: str,
) -> Dict[str, float]:
    """Return income/expense totals between dates (日常支出 = 支出且性质按日常计，不含固定)."""
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT
                SUM(CASE WHEN kind = 'income' THEN amount ELSE 0 END) AS income_total,
                SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END) AS expense_total,
                SUM(CASE
                    WHEN kind = 'expense'
                        AND IFNULL(NULLIF(TRIM(expense_nature), ''), 'daily') = 'daily' THEN amount
                    ELSE 0
                END) AS daily_expense_total
            FROM ledger_entries
            WHERE date >= ? AND date <= ?
            """,
            (start_date or "", end_date or ""),
        )
        row = cur.fetchone()
        return {
            "income_total": float(row["income_total"] or 0) if row else 0.0,
            "expense_total": float(row["expense_total"] or 0) if row else 0.0,
            "daily_expense_total": float(row["daily_expense_total"] or 0) if row else 0.0,
        }
    finally:
        conn.close()


def query_ledger_daily_expense_by_day(start_date: str, end_date: str) -> List[Dict[str, Any]]:
    """按自然日汇总支出与日常支出（仅 expense），仅返回有记账的日期；无支出日由调用方补 0。"""
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT
                date,
                SUM(amount) AS expense_total,
                SUM(
                    CASE
                        WHEN IFNULL(NULLIF(TRIM(expense_nature), ''), 'daily') = 'daily' THEN amount
                        ELSE 0
                    END
                ) AS daily_expense_total
            FROM ledger_entries
            WHERE date >= ? AND date <= ? AND kind = 'expense'
            GROUP BY date
            ORDER BY date ASC
            """,
            (start_date or "", end_date or ""),
        )
        return [
            {
                "date": str(row["date"] or ""),
                "expense_total": round(float(row["expense_total"] or 0), 2),
                "daily_expense_total": round(float(row["daily_expense_total"] or 0), 2),
            }
            for row in cur.fetchall()
        ]
    finally:
        conn.close()


def query_ledger_tag_expense_ratios(start_date: str, end_date: str) -> Dict[str, Any]:
    """
    各支出标签金额占该区间支出总额的比例（标签支出合计 / 区间支出总额）。
    按 ratio（占比，0–1，保留 2 位小数）降序。
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END), 0) AS total_exp
            FROM ledger_entries
            WHERE date >= ? AND date <= ?
            """,
            (start_date or "", end_date or ""),
        )
        r0 = cur.fetchone()
        total = float(r0["total_exp"] or 0) if r0 else 0.0
        cur = conn.execute(
            """
            SELECT tag_id,
                   MAX(COALESCE(tag_name_snapshot, '')) AS tag_name,
                   SUM(amount) AS tag_amount
            FROM ledger_entries
            WHERE date >= ? AND date <= ? AND kind = 'expense'
            GROUP BY tag_id
            """,
            (start_date or "", end_date or ""),
        )
        items: List[Dict[str, Any]] = []
        for row in cur.fetchall():
            amt = float(row["tag_amount"] or 0)
            share = (amt / total) if total > 0 else 0.0
            items.append(
                {
                    "tag_id": row["tag_id"],
                    "tag_name": str(row["tag_name"] or ""),
                    "amount": round(amt, 2),
                    "ratio": round(share, 2),
                    "ratio_percent": round(share * 100.0, 2),
                }
            )
        items.sort(key=lambda x: -float(x["ratio"]))
        return {"total_expense": round(total, 2), "items": items}
    finally:
        conn.close()


def ledger_expense_breakdown_between(start_date: str, end_date: str) -> Dict[str, float]:
    """Sum expenses split by nature: fixed vs daily-like (non-fixed expenses)."""
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT
                SUM(CASE
                    WHEN kind = 'expense' AND IFNULL(expense_nature, 'daily') = 'fixed' THEN amount
                    ELSE 0
                END) AS fixed_total,
                SUM(CASE
                    WHEN kind = 'expense' AND IFNULL(expense_nature, 'daily') != 'fixed' THEN amount
                    ELSE 0
                END) AS daily_total,
                SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END) AS expense_total
            FROM ledger_entries
            WHERE date >= ? AND date <= ?
            """,
            (start_date or "", end_date or ""),
        )
        row = cur.fetchone()
        return {
            "expense_fixed_total": float(row["fixed_total"] or 0) if row else 0.0,
            "expense_daily_total": float(row["daily_total"] or 0) if row else 0.0,
            "expense_total": float(row["expense_total"] or 0) if row else 0.0,
        }
    finally:
        conn.close()


def upsert_ledger_budget_cell(
    granularity: str,
    period_start: str,
    period_end: str,
    amount: float,
) -> None:
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO ledger_budget_cells (granularity, period_start, period_end, amount)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(granularity, period_start) DO UPDATE SET
                period_end = excluded.period_end,
                amount = excluded.amount,
                updated_at = strftime('%s', 'now')
            """,
            (
                granularity or "",
                period_start or "",
                period_end or "",
                float(amount),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def list_ledger_budget_cells(granularity: str) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT id, granularity, period_start, period_end, amount, created_at, updated_at
            FROM ledger_budget_cells
            WHERE granularity = ?
            ORDER BY period_start ASC
            """,
            (granularity or "",),
        )
        rows = cur.fetchall()
        return [
            {
                "id": row["id"],
                "granularity": row["granularity"],
                "period_start": row["period_start"],
                "period_end": row["period_end"],
                "amount": float(row["amount"] or 0),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]
    finally:
        conn.close()


def update_ledger_budget_cell_amount(cell_id: int, amount: float) -> bool:
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            UPDATE ledger_budget_cells
            SET amount = ?, updated_at = strftime('%s', 'now')
            WHERE id = ?
            """,
            (float(amount), int(cell_id)),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def resolve_ledger_budget_amount(
    scope: str,
    period_start_key: str,
    period_end_inc: str,
) -> Optional[float]:
    """Lookup saved budget for the exact calendar week (Monday) or month (first day)."""
    _ = period_end_inc
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT amount FROM ledger_budget_cells
            WHERE granularity = ? AND period_start = ?
            LIMIT 1
            """,
            (scope or "", period_start_key or ""),
        )
        row = cur.fetchone()
        if not row:
            return None
        return float(row["amount"] or 0)
    finally:
        conn.close()


def purge_orphan_todo_instances() -> None:
    """
    Remove todo_instances whose source_todo_id no longer exists in todos
    (e.g. user deleted the master todo). Safe to call periodically.
    """
    conn = get_connection()
    try:
        conn.execute(
            """
            DELETE FROM todo_instances
            WHERE NOT EXISTS (SELECT 1 FROM todos t WHERE t.id = todo_instances.source_todo_id)
            """
        )
        conn.commit()
    finally:
        conn.close()


def _todo_complete_date_to_iso_yyyy_mm_dd(raw: str) -> str:
    """Normalize todos.complete_date / snapshot strings to YYYY-MM-DD or ''."""
    s = (raw or "").strip()
    if len(s) < 10:
        return ""
    chunk = s[:10]
    if chunk[4:5] == "/" and chunk[7:8] == "/":
        return f"{chunk[0:4]}-{chunk[5:7]}-{chunk[8:10]}"
    if chunk[4:5] == "-" and chunk[7:8] == "-":
        return chunk
    return ""


def heal_stale_pending_todo_instances_for_date(date_str: str) -> None:
    """
    If master `todos` is already done but `todo_instances` for that calendar date
    stayed pending (e.g. completed yesterday before instance↔master sync), mark the
    instance done so the calendar does not show an extra pending row.
    Only updates `todo_instances`, does not change `todos`.
    """
    if not (date_str or "").strip():
        return
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT ti.id, t.complete_date AS master_cd
            FROM todo_instances ti
            INNER JOIN todos t ON t.id = ti.source_todo_id
            WHERE ti.date = ?
              AND LOWER(TRIM(COALESCE(ti.status, ''))) != 'done'
              AND LOWER(TRIM(COALESCE(t.status, ''))) = 'done'
            """,
            (date_str,),
        )
        rows = cur.fetchall()
        touched = False
        for row in rows:
            iid = int(row["id"])
            iso = _todo_complete_date_to_iso_yyyy_mm_dd(str(row["master_cd"] or ""))
            conn.execute(
                """
                UPDATE todo_instances
                SET status = 'done',
                    complete_date = ?,
                    updated_at = strftime('%s', 'now')
                WHERE id = ?
                """,
                (iso, iid),
            )
            touched = True
        if touched:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _migrate_dedupe_done_todo_instances(conn: sqlite3.Connection) -> None:
    """
    One-shot migration: delete duplicate todo_instances rows that are status=done
    and share the same source_todo_id and the same logical complete_date (YYYY-MM-DD),
    keeping the row with the largest id. Marked in app_state so it runs once.
    """
    key = "migration_todo_instances_dedupe_done_v1"
    try:
        row = conn.execute("SELECT value FROM app_state WHERE key = ?", (key,)).fetchone()
        if row and str(row["value"]) == "1":
            return
    except Exception:
        return

    try:
        cur = conn.execute(
            """
            SELECT id, source_todo_id, complete_date
            FROM todo_instances
            WHERE LOWER(TRIM(COALESCE(status, ''))) = 'done'
              AND COALESCE(TRIM(source_todo_id), '') != ''
            ORDER BY id ASC
            """
        )
        rows = cur.fetchall()
    except Exception:
        return

    groups: Dict[Tuple[str, str], List[int]] = {}
    for row in rows:
        iid = int(row["id"])
        sid = str(row["source_todo_id"] or "").strip()
        cd_key = _todo_complete_date_to_iso_yyyy_mm_dd(str(row["complete_date"] or ""))
        gk = (sid, cd_key)
        groups.setdefault(gk, []).append(iid)

    to_delete: List[int] = []
    for _gk, ids in groups.items():
        if len(ids) <= 1:
            continue
        keep = max(ids)
        for i in ids:
            if i != keep:
                to_delete.append(i)

    if to_delete:
        chunk = 400
        for i in range(0, len(to_delete), chunk):
            part = to_delete[i : i + chunk]
            placeholders = ",".join("?" * len(part))
            conn.execute(f"DELETE FROM todo_instances WHERE id IN ({placeholders})", part)

    try:
        conn.execute(
            """
            INSERT INTO app_state (key, value)
            VALUES (?, '1')
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = strftime('%s', 'now')
            """,
            (key,),
        )
        conn.commit()
    except Exception:
        conn.rollback()


def get_todo_instances_for_date(date: str) -> List[Dict[str, Any]]:
    """Get todo instances for a specific date."""
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT ti.id, ti.source_todo_id, ti.date, ti.status, ti.complete_date,
                   ti.content_snapshot, ti.created_at, ti.updated_at
            FROM todo_instances ti
            INNER JOIN todos t ON t.id = ti.source_todo_id
            WHERE ti.date = ?
            ORDER BY ti.id ASC
            """,
            (date or "",),
        )
        rows = cur.fetchall()
        return [
            {
                "id": row["id"],
                "source_todo_id": row["source_todo_id"],
                "date": row["date"],
                "status": row["status"],
                "complete_date": row["complete_date"] or "",
                "content_snapshot": row["content_snapshot"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]
    finally:
        conn.close()


def insert_todo_instance(
    source_todo_id: str,
    date: str,
    status: str,
    content_snapshot: str,
    complete_date: str = "",
) -> int:
    """Insert a todo instance; returns id (upsert-style ignoring duplicate pair)."""
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO todo_instances (source_todo_id, date, status, complete_date, content_snapshot)
            VALUES (?, ?, ?, ?, ?)
            """,
            (source_todo_id or "", date or "", status or "pending", complete_date or "", content_snapshot or ""),
        )
        conn.commit()
        return int(cur.lastrowid or 0)
    finally:
        conn.close()


def update_todo_instance_status(instance_id: int, status: str, complete_date: str = "") -> bool:
    """Update status (and complete_date) for a todo instance; mirror to master `todos` row by source_todo_id."""
    conn = get_connection()
    try:
        cur = conn.execute("SELECT source_todo_id FROM todo_instances WHERE id = ?", (instance_id,))
        row = cur.fetchone()
        if not row:
            return False
        source_id = str(row["source_todo_id"] or "").strip()

        if (status or "pending") == "done":
            cd = complete_date or ""
        else:
            cd = ""
        cur = conn.execute(
            """
            UPDATE todo_instances
            SET status = ?, complete_date = ?, updated_at = strftime('%s', 'now')
            WHERE id = ?
            """,
            (status or "pending", cd, instance_id),
        )
        if cur.rowcount <= 0:
            return False

        # 与「事件与待办」页列表一致：该页读 `todos` 表且未完成态为 status=todo
        if source_id:
            if (status or "pending") == "done":
                cd_master = cd
                if len(cd_master) >= 10 and cd_master[4] == "-" and cd_master[7] == "-":
                    cd_master = f"{cd_master[0:4]}/{cd_master[5:7]}/{cd_master[8:10]}"
                conn.execute(
                    """
                    UPDATE todos
                    SET status = 'done', complete_date = ?, updated_at = strftime('%s', 'now')
                    WHERE id = ?
                    """,
                    (cd_master, source_id),
                )
            else:
                conn.execute(
                    """
                    UPDATE todos
                    SET status = 'todo', complete_date = '', updated_at = strftime('%s', 'now')
                    WHERE id = ?
                    """,
                    (source_id,),
                )
        conn.commit()
        return True
    finally:
        conn.close()


def get_todo_instances_completed_on(date: str) -> List[Dict[str, Any]]:
    """Get todo instances completed on a date (complete_date == date), ordered by id."""
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT ti.id, ti.source_todo_id, ti.date, ti.status, ti.complete_date,
                   ti.content_snapshot, ti.created_at, ti.updated_at
            FROM todo_instances ti
            INNER JOIN todos t ON t.id = ti.source_todo_id
            WHERE ti.complete_date = ? AND ti.status = 'done'
            ORDER BY ti.id ASC
            """,
            (date or "",),
        )
        rows = cur.fetchall()
        items: List[Dict[str, Any]] = [
            {
                "id": row["id"],
                "source_todo_id": row["source_todo_id"],
                "date": row["date"],
                "status": row["status"],
                "complete_date": row["complete_date"] or "",
                "content_snapshot": row["content_snapshot"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]
        # 同一 source_todo_id、同一 complete_date 可能对应多条实例（不同 ti.date），列表只展示一条
        seen_sid: set = set()
        deduped_rev: List[Dict[str, Any]] = []
        for it in sorted(items, key=lambda x: int(x.get("id") or 0), reverse=True):
            sid = str(it.get("source_todo_id") or "").strip()
            key = sid if sid else f"id:{it.get('id')}"
            if key in seen_sid:
                continue
            seen_sid.add(key)
            deduped_rev.append(it)
        deduped_rev.reverse()
        return deduped_rev
    finally:
        conn.close()


def clone_pending_todo_instances(from_date: str, to_date: str) -> int:
    """
    Clone all pending todo instances from one date to another.
    Returns how many rows attempted to insert (ignores duplicates).
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT ti.source_todo_id, ti.content_snapshot
            FROM todo_instances ti
            INNER JOIN todos t ON t.id = ti.source_todo_id
            WHERE ti.date = ? AND ti.status = 'pending'
            """,
            (from_date or "",),
        )
        rows = cur.fetchall()
        if not rows:
            return 0
        for row in rows:
            conn.execute(
                """
                INSERT OR IGNORE INTO todo_instances (source_todo_id, date, status, content_snapshot)
                VALUES (?, ?, 'pending', ?)
                """,
                (row["source_todo_id"], to_date or "", row["content_snapshot"]),
            )
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def _merge_content_tag_record_types(a: str, b: str) -> str:
    """Merge two tag record_type values into watch | book | all."""

    def expand(x: str) -> set:
        s = str(x or "").strip().lower()
        if s == "all":
            return {"watch", "book"}
        if s in ("watch", "book"):
            return {s}
        return set()

    u = expand(a) | expand(b)
    if len(u) >= 2:
        return "all"
    if "watch" in u:
        return "watch"
    if "book" in u:
        return "book"
    return "all"


def _migrate_content_tags_share_by_name(conn: sqlite3.Connection) -> None:
    """
    Legacy DB used UNIQUE(name, record_type). Merge rows that share the same
    name into one row (record_type watch/book/all) and UNIQUE(name).
    """
    cur = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='content_tags'")
    row = cur.fetchone()
    if not row or not row["sql"]:
        return
    sql_c = (row["sql"] or "").replace(" ", "").lower()
    if "unique(name,record_type)" not in sql_c:
        return
    conn.execute("PRAGMA foreign_keys=OFF")
    try:
        conn.execute(
            """
            DELETE FROM content_record_tags
            WHERE tag_id IN (SELECT id FROM content_tags WHERE TRIM(COALESCE(name, '')) = '')
            """
        )
        conn.execute("DELETE FROM content_tags WHERE TRIM(COALESCE(name, '')) = ''")
        rows = list(conn.execute("SELECT id, name, record_type, created_at FROM content_tags").fetchall())
        if not rows:
            conn.execute("DELETE FROM content_record_tags")
            conn.execute("DROP TABLE content_tags")
            conn.execute(
                """
                CREATE TABLE content_tags (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    record_type TEXT NOT NULL DEFAULT 'all',
                    created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                    CHECK(record_type IN ('watch', 'book', 'all')),
                    UNIQUE(name)
                )
                """
            )
            return
        by_name: Dict[str, List[sqlite3.Row]] = {}
        for r in rows:
            nm = str(r["name"] or "").strip()
            if not nm:
                continue
            by_name.setdefault(nm, []).append(r)
        conn.execute(
            """
            CREATE TABLE _content_tags_m (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                record_type TEXT NOT NULL DEFAULT 'all',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                CHECK(record_type IN ('watch', 'book', 'all')),
                UNIQUE(name)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE _content_record_tags_m (
                record_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY(record_id, tag_id)
            )
            """
        )
        old_to_new: Dict[int, int] = {}
        for nm, group in by_name.items():
            merged = "all"
            for r in group:
                merged = _merge_content_tag_record_types(merged, str(r["record_type"] or ""))
            created = min(float(r["created_at"] or 0) for r in group)
            cur_ins = conn.execute(
                "INSERT INTO _content_tags_m (name, record_type, created_at) VALUES (?, ?, ?)",
                (nm, merged, created),
            )
            nid = int(cur_ins.lastrowid)
            for r in group:
                old_to_new[int(r["id"])] = nid
        for rid, tid in conn.execute("SELECT record_id, tag_id FROM content_record_tags").fetchall():
            nid = old_to_new.get(int(tid), int(tid))
            conn.execute(
                "INSERT OR IGNORE INTO _content_record_tags_m (record_id, tag_id) VALUES (?, ?)",
                (int(rid), int(nid)),
            )
        conn.execute("DROP TABLE content_record_tags")
        conn.execute("DROP TABLE content_tags")
        conn.execute("ALTER TABLE _content_tags_m RENAME TO content_tags")
        conn.execute("ALTER TABLE _content_record_tags_m RENAME TO content_record_tags")
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_record_tags_tag_id
            ON content_record_tags(tag_id)
            """
        )
    finally:
        conn.execute("PRAGMA foreign_keys=ON")


def get_content_tags(record_type: str = "") -> List[Dict[str, Any]]:
    """List content tags by record_type (watch/book/all)."""
    rt = str(record_type or "").strip().lower()
    conn = get_connection()
    try:
        if rt in ("watch", "book"):
            cur = conn.execute(
                """
                SELECT t.id, t.name, t.record_type, t.created_at, COUNT(rt2.record_id) AS ref_count
                FROM content_tags t
                LEFT JOIN content_record_tags rt2 ON rt2.tag_id = t.id
                WHERE record_type IN (?, 'all')
                GROUP BY t.id, t.name, t.record_type, t.created_at
                ORDER BY t.name ASC, t.id ASC
                """,
                (rt,),
            )
        elif rt == "all":
            cur = conn.execute(
                """
                SELECT t.id, t.name, t.record_type, t.created_at, COUNT(rt2.record_id) AS ref_count
                FROM content_tags t
                LEFT JOIN content_record_tags rt2 ON rt2.tag_id = t.id
                GROUP BY t.id, t.name, t.record_type, t.created_at
                ORDER BY t.name ASC, t.id ASC
                """
            )
        else:
            cur = conn.execute(
                """
                SELECT t.id, t.name, t.record_type, t.created_at, COUNT(rt2.record_id) AS ref_count
                FROM content_tags t
                LEFT JOIN content_record_tags rt2 ON rt2.tag_id = t.id
                GROUP BY t.id, t.name, t.record_type, t.created_at
                ORDER BY t.name ASC, t.id ASC
                """
            )
        rows = cur.fetchall()
        return [
            {
                "id": row["id"],
                "name": row["name"] or "",
                "record_type": row["record_type"] or "all",
                "created_at": row["created_at"],
                "ref_count": int(row["ref_count"] or 0),
            }
            for row in rows
        ]
    finally:
        conn.close()


def add_content_tag(name: str, record_type: str = "all") -> int:
    """Insert a content tag and return id; merges record_type if name already exists."""
    nm = str(name or "").strip()
    rt = str(record_type or "all").strip()
    if rt not in ("watch", "book", "all"):
        rt = "all"
    conn = get_connection()
    try:
        row = conn.execute("SELECT id, record_type FROM content_tags WHERE name = ?", (nm,)).fetchone()
        if row:
            merged = _merge_content_tag_record_types(str(row["record_type"] or ""), rt)
            conn.execute(
                "UPDATE content_tags SET record_type = ? WHERE id = ?",
                (merged, int(row["id"])),
            )
            conn.commit()
            return int(row["id"])
        cur = conn.execute(
            "INSERT INTO content_tags (name, record_type) VALUES (?, ?)",
            (nm, rt),
        )
        conn.commit()
        return int(cur.lastrowid)
    finally:
        conn.close()


def update_content_tag(
    tag_id: int,
    name: Optional[str] = None,
    record_type: Optional[str] = None,
) -> bool:
    """Update tag name and/or applicability (watch / book / all)."""
    tid = int(tag_id)
    if name is None and record_type is None:
        return False
    conn = get_connection()
    try:
        parts: List[str] = []
        vals: List[Any] = []
        if name is not None:
            parts.append("name = ?")
            vals.append(str(name or "").strip())
        if record_type is not None:
            rt = str(record_type or "").strip().lower()
            if rt not in ("watch", "book", "all"):
                rt = "all"
            parts.append("record_type = ?")
            vals.append(rt)
        vals.append(tid)
        cur = conn.execute(f"UPDATE content_tags SET {', '.join(parts)} WHERE id = ?", vals)
        conn.commit()
        return cur.rowcount > 0
    except sqlite3.IntegrityError:
        conn.rollback()
        raise
    finally:
        conn.close()


def rename_content_tag(tag_id: int, name: str) -> bool:
    """Rename a content tag."""
    return update_content_tag(tag_id, name=str(name or "").strip(), record_type=None)


def delete_content_tag_if_unused(tag_id: int) -> bool:
    """Delete tag if no record references it."""
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT COUNT(1) AS c FROM content_record_tags WHERE tag_id = ?",
            (int(tag_id),),
        )
        row = cur.fetchone()
        if row and int(row["c"] or 0) > 0:
            return False
        cur2 = conn.execute("DELETE FROM content_tags WHERE id = ?", (int(tag_id),))
        conn.commit()
        return cur2.rowcount > 0
    finally:
        conn.close()


CONTENT_RECORD_PUBLIC_ID_RE = re.compile(r"^(DR|RE)(\d{6})$", re.IGNORECASE)


def is_valid_content_record_public_id(s: Any) -> bool:
    return bool(s and CONTENT_RECORD_PUBLIC_ID_RE.match(str(s).strip()))


def normalize_content_record_public_id(s: Any) -> str:
    t = str(s or "").strip().upper()
    if not CONTENT_RECORD_PUBLIC_ID_RE.match(t):
        raise ValueError("invalid content record id")
    return t[:2] + t[2:]


def _ext_json_clear_related_refs_for_migration(ext_json: str) -> str:
    try:
        d = json.loads(ext_json or "{}")
        if isinstance(d, dict):
            d.pop("related_record_refs", None)
            return json.dumps(d, ensure_ascii=False)
    except Exception:
        pass
    return "{}"


def _content_record_id_column_is_integer(conn: sqlite3.Connection) -> bool:
    cur = conn.execute("PRAGMA table_info(content_records)")
    for row in cur.fetchall():
        if str(row["name"]) == "id":
            return "INT" in str(row["type"] or "").upper()
    return False


def _migrate_content_records_dr_re_ids(conn: sqlite3.Connection) -> None:
    """
    One-time: INTEGER id -> DR###### / RE######; clear related_record_refs in ext_json.
    """
    if not _content_record_id_column_is_integer(conn):
        return
    conn.execute("PRAGMA foreign_keys=OFF")
    try:
        rows = list(conn.execute("SELECT * FROM content_records ORDER BY CAST(id AS INTEGER) ASC").fetchall())
        watch_rows = sorted(
            (dict(r) for r in rows if str(r["record_type"] or "") == "watch"),
            key=lambda x: int(x["id"]),
        )
        book_rows = sorted(
            (dict(r) for r in rows if str(r["record_type"] or "") == "book"),
            key=lambda x: int(x["id"]),
        )
        old_to_new: Dict[int, str] = {}
        for i, od in enumerate(watch_rows, start=1):
            old_to_new[int(od["id"])] = "DR" + str(i).zfill(6)
        for i, od in enumerate(book_rows, start=1):
            old_to_new[int(od["id"])] = "RE" + str(i).zfill(6)
        conn.execute(
            """
            CREATE TABLE _cr_dr_re (
                id TEXT PRIMARY KEY,
                record_type TEXT NOT NULL,
                submit_date TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                creator TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                rating INTEGER NOT NULL DEFAULT 0,
                episode_count TEXT NOT NULL DEFAULT '',
                summary TEXT NOT NULL DEFAULT '',
                review TEXT NOT NULL DEFAULT '',
                original_work TEXT NOT NULL DEFAULT '',
                release_date TEXT NOT NULL DEFAULT '',
                related_series TEXT NOT NULL DEFAULT '',
                cover_url TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT 'manual',
                source_id TEXT NOT NULL DEFAULT '',
                ext_json TEXT NOT NULL DEFAULT '{}',
                list_status TEXT NOT NULL DEFAULT 'done',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
                CHECK(record_type IN ('watch', 'book')),
                CHECK(rating >= 0 AND rating <= 5)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE _crt_dr_re (
                record_id TEXT NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY(record_id, tag_id)
            )
            """
        )
        for r in rows:
            od = dict(r)
            oid = int(od["id"])
            nid = old_to_new[oid]
            ext_clean = _ext_json_clear_related_refs_for_migration(od.get("ext_json") or "{}")
            ls = str(od.get("list_status") or "done").strip() or "done"
            if ls not in ("done", "wishlist"):
                ls = "done"
            conn.execute(
                """
                INSERT INTO _cr_dr_re (
                    id, record_type, submit_date, title, creator, category, rating, episode_count,
                    summary, review, original_work, release_date, related_series,
                    cover_url, source, source_id, ext_json, list_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    nid,
                    od.get("record_type") or "",
                    od.get("submit_date") or "",
                    od.get("title") or "",
                    od.get("creator") or "",
                    od.get("category") or "",
                    int(od.get("rating") or 0),
                    str(od.get("episode_count") or "").strip(),
                    od.get("summary") or "",
                    od.get("review") or "",
                    od.get("original_work") or "",
                    od.get("release_date") or "",
                    od.get("related_series") or "",
                    od.get("cover_url") or "",
                    od.get("source") or "manual",
                    od.get("source_id") or "",
                    ext_clean,
                    ls,
                    od.get("created_at") or 0,
                    od.get("updated_at") or 0,
                ),
            )
        for tr in conn.execute("SELECT record_id, tag_id FROM content_record_tags").fetchall():
            oid = int(tr["record_id"])
            nid = old_to_new.get(oid)
            if not nid:
                continue
            conn.execute(
                "INSERT OR IGNORE INTO _crt_dr_re (record_id, tag_id) VALUES (?, ?)",
                (nid, int(tr["tag_id"])),
            )
        conn.execute("DROP TABLE content_record_tags")
        conn.execute("DROP TABLE content_records")
        conn.execute("ALTER TABLE _cr_dr_re RENAME TO content_records")
        conn.execute("ALTER TABLE _crt_dr_re RENAME TO content_record_tags")
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_records_type_date
            ON content_records(record_type, submit_date)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_records_title
            ON content_records(title)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_records_creator
            ON content_records(creator)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_records_rating
            ON content_records(rating)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_record_tags_tag_id
            ON content_record_tags(tag_id)
            """
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("PRAGMA foreign_keys=ON")


def _allocate_next_content_record_id(conn: sqlite3.Connection, record_type: str) -> str:
    rt = str(record_type or "").strip().lower()
    if rt not in ("watch", "book"):
        rt = "watch"
    prefix = "DR" if rt == "watch" else "RE"
    cur = conn.execute(
        """
        SELECT id FROM content_records
        WHERE record_type = ? AND LENGTH(id) = 8 AND UPPER(SUBSTR(id, 1, 2)) = ?
        ORDER BY id DESC LIMIT 1
        """,
        (rt, prefix),
    )
    row = cur.fetchone()
    if not row:
        n = 0
    else:
        tail = str(row["id"])[2:]
        try:
            n = int(tail, 10)
        except ValueError:
            n = 0
    return prefix + str(n + 1).zfill(6)


def add_content_record(
    record_type: str,
    submit_date: str,
    title: str,
    creator: str,
    category: str,
    rating: int,
    episode_count: str,
    summary: str,
    review: str,
    original_work: str,
    release_date: str,
    related_series: str,
    cover_url: str,
    source: str = "manual",
    source_id: str = "",
    ext_json: str = "{}",
    list_status: str = "done",
) -> str:
    """Insert a content record and return public id (DR###### / RE######)."""
    conn = get_connection()
    try:
        ls = str(list_status or "done").strip() or "done"
        if ls not in ("done", "wishlist"):
            ls = "done"
        conn.execute("BEGIN")
        new_id = _allocate_next_content_record_id(conn, record_type)
        conn.execute(
            """
            INSERT INTO content_records (
                id, record_type, submit_date, title, creator, category, rating, episode_count,
                summary, review, original_work, release_date, related_series,
                cover_url, source, source_id, ext_json, list_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id,
                record_type,
                submit_date,
                title or "",
                creator or "",
                category or "",
                int(rating or 0),
                str(episode_count or "").strip(),
                summary or "",
                review or "",
                original_work or "",
                release_date or "",
                related_series or "",
                cover_url or "",
                source or "manual",
                source_id or "",
                ext_json or "{}",
                ls,
            ),
        )
        conn.commit()
        new_id_str = str(new_id)
        sync_content_record_persons(new_id_str)
        return new_id_str
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def update_content_record(
    record_id: str,
    record_type: str,
    submit_date: str,
    title: str,
    creator: str,
    category: str,
    rating: int,
    episode_count: str,
    summary: str,
    review: str,
    original_work: str,
    release_date: str,
    related_series: str,
    cover_url: str,
    source: str = "manual",
    source_id: str = "",
    ext_json: str = "{}",
    list_status: str = "done",
) -> bool:
    """Update a content record."""
    conn = get_connection()
    try:
        ls = str(list_status or "done").strip() or "done"
        if ls not in ("done", "wishlist"):
            ls = "done"
        cur = conn.execute(
            """
            UPDATE content_records
            SET record_type = ?, submit_date = ?, title = ?, creator = ?, category = ?, rating = ?,
                episode_count = ?,
                summary = ?, review = ?, original_work = ?, release_date = ?, related_series = ?,
                cover_url = ?, source = ?, source_id = ?, ext_json = ?, list_status = ?,
                updated_at = strftime('%s', 'now')
            WHERE id = ?
            """,
            (
                record_type,
                submit_date,
                title or "",
                creator or "",
                category or "",
                int(rating or 0),
                str(episode_count or "").strip(),
                summary or "",
                review or "",
                original_work or "",
                release_date or "",
                related_series or "",
                cover_url or "",
                source or "manual",
                source_id or "",
                ext_json or "{}",
                ls,
                normalize_content_record_public_id(record_id),
            ),
        )
        ok = cur.rowcount > 0
        conn.commit()
        if ok:
            sync_content_record_persons(normalize_content_record_public_id(record_id))
        return ok
    finally:
        conn.close()


def _content_ext_json_dict(ext_json: str) -> Dict[str, Any]:
    try:
        d = json.loads(ext_json or "{}")
        if isinstance(d, dict):
            return d
    except Exception:
        pass
    return {}


def _content_ext_refs_list(ext: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = ext.get("related_record_refs")
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for r in raw:
        if not isinstance(r, dict):
            continue
        rid_raw = r.get("id")
        if rid_raw is None:
            continue
        rid = str(rid_raw).strip().upper()
        if not CONTENT_RECORD_PUBLIC_ID_RE.match(rid):
            continue
        rid = rid[:2] + rid[2:]
        title = str(r.get("title") or "").strip()
        rt = str(r.get("record_type") or "").strip()
        out.append({"id": rid, "title": title, "record_type": rt})
    return out


def content_record_related_ids_from_ext_json(ext_json: str) -> Set[str]:
    return {str(r["id"]) for r in _content_ext_refs_list(_content_ext_json_dict(ext_json))}


def _ref_dict_from_content_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": normalize_content_record_public_id(row["id"]),
        "title": str(row.get("title") or "").strip(),
        "record_type": str(row.get("record_type") or "").strip(),
    }


def _set_related_refs_in_ext(ext: Dict[str, Any], refs: List[Dict[str, Any]]) -> None:
    refs = [r for r in refs if r.get("id") and str(r.get("title") or "").strip()]
    if refs:
        ext["related_record_refs"] = refs
    else:
        ext.pop("related_record_refs", None)


def update_content_record_ext_json_only(record_id: str, ext_json: str) -> bool:
    """Update only ext_json (+ updated_at) for internal link sync."""
    rid = normalize_content_record_public_id(record_id)
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            UPDATE content_records
            SET ext_json = ?, updated_at = strftime('%s', 'now')
            WHERE id = ?
            """,
            (str(ext_json or "{}").strip() or "{}", rid),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def content_record_add_inverse_link(peer_id: str, source_row: Dict[str, Any]) -> None:
    """Ensure record peer_id lists source_row id in related_record_refs."""
    src_id = normalize_content_record_public_id(source_row["id"])
    pid = normalize_content_record_public_id(peer_id)
    if pid == src_id:
        return
    if get_content_record(pid) is None:
        return
    tgt = get_content_record(pid)
    if not tgt:
        return
    ext = _content_ext_json_dict(tgt.get("ext_json") or "{}")
    refs = _content_ext_refs_list(ext)
    ref_src = _ref_dict_from_content_row(source_row)
    replaced = False
    for i, r in enumerate(refs):
        if str(r.get("id") or "") == src_id:
            refs[i] = ref_src
            replaced = True
            break
    if not replaced:
        refs.append(ref_src)
    _set_related_refs_in_ext(ext, refs)
    update_content_record_ext_json_only(pid, json.dumps(ext, ensure_ascii=False))


def content_record_remove_inverse_link(peer_id: str, remove_id: str) -> None:
    """Remove remove_id from peer_id's related_record_refs."""
    pid = normalize_content_record_public_id(peer_id)
    rid = normalize_content_record_public_id(remove_id)
    if pid == rid:
        return
    tgt = get_content_record(pid)
    if not tgt:
        return
    ext = _content_ext_json_dict(tgt.get("ext_json") or "{}")
    refs = [r for r in _content_ext_refs_list(ext) if str(r.get("id") or "") != rid]
    _set_related_refs_in_ext(ext, refs)
    update_content_record_ext_json_only(pid, json.dumps(ext, ensure_ascii=False))


def _normalize_related_id_set(ids: Set[str]) -> Set[str]:
    out: Set[str] = set()
    for x in ids:
        try:
            out.add(normalize_content_record_public_id(x))
        except (ValueError, TypeError):
            continue
    return out


def sync_content_record_related_links(record_id: str, old_ids: Set[str], new_ids: Set[str]) -> None:
    """
    Keep bidirectional links: when R links T, T links R; removing on either side drops the other.
    """
    rid = normalize_content_record_public_id(record_id)
    rec = get_content_record(rid)
    if not rec:
        return
    old = _normalize_related_id_set(old_ids) - {rid}
    new = _normalize_related_id_set(new_ids) - {rid}
    for tid in new - old:
        content_record_add_inverse_link(tid, rec)
    for tid in old - new:
        content_record_remove_inverse_link(tid, rid)


def purge_content_record_related_links(deleted_id: str) -> None:
    """Before delete: drop deleted_id from peers' refs and strip outgoing from deleted (peers)."""
    did = normalize_content_record_public_id(deleted_id)
    deleted = get_content_record(did)
    if not deleted:
        return
    for tid in content_record_related_ids_from_ext_json(deleted.get("ext_json") or "{}"):
        content_record_remove_inverse_link(tid, did)
    conn = get_connection()
    try:
        cur = conn.execute("SELECT id, ext_json FROM content_records WHERE id <> ?", (did,))
        for row in cur.fetchall():
            eid = normalize_content_record_public_id(row["id"])
            ext = _content_ext_json_dict(row["ext_json"])
            refs = _content_ext_refs_list(ext)
            if not any(str(r["id"]) == did for r in refs):
                continue
            refs = [r for r in refs if str(r.get("id") or "") != did]
            _set_related_refs_in_ext(ext, refs)
            update_content_record_ext_json_only(eid, json.dumps(ext, ensure_ascii=False))
    finally:
        conn.close()


def delete_content_record(record_id: str) -> bool:
    """Delete content record by id."""
    rid = normalize_content_record_public_id(record_id)
    purge_content_record_related_links(rid)
    conn = get_connection()
    try:
        conn.execute("DELETE FROM content_record_tags WHERE record_id = ?", (rid,))
        cur = conn.execute("DELETE FROM content_records WHERE id = ?", (rid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def get_content_record(record_id: str) -> Optional[Dict[str, Any]]:
    """Get one content record with tags."""
    rid = normalize_content_record_public_id(record_id)
    conn = get_connection()
    try:
        cur = conn.execute("SELECT * FROM content_records WHERE id = ?", (rid,))
        row = cur.fetchone()
        if not row:
            return None
        tags_cur = conn.execute(
            """
            SELECT t.id, t.name, t.record_type
            FROM content_record_tags rt
            INNER JOIN content_tags t ON t.id = rt.tag_id
            WHERE rt.record_id = ?
            ORDER BY t.name ASC
            """,
            (rid,),
        )
        tags = [
            {"id": r["id"], "name": r["name"] or "", "record_type": r["record_type"] or "all"}
            for r in tags_cur.fetchall()
        ]
        ls = "done"
        try:
            raw_ls = row["list_status"]
            if raw_ls in ("done", "wishlist"):
                ls = raw_ls
        except (KeyError, IndexError):
            pass
        try:
            episode_count = str(row["episode_count"] or "").strip()
        except (KeyError, IndexError):
            episode_count = ""
        return {
            "id": str(row["id"]),
            "record_type": row["record_type"] or "",
            "submit_date": row["submit_date"] or "",
            "title": row["title"] or "",
            "creator": row["creator"] or "",
            "category": row["category"] or "",
            "rating": int(row["rating"] or 0),
            "episode_count": episode_count,
            "summary": row["summary"] or "",
            "review": row["review"] or "",
            "original_work": row["original_work"] or "",
            "release_date": row["release_date"] or "",
            "related_series": row["related_series"] or "",
            "cover_url": row["cover_url"] or "",
            "source": row["source"] or "manual",
            "source_id": row["source_id"] or "",
            "ext_json": row["ext_json"] or "{}",
            "list_status": ls,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "tags": tags,
        }
    finally:
        conn.close()


def set_content_record_tags(record_id: str, tag_ids: List[int]) -> None:
    """Replace record tags by provided tag ids."""
    rid = normalize_content_record_public_id(record_id)
    conn = get_connection()
    try:
        conn.execute("BEGIN")
        conn.execute("DELETE FROM content_record_tags WHERE record_id = ?", (rid,))
        seen = set()
        for tid in tag_ids or []:
            try:
                n = int(tid)
            except Exception:
                continue
            if n in seen:
                continue
            seen.add(n)
            conn.execute(
                "INSERT OR IGNORE INTO content_record_tags (record_id, tag_id) VALUES (?, ?)",
                (rid, n),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def query_content_records(
    record_type: str = "",
    title_kw: str = "",
    creator_kw: str = "",
    category: str = "",
    rating: int = -1,
    tag_name: str = "",
    submit_start: str = "",
    submit_end: str = "",
    list_status: str = "",
    page: int = 1,
    page_size: int = 0,
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Query content records with filters.

    When page_size <= 0, returns all matching rows (total = number of rows returned).
    When page_size > 0, returns one page and total matching count (COUNT query).
    """
    conn = get_connection()
    try:
        clauses: List[str] = ["1=1"]
        params: List[Any] = []
        if record_type in ("watch", "book"):
            clauses.append("r.record_type = ?")
            params.append(record_type)
        ls = str(list_status or "").strip().lower()
        if ls in ("done", "wishlist"):
            clauses.append("r.list_status = ?")
            params.append(ls)
        if title_kw:
            clauses.append("r.title LIKE ?")
            params.append(f"%{title_kw}%")
        if creator_kw:
            clauses.append("r.creator LIKE ?")
            params.append(f"%{creator_kw}%")
        if category:
            clauses.append("r.category = ?")
            params.append(category)
        if isinstance(rating, int) and rating >= 0:
            clauses.append("r.rating = ?")
            params.append(rating)
        if submit_start:
            clauses.append("r.submit_date >= ?")
            params.append(submit_start)
        if submit_end:
            clauses.append("r.submit_date <= ?")
            params.append(submit_end)
        if tag_name:
            clauses.append(
                """
                EXISTS (
                    SELECT 1
                    FROM content_record_tags rt
                    INNER JOIN content_tags t ON t.id = rt.tag_id
                    WHERE rt.record_id = r.id AND t.name = ?
                )
                """
            )
            params.append(tag_name)
        where_sql = " AND ".join(clauses)
        base_sql = f"""
            SELECT
                r.id, r.record_type, r.submit_date, r.title, r.creator, r.category, r.rating,
                r.episode_count,
                r.summary, r.review, r.original_work, r.release_date, r.related_series, r.cover_url,
                r.source, r.source_id, r.ext_json, r.list_status, r.created_at, r.updated_at
            FROM content_records r
            WHERE {where_sql}
            ORDER BY r.submit_date DESC, r.updated_at DESC, r.id DESC
        """
        params_tuple = tuple(params)
        use_page = int(page_size) > 0
        if use_page:
            ps = max(1, min(int(page_size), 100))
            pg = max(1, int(page or 1))
            offset = (pg - 1) * ps
            count_cur = conn.execute(
                f"SELECT COUNT(*) AS c FROM content_records r WHERE {where_sql}",
                params_tuple,
            )
            total = int(count_cur.fetchone()["c"] or 0)
            cur = conn.execute(base_sql + " LIMIT ? OFFSET ?", params_tuple + (ps, offset))
        else:
            cur = conn.execute(base_sql, params_tuple)
            total = -1
        rows = cur.fetchall()
        if not use_page:
            total = len(rows)
        out: List[Dict[str, Any]] = []
        for row in rows:
            tags_cur = conn.execute(
                """
                SELECT t.id, t.name, t.record_type
                FROM content_record_tags rt
                INNER JOIN content_tags t ON t.id = rt.tag_id
                WHERE rt.record_id = ?
                ORDER BY t.name ASC
                """,
                (str(row["id"]),),
            )
            tags = [
                {"id": t["id"], "name": t["name"] or "", "record_type": t["record_type"] or "all"}
                for t in tags_cur.fetchall()
            ]
            row_ls = "done"
            try:
                v = row["list_status"]
                if v in ("done", "wishlist"):
                    row_ls = v
            except (KeyError, IndexError):
                pass
            try:
                ep_c = str(row["episode_count"] or "").strip()
            except (KeyError, IndexError):
                ep_c = ""
            out.append(
                {
                    "id": str(row["id"]),
                    "record_type": row["record_type"] or "",
                    "submit_date": row["submit_date"] or "",
                    "title": row["title"] or "",
                    "creator": row["creator"] or "",
                    "category": row["category"] or "",
                    "rating": int(row["rating"] or 0),
                    "episode_count": ep_c,
                    "summary": row["summary"] or "",
                    "review": row["review"] or "",
                    "original_work": row["original_work"] or "",
                    "release_date": row["release_date"] or "",
                    "related_series": row["related_series"] or "",
                    "cover_url": row["cover_url"] or "",
                    "source": row["source"] or "manual",
                    "source_id": row["source_id"] or "",
                    "ext_json": row["ext_json"] or "{}",
                    "list_status": row_ls,
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                    "tags": tags,
                }
            )
        return out, total
    finally:
        conn.close()


def search_content_record_titles(
    title_kw: str,
    exclude_id: str = "",
    limit: int = 40,
) -> List[Dict[str, Any]]:
    """
    Lightweight fuzzy title search for content form pickers (LIKE %kw%).
    """
    kw = (title_kw or "").strip()
    if not kw:
        return []
    try:
        lim = int(limit)
    except (TypeError, ValueError):
        lim = 40
    lim = max(1, min(lim, 80))
    exc = ""
    if exclude_id and is_valid_content_record_public_id(exclude_id):
        exc = normalize_content_record_public_id(exclude_id)
    conn = get_connection()
    try:
        if exc:
            cur = conn.execute(
                """
                SELECT id, record_type, title
                FROM content_records
                WHERE title LIKE ? AND id <> ?
                ORDER BY submit_date DESC, updated_at DESC, id DESC
                LIMIT ?
                """,
                (f"%{kw}%", exc, lim),
            )
        else:
            cur = conn.execute(
                """
                SELECT id, record_type, title
                FROM content_records
                WHERE title LIKE ?
                ORDER BY submit_date DESC, updated_at DESC, id DESC
                LIMIT ?
                """,
                (f"%{kw}%", lim),
            )
        rows = cur.fetchall()
        return [
            {
                "id": str(row["id"]),
                "title": (row["title"] or "").strip(),
                "record_type": (row["record_type"] or "").strip(),
            }
            for row in rows
        ]
    finally:
        conn.close()


def get_content_calendar_aggregates(start_date: str, end_date: str) -> Dict[str, Dict[str, int]]:
    """Aggregate watch/book counts by submit_date within range (已看完 list_status=done only)."""
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            SELECT submit_date, record_type, COUNT(1) AS c
            FROM content_records
            WHERE submit_date >= ? AND submit_date <= ? AND list_status = 'done'
            GROUP BY submit_date, record_type
            """,
            (start_date or "", end_date or ""),
        )
        out: Dict[str, Dict[str, int]] = {}
        for row in cur.fetchall():
            d = row["submit_date"] or ""
            if not d:
                continue
            item = out.setdefault(d, {"watch_count": 0, "book_count": 0})
            rt = row["record_type"] or ""
            if rt == "watch":
                item["watch_count"] = int(row["c"] or 0)
            elif rt == "book":
                item["book_count"] = int(row["c"] or 0)
        return out
    finally:
        conn.close()

