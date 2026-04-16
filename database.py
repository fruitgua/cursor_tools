import os
import sqlite3
import json
from datetime import datetime
from typing import Optional, List, Dict, Tuple


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
    return conn


def init_db() -> None:
    """
    Initialize the SQLite database, creating tables if they do not exist.

    The table structure:
        remarks (
            path TEXT PRIMARY KEY,
            remark TEXT
        )
        accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            system TEXT,
            url TEXT,
            account_info TEXT,
            created_at REAL
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
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_type TEXT NOT NULL DEFAULT 'system',
                system TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                account_info TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
            )
            """
        )
        conn.commit()
        try:
            conn.execute("ALTER TABLE accounts ADD COLUMN description TEXT NOT NULL DEFAULT ''")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        # 兼容旧版 accounts 表：补充 account_type 字段，并回填历史数据为 system
        try:
            conn.execute("ALTER TABLE accounts ADD COLUMN account_type TEXT NOT NULL DEFAULT 'system'")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute(
                """
                UPDATE accounts SET account_type = 'system'
                WHERE account_type IS NULL OR account_type = ''
                """
            )
            conn.commit()
        except Exception:
            pass
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
            CREATE TABLE IF NOT EXISTS ip_access_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                ip TEXT NOT NULL,
                path TEXT NOT NULL
            )
            """
        )
        conn.commit()
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


def get_all_accounts() -> list:
    """
    Retrieve all accounts ordered by creation time (id).

    :return: List of dicts with id, account_type, system, url, account_info, description.
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, account_type, system, url, account_info, description FROM accounts ORDER BY id ASC"
        )
        rows = cur.fetchall()
        return [
            {
                "id": row["id"],
                "account_type": row["account_type"] or "system",
                "system": row["system"] or "",
                "url": row["url"] or "",
                "account_info": row["account_info"] or "",
                "description": row["description"] or "",
            }
            for row in rows
        ]
    finally:
        conn.close()


def add_account(account_type: str, system: str, url: str, account_info: str, description: str = "") -> int:
    """
    Insert a new account record.

    :param system: System name.
    :param url: Website URL.
    :param account_info: Account information.
    :param description: Optional description.
    :return: The id of the inserted row.
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO accounts (account_type, system, url, account_info, description) VALUES (?, ?, ?, ?, ?)",
            (account_type or "system", system or "", url or "", account_info or "", description or ""),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def update_account(
    account_id: int, account_type: str, system: str, url: str, account_info: str, description: str = ""
) -> bool:
    """
    Update an existing account by id.

    :param account_id: Account id.
    :param system: System name.
    :param url: Website URL.
    :param account_info: Account information.
    :param description: Optional description.
    :return: True if updated, False if not found.
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            UPDATE accounts SET account_type = ?, system = ?, url = ?, account_info = ?, description = ?
            WHERE id = ?
            """,
            (account_type or "system", system or "", url or "", account_info or "", description or "", account_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def swap_accounts(account_id1: int, account_id2: int) -> bool:
    """
    Swap the content (system, url, account_info, description) of two accounts.

    :param account_id1: First account id.
    :param account_id2: Second account id.
    :return: True if both swapped successfully.
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, account_type, system, url, account_info, description FROM accounts WHERE id IN (?, ?)",
            (account_id1, account_id2),
        )
        rows = cur.fetchall()
        if len(rows) != 2:
            return False
        data = {
            row["id"]: {
                "account_type": row["account_type"] or "system",
                "system": row["system"] or "",
                "url": row["url"] or "",
                "account_info": row["account_info"] or "",
                "description": row["description"] or "",
            }
            for row in rows
        }
        if account_id1 not in data or account_id2 not in data:
            return False

        d1, d2 = data[account_id1], data[account_id2]
        conn.execute(
            """
            UPDATE accounts SET account_type = ?, system = ?, url = ?, account_info = ?, description = ?
            WHERE id = ?
            """,
            (d2["account_type"], d2["system"], d2["url"], d2["account_info"], d2["description"], account_id1),
        )
        conn.execute(
            """
            UPDATE accounts SET account_type = ?, system = ?, url = ?, account_info = ?, description = ?
            WHERE id = ?
            """,
            (d1["account_type"], d1["system"], d1["url"], d1["account_info"], d1["description"], account_id2),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def delete_account(account_id: int) -> bool:
    """
    Delete an account by id.

    :param account_id: Account id.
    :return: True if deleted, False if not found.
    """
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
        conn.commit()
        return cur.rowcount > 0
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

