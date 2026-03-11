import os
import json
from datetime import datetime, date, timedelta
from typing import List, Dict, Any, Optional, Tuple

from flask import Flask, jsonify, render_template, request, Response, redirect, url_for
from send2trash import send2trash

from database import (
    init_db,
    get_remark,
    set_remark,
    update_path,
    get_all_accounts,
    add_account,
    update_account,
    delete_account,
    swap_accounts,
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
)
from utils import scan_directory, validate_directory_path


app = Flask(__name__)

# Initialize SQLite database for remarks storage.
init_db()

# In-memory cache for the last scan result
SCAN_RESULTS: List[Dict[str, Any]] = []

CHECKIN_STATE_KEY = "checkin_data"
DEFAULT_CHECKIN_STATE: Dict[str, Any] = {
    "events": [],
    "records": [],
    "dateLabels": {"specific": {}, "annual": {}},
}

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


@app.route("/")
def index() -> str:
    """
    Redirect root URL to /home so that http://127.0.0.1:5000/ opens the home page.
    """
    return redirect(url_for("home"))


@app.route("/home")
def home() -> str:
    """
    Render the home page.
    :return: Rendered HTML content.
    """
    return render_template("home.html")


@app.route("/files")
def file_manager_page() -> str:
    """
    Render the local file management tool page.
    :return: Rendered HTML content.
    """
    return render_template("index.html")


@app.route("/accounts")
def accounts_page() -> str:
    """
    Render the common accounts management page.
    :return: Rendered HTML content.
    """
    return render_template("accounts.html")


@app.route("/notes")
def notes_page() -> str:
    """
    Render the study notes page.
    :return: Rendered HTML content.
    """
    return render_template("notes.html")


@app.route("/todos")
def todos_page() -> str:
    """
    Render the todo management page.
    :return: Rendered HTML content.
    """
    return render_template("todos.html")

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
    """Swap bookmark with the previous one in the list."""
    try:
        items = get_all_bookmarks()
        ids = [item["id"] for item in items]
        if bookmark_id not in ids:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        idx = ids.index(bookmark_id)
        if idx <= 0:
            return jsonify({"success": False, "message": "已是第一条，无法上移"}), 400
        prev_id = ids[idx - 1]
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


@app.route("/api/accounts", methods=["GET"])
def api_accounts_list() -> Any:
    """
    Return all accounts ordered by id.
    :return: JSON with list of accounts.
    """
    try:
        items = get_all_accounts()
        return jsonify({"success": True, "items": items})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/accounts", methods=["POST"])
def api_accounts_add() -> Any:
    """
    Add a new account.
    Request JSON: { "system": "", "url": "", "account_info": "" }
    :return: JSON with new item id.
    """
    data = request.get_json(silent=True) or {}
    system = data.get("system", "")
    url = data.get("url", "")
    account_info = data.get("account_info", "")
    description = data.get("description", "")
    try:
        row_id = add_account(system, url, account_info, description)
        return jsonify({"success": True, "id": row_id})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/accounts/<int:account_id>", methods=["PUT"])
def api_accounts_update(account_id: int) -> Any:
    """
    Update an existing account.
    Request JSON: { "system": "", "url": "", "account_info": "" }
    :return: JSON success status.
    """
    data = request.get_json(silent=True) or {}
    system = data.get("system", "")
    url = data.get("url", "")
    account_info = data.get("account_info", "")
    description = data.get("description", "")
    try:
        ok = update_account(account_id, system, url, account_info, description)
        if not ok:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/accounts/<int:account_id>/move-up", methods=["POST"])
def api_accounts_move_up(account_id: int) -> Any:
    """
    Swap the account with the previous one in the list.
    :return: JSON success status.
    """
    try:
        items = get_all_accounts()
        ids = [item["id"] for item in items]
        if account_id not in ids:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        idx = ids.index(account_id)
        if idx <= 0:
            return jsonify({"success": False, "message": "已是第一条，无法上移"}), 400
        prev_id = ids[idx - 1]
        ok = swap_accounts(account_id, prev_id)
        if not ok:
            return jsonify({"success": False, "message": "交换失败"}), 500
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route("/api/accounts/<int:account_id>", methods=["DELETE"])
def api_accounts_delete(account_id: int) -> Any:
    """
    Delete an account.
    :return: JSON success status.
    """
    try:
        ok = delete_account(account_id)
        if not ok:
            return jsonify({"success": False, "message": "记录不存在"}), 404
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500


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


