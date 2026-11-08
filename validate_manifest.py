#!/usr/bin/env python3
"""Validasi manifest.json terhadap skema plugin Nuvio sebelum push.

Pelajaran dari bug 2026-11-08: entri scraper baru memakai field "file"
padahal Nuvio mewajibkan "filename" — repo ditolak aplikasi.
Jalankan skrip ini setiap habis mengedit manifest.json:
    python3 validate_manifest.py
Keluar dengan kode 1 bila ada masalah.
"""
import json, os, sys

REQUIRED = ["id", "name", "description", "version", "author", "filename",
            "supportedTypes", "enabled", "contentLanguage", "formats", "logo"]

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "manifest.json")) as f:
        m = json.load(f)
    problems = []
    if not m.get("version"):
        problems.append("manifest tanpa version")
    scrapers = m.get("scrapers")
    if not isinstance(scrapers, list) or not scrapers:
        problems.append("scrapers kosong")
        scrapers = []
    ids = set()
    for i, s in enumerate(scrapers):
        for k in REQUIRED:
            if k not in s:
                problems.append(f"scrapers[{i}] ({s.get('id', '?')}): field wajib '{k}' hilang")
        if "file" in s:
            problems.append(f"scrapers[{i}] ({s.get('id', '?')}): pakai 'file' — harusnya 'filename'")
        if s.get("id") in ids:
            problems.append(f"id duplikat: {s.get('id')}")
        ids.add(s.get("id"))
        fn = s.get("filename", "")
        if fn and not os.path.exists(os.path.join(here, fn)):
            problems.append(f"scrapers[{i}] ({s.get('id', '?')}): file tidak ada: {fn}")
    if problems:
        print("MANIFEST BERMASALAH:")
        for p in problems:
            print(" -", p)
        sys.exit(1)
    print(f"manifest OK — version {m['version']}, {len(scrapers)} scrapers, semua field valid.")

if __name__ == "__main__":
    main()
