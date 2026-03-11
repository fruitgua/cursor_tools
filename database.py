import os
import sqlite3
from typing import Optional


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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
            )
            """
        )
        conn.commit()
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


def get_all_accounts() -> list:
    """
    Retrieve all accounts ordered by creation time (id).

    :return: List of dicts with id, system, url, account_info, description.
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, system, url, account_info, description FROM accounts ORDER BY id ASC"
        )
        rows = cur.fetchall()
        return [
            {
                "id": row["id"],
                "system": row["system"] or "",
                "url": row["url"] or "",
                "account_info": row["account_info"] or "",
                "description": row["description"] or "",
            }
            for row in rows
        ]
    finally:
        conn.close()


def add_account(system: str, url: str, account_info: str, description: str = "") -> int:
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
            "INSERT INTO accounts (system, url, account_info, description) VALUES (?, ?, ?, ?)",
            (system or "", url or "", account_info or "", description or ""),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def update_account(
    account_id: int, system: str, url: str, account_info: str, description: str = ""
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
            UPDATE accounts SET system = ?, url = ?, account_info = ?, description = ?
            WHERE id = ?
            """,
            (system or "", url or "", account_info or "", description or "", account_id),
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
            "SELECT id, system, url, account_info, description FROM accounts WHERE id IN (?, ?)",
            (account_id1, account_id2),
        )
        rows = cur.fetchall()
        if len(rows) != 2:
            return False
        data = {
            row["id"]: {
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
            UPDATE accounts SET system = ?, url = ?, account_info = ?, description = ?
            WHERE id = ?
            """,
            (d2["system"], d2["url"], d2["account_info"], d2["description"], account_id1),
        )
        conn.execute(
            """
            UPDATE accounts SET system = ?, url = ?, account_info = ?, description = ?
            WHERE id = ?
            """,
            (d1["system"], d1["url"], d1["account_info"], d1["description"], account_id2),
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
            "SELECT id, title, category, content, created_at FROM notes ORDER BY created_at DESC"
        )
        rows = cur.fetchall()
        return [
            {
                "id": row["id"],
                "title": row["title"] or "",
                "category": row["category"] or "",
                "content": row["content"] or "",
                "created_at": row["created_at"],
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
            "SELECT id, title, category, content, created_at FROM notes WHERE id = ?",
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
            "INSERT INTO notes (title, category, content) VALUES (?, ?, ?)",
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
            UPDATE notes SET title = ?, category = ?, content = ?
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

