import os
import time
from datetime import datetime
from typing import Dict, Any, List, Optional

from database import get_remark


# File type mapping configuration
EXTENSION_TYPE_MAP = {
    # Word
    ".doc": ("Word", "word"),
    ".docx": ("Word", "word"),
    # Excel
    ".xls": ("Excel", "excel"),
    ".xlsx": ("Excel", "excel"),
    # PPT
    ".ppt": ("PPT", "ppt"),
    ".pptx": ("PPT", "ppt"),
    # PDF
    ".pdf": ("PDF", "pdf"),
    # Prototype
    ".rp": ("原型", "prototype"),
    ".rplib": ("原型元件", "prototype_component"),
}


def validate_directory_path(path: str) -> bool:
    """
    Validate that a given path is an existing directory.

    :param path: Directory path provided by the user.
    :return: True if the directory exists and is accessible, else False.
    """
    if not path:
        return False
    return os.path.isdir(path)


def classify_file(file_path: str) -> Optional[Dict[str, Any]]:
    """
    Classify a file based on its extension and build base metadata.

    :param file_path: Absolute file path.
    :return: Metadata dict if file matches known types, otherwise None.
    """
    _, ext = os.path.splitext(file_path)
    ext_lower = ext.lower()

    if ext_lower not in EXTENSION_TYPE_MAP:
        return None

    display_type, type_key = EXTENSION_TYPE_MAP[ext_lower]

    stat = os.stat(file_path)
    size_bytes = stat.st_size
    size_display = format_size(size_bytes)

    # On macOS, st_birthtime is creation time; fallback to ctime if missing.
    created_ts = getattr(stat, "st_birthtime", stat.st_ctime)
    modified_ts = stat.st_mtime

    created_at = format_timestamp(created_ts)
    modified_at = format_timestamp(modified_ts)

    name = os.path.basename(file_path)
    folder_path = os.path.dirname(file_path)
    is_hidden = name.startswith(".")

    remark = get_remark(file_path) or ""

    return {
        "name": name,
        "size_display": size_display,
        "size_bytes": size_bytes,
        "file_type": display_type,
        "file_type_key": type_key,
        "extension": ext_lower,
        "remark": remark,
        "created_at": created_at,
        "modified_at": modified_at,
        "created_at_ts": float(created_ts),
        "modified_at_ts": float(modified_ts),
        "folder_path": folder_path,
        "full_path": file_path,
        "is_hidden": is_hidden,
    }


def format_size(size_bytes: int) -> str:
    """
    Format file size in bytes into human-readable KB or MB.

    :param size_bytes: File size in bytes.
    :return: Formatted size string with unit.
    """
    if size_bytes < 0:
        size_bytes = 0

    kb = size_bytes / 1024.0
    if kb < 1024:
        return f"{kb:.2f} KB"

    mb = kb / 1024.0
    return f"{mb:.2f} MB"


def format_timestamp(timestamp: float) -> str:
    """
    Format POSIX timestamp into a readable string.

    :param timestamp: POSIX timestamp.
    :return: Formatted time string "YYYY-MM-DD HH:MM:SS".
    """
    try:
        dt = datetime.fromtimestamp(timestamp)
    except (OverflowError, OSError, ValueError):
        # Fallback to current time if timestamp invalid.
        dt = datetime.fromtimestamp(time.time())
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def scan_directory(root_dir: str) -> List[Dict[str, Any]]:
    """
    Recursively scan a directory using os.walk and collect classified files.

    Hidden files and directories are included. Files that do not match
    known extensions are ignored.

    :param root_dir: Root directory to start scanning from.
    :return: List of metadata dictionaries for all matched files.
    """
    results: List[Dict[str, Any]] = []

    for dirpath, dirnames, filenames in os.walk(root_dir):
        # Do not skip hidden directories, include everything
        for filename in filenames:
            full_path = os.path.join(dirpath, filename)

            if not os.path.isfile(full_path):
                # Skip non-regular files just in case
                continue

            meta = classify_file(full_path)
            if meta is not None:
                results.append(meta)

    return results

