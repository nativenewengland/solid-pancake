#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ENTRIES_DIR = Path('data/wiki-entries')
OUTPUT_PATH = Path('data/wiki-entries.json')


def main() -> None:
    if not ENTRIES_DIR.exists():
        raise SystemExit(f"Missing entries directory: {ENTRIES_DIR}")

    entries: dict[str, object] = {}
    for path in sorted(ENTRIES_DIR.glob('*.json')):
        with path.open(encoding='utf-8') as handle:
            entries[path.stem] = json.load(handle)

    OUTPUT_PATH.write_text(
        json.dumps(entries, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8',
    )


if __name__ == '__main__':
    main()