@app.route("/api/checkin/state", methods=["GET"])
def api_checkin_get_state() -> Any:
    """
    Get persisted checkin state (events, records, dateLabels) from the server.
    """
    try:
        raw = get_app_state(CHECKIN_STATE_KEY)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"读取打卡数据失败：{exc}"}), 500

    if not raw:
        return jsonify({"success": True, "data": DEFAULT_CHECKIN_STATE})
    try:
        data = json.loads(raw)
    except Exception:
        data = DEFAULT_CHECKIN_STATE
    # Ensure required keys exist
    if not isinstance(data, dict):
        data = DEFAULT_CHECKIN_STATE
    data.setdefault("events", [])
    data.setdefault("records", [])
    data.setdefault("dateLabels", {"specific": {}, "annual": {}})
    return jsonify({"success": True, "data": data})


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
        payload = json.dumps(data, ensure_ascii=False)
        set_app_state(CHECKIN_STATE_KEY, payload)
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"保存打卡数据失败：{exc}"}), 500


@app.route("/api/checkin/export", methods=["GET"])
def api_checkin_export() -> Response:
    """
    Export checkin state as a downloadable JSON file.
    """
    try:
        raw = get_app_state(CHECKIN_STATE_KEY)
    except Exception:
        raw = None

    if not raw:
        raw = json.dumps(DEFAULT_CHECKIN_STATE, ensure_ascii=False, indent=2)
    filename = f"checkin_export_{datetime.utcnow().strftime('%Y%m%d')}.json"
    resp = Response(raw, mimetype="application/json; charset=utf-8")
    resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp


@app.route("/api/checkin/mark-history-complete", methods=["POST"])
def api_checkin_mark_history_complete() -> Any:
    """
    将每个打卡事件在“今天”之前的历史日期统一标记为“已完成”，并写回服务端。

    规则：
    - 仅处理 type == "checkin" 的事件。
    - 必须有合法的 dateStart；dateEnd 若不存在，则视为“今天前一天”。
    - 对于每个事件，在 [dateStart, min(dateEnd, 今天前一天)] 区间内的每一天都补齐记录。
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

    events = list(data.get("events") or [])
    records = list(data.get("records") or [])
    date_labels = data.get("dateLabels") or {"specific": {}, "annual": {}}

    # 已有记录索引，避免重复
    existing = {
        f"{r.get('eventId')}|{r.get('date')}"
        for r in records
        if r.get("eventId") and r.get("date")
    }

    today = date.today()
    yesterday = today - timedelta(days=1)

    added = 0
    for evt in events:
        if not isinstance(evt, dict):
            continue
        if evt.get("type", "checkin") != "checkin":
            continue
        event_id = evt.get("id") or evt.get("eventId")
        if not event_id:
            continue
        date_start_str = evt.get("dateStart") or ""
        date_end_str = evt.get("dateEnd") or ""
        if not date_start_str:
            continue
        try:
            start_dt = datetime.strptime(date_start_str.split("T")[0], "%Y-%m-%d").date()
        except ValueError:
            continue

        if date_end_str:
            try:
                end_dt = datetime.strptime(date_end_str.split("T")[0], "%Y-%m-%d").date()
            except ValueError:
                end_dt = yesterday
        else:
            end_dt = yesterday

        # 只处理“今天之前”的日期
        if end_dt >= yesterday:
            end_dt = yesterday

        if end_dt < start_dt:
            continue

        cur = start_dt
        while cur <= end_dt:
            date_str = cur.strftime("%Y-%m-%d")
            key = f"{event_id}|{date_str}"
            if key not in existing:
                records.append({"eventId": event_id, "date": date_str})
                existing.add(key)
                added += 1
            cur += timedelta(days=1)

    data_out = {
        "events": events,
        "records": records,
        "dateLabels": date_labels,
    }

    try:
        payload = json.dumps(data_out, ensure_ascii=False)
        set_app_state(CHECKIN_STATE_KEY, payload)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"保存打卡数据失败：{exc}"}), 500

    return jsonify({"success": True, "added": added, "data": data_out})


@app.route("/api/vocab/state", methods=["GET"])
def api_vocab_get_state() -> Any:
    """
    获取服务端保存的单词本数据。
    """
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

    data_out: Dict[str, Any] = {
        "items": items,
        "tags": tags,
    }
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
        payload = json.dumps(data, ensure_ascii=False)
        set_app_state(VOCAB_STATE_KEY, payload)
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"保存词汇数据失败：{exc}"}), 500


@app.route("/api/todos/state", methods=["GET"])
def api_todos_get_state() -> Any:
    """
    获取服务端保存的待办事项数据。
    """
    try:
        raw = get_app_state(TODOS_STATE_KEY)
    except Exception as exc:  # pylint: disable=broad-except
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
        payload = json.dumps(data, ensure_ascii=False)
        set_app_state(TODOS_STATE_KEY, payload)
        return jsonify({"success": True})
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"保存待办数据失败：{exc}"}), 500


def main() -> None:
    """
    Application entry point for running the Flask development server.
    """
    app.run(host="127.0.0.1", port=5000, debug=True)


if __name__ == "__main__":
    main()

