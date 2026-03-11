#!/usr/bin/env python3
"""
Import bookmarks from book.html (Netscape bookmark format) into the bookmarks database.
"""
import os
import re
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import init_db, add_bookmark, get_all_bookmarks


def parse_netscape_bookmarks(html_path: str) -> list[dict]:
    """
    Parse Netscape bookmark HTML file.
    Returns list of dicts: [{"title": str, "url": str, "category": str}, ...]
    """
    with open(html_path, "r", encoding="utf-8") as f:
        content = f.read()

    bookmarks = []
    category_stack = []

    # Match <DT><H3 ...>folder_name</H3> for folders
    h3_pattern = re.compile(r"<DT><H3[^>]*>([^<]+)</H3>", re.IGNORECASE)
    # Match <DT><A HREF="url" ...>title</A> for links
    a_pattern = re.compile(
        r'<DT><A\s+HREF="([^"]+)"[^>]*>([^<]+)</A>',
        re.IGNORECASE,
    )
    # Match </DL> to pop category
    dl_close = re.compile(r"</DL>", re.IGNORECASE)

    lines = content.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]

        # Check for folder (H3)
        h3_match = h3_pattern.search(line)
        if h3_match:
            folder_name = h3_match.group(1).strip()
            # Skip root-level folders like "Mozilla Firefox", "书签菜单"
            if folder_name not in ("Mozilla Firefox", "书签菜单", "Bookmarks"):
                category_stack.append(folder_name)
            i += 1
            continue

        # Check for link (A)
        a_match = a_pattern.search(line)
        if a_match:
            url = a_match.group(1).strip()
            title = a_match.group(2).strip()
            category = category_stack[-1] if category_stack else ""
            if url and title:
                bookmarks.append({"title": title, "url": url, "category": category})
            i += 1
            continue

        # Check for </DL> - pop category
        if dl_close.search(line):
            if category_stack:
                category_stack.pop()
            i += 1
            continue

        i += 1

    return bookmarks


def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    book_path = os.path.join(base_dir, "templates", "book.html")

    if not os.path.exists(book_path):
        print(f"Error: {book_path} not found")
        sys.exit(1)

    print(f"Parsing {book_path}...")
    items = parse_netscape_bookmarks(book_path)
    print(f"Found {len(items)} bookmarks")

    init_db()
    existing = get_all_bookmarks()
    existing_urls = {b["url"] for b in existing}

    added = 0
    skipped = 0
    for item in items:
        if item["url"] in existing_urls:
            skipped += 1
            continue
        try:
            add_bookmark(item["title"], item["url"], item["category"])
            added += 1
        except Exception as e:
            print(f"  Skip {item['title'][:30]}...: {e}")

    print(f"Added {added} bookmarks, skipped {skipped} duplicates")
    print("Done.")


if __name__ == "__main__":
    main()
