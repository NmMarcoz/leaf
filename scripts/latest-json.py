#!/usr/bin/env python3
"""Build the updater's latest.json from a release's signature files.

tauri-action can write latest.json itself, but each runner does it by
downloading the current file, merging its own platform in and re-uploading —
so runners building at the same time overwrite each other's entries. The
release workflow turns that off (`includeUpdaterJson: false`), lets every
platform build at once, and calls this exactly once at the end.

The output mirrors what tauri-action v0 writes (src/upload-version-json.ts),
because that is what every installed copy's updater already reads:

- `{os}-{arch}-{bundle}` for every signed bundle;
- `{os}-{arch}` for the preferred one per OS: the NSIS .exe over the .msi
  (the .msi needs elevation and would prompt for UAC on every update) and the
  AppImage on Linux;
- a universal macOS bundle answers for both darwin architectures.

Usage:
    latest-json.py --tag v1.2.3 --repo owner/name --notes notes.md \
        --out latest.json  SIG_FILE...

Each SIG_FILE is named exactly like the release asset it signs plus `.sig`,
which is how they come down from `gh release download -p '*.sig'`.
"""

import argparse
import datetime
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

# (suffix of the signed asset, os, bundle, priority for the bare `{os}-{arch}` key)
BUNDLES = [
    (".app.tar.gz", "darwin", "app", 0),
    ("-setup.exe", "windows", "nsis", 100),
    (".msi", "windows", "msi", 99),
    (".AppImage", "linux", "appimage", 100),
    (".deb", "linux", "deb", 0),
    (".rpm", "linux", "rpm", 0),
]

ARCHES = {
    "universal": "universal",
    "aarch64": "aarch64",
    "arm64": "aarch64",
    "x86_64": "x86_64",
    "x64": "x86_64",
    "amd64": "x86_64",
}


def classify(asset: str):
    for suffix, os_, bundle, priority in BUNDLES:
        if asset.endswith(suffix):
            break
    else:
        return None
    # Arch is a token in the name (Leaf_1.0.0_x64-setup.exe,
    # Leaf-1.0.0-1.x86_64.rpm, Leaf_universal.app.tar.gz). Longest first so
    # x86_64 is not read as x64.
    for token in sorted(ARCHES, key=len, reverse=True):
        if re.search(rf"(^|[_.\-]){re.escape(token)}([_.\-]|$)", asset):
            return os_, ARCHES[token], bundle, priority
    sys.exit(f"cannot tell the architecture of {asset}")


def build(tag: str, repo: str, notes: str, sigs: list[Path]) -> dict:
    platforms: dict[str, dict] = {}
    primary: dict[str, tuple[int, dict]] = {}

    for sig in sorted(sigs):
        asset = sig.name.removesuffix(".sig")
        kind = classify(asset)
        if kind is None:
            print(f"skipping {sig.name}: not an updater bundle", file=sys.stderr)
            continue
        os_, arch, bundle, priority = kind
        entry = {
            "signature": sig.read_text().strip(),
            "url": f"https://github.com/{repo}/releases/download/{quote(tag)}/{quote(asset)}",
        }
        arches = ["aarch64", "x86_64"] if arch == "universal" else [arch]
        for a in arches:
            platforms[f"{os_}-{a}-{bundle}"] = entry
            best = primary.get(f"{os_}-{a}")
            if best is None or priority > best[0]:
                primary[f"{os_}-{a}"] = (priority, entry)

    if not platforms:
        sys.exit("no updater signatures found; refusing to write an empty latest.json")

    for key, (_, entry) in primary.items():
        platforms[key] = entry

    return {
        "version": tag.removeprefix("v"),
        "notes": notes,
        "pub_date": datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
        "platforms": dict(sorted(platforms.items())),
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--tag", required=True)
    p.add_argument("--repo", required=True)
    p.add_argument("--notes", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("sigs", nargs="+", type=Path)
    args = p.parse_args()

    doc = build(args.tag, args.repo, args.notes.read_text(encoding="utf-8").strip(), args.sigs)
    args.out.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for key, entry in doc["platforms"].items():
        print(f"{key:28} {entry['url'].rsplit('/', 1)[-1]}")


if __name__ == "__main__":
    main()
