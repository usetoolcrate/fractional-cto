#!/usr/bin/env python3
"""
concrete-scan.py — Concrete CMS (concrete5) prospect fingerprinter.

Feed it a text file of domains (one per line, comments with #). It fetches each
site's homepage once, detects whether it runs Concrete CMS, extracts the version
when the site announces it, flags end-of-life installs (v8 and older — no
security patches since 2024-12-31), and scrapes any contact email/phone the
homepage exposes. Output is a CSV sorted hottest-first.

Usage:
    python3 tools/concrete-scan.py domains.txt
    python3 tools/concrete-scan.py domains.txt -o prospects.csv --workers 8 --delay 0.5

Polite by design: one request per site, honest User-Agent, configurable delay.
Stdlib only — no pip installs needed.
"""

import argparse
import concurrent.futures
import csv
import re
import ssl
import sys
import threading
import time
import urllib.request
from urllib.error import HTTPError, URLError

UA = "Mozilla/5.0 (Macintosh) SchottkyScan/1.0 (site modernization research; alex@schottky.com)"
TIMEOUT = 12

GENERATOR_RE = re.compile(
    r'<meta[^>]+name=["\']generator["\'][^>]+content=["\']([^"\']*concrete[^"\']*)["\']', re.I)
GENERATOR_RE2 = re.compile(
    r'<meta[^>]+content=["\']([^"\']*concrete[^"\']*)["\'][^>]+name=["\']generator["\']', re.I)
VERSION_RE = re.compile(r'(\d+(?:\.\d+){1,3})')
EMAIL_RE = re.compile(r'mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', re.I)
TEL_RE = re.compile(r'tel:([+0-9()\-. ]{7,20})')
TITLE_RE = re.compile(r'<title[^>]*>([^<]{0,200})', re.I | re.S)

SIGNALS = [
    ("generator", None),                       # handled specially
    ("/concrete/ assets", re.compile(r'["\'](?:https?://[^"\']+)?/concrete/(?:themes|js|css|blocks|images)/', re.I)),
    ("CCM_ globals", re.compile(r'\bCCM_(?:DISPATCHER_FILENAME|CID|IMAGE_PATH|REL|APPLICATION_URL)\b')),
    ("ccm_paths", re.compile(r'/application/files/|ccm\.app\.js|ccm_nocache', re.I)),
    ("index.php/ccm", re.compile(r'index\.php/ccm/', re.I)),
]

print_lock = threading.Lock()
ssl_ctx = ssl.create_default_context()
# Some old concrete5 servers run ancient TLS setups; fall back to unverified
# rather than losing the prospect (we only read public homepages).
ssl_ctx_lax = ssl._create_unverified_context()


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    for ctx in (ssl_ctx, ssl_ctx_lax):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
                body = r.read(400_000)  # first 400KB is plenty
                charset = r.headers.get_content_charset() or "utf-8"
                return body.decode(charset, errors="replace"), r.geturl(), None
        except ssl.SSLError:
            continue
        except URLError as e:
            if isinstance(getattr(e, "reason", None), ssl.SSLError):
                continue  # cert problem (bad chain, or python missing local certs) — retry lax
            return None, url, f"{type(e).__name__}: {e}"
        except (HTTPError, TimeoutError, ConnectionError, OSError) as e:
            return None, url, f"{type(e).__name__}: {e}"
    return None, url, "SSL failure"


def classify(version, generator, signals):
    """Return (priority_rank, priority_label, eol).

    Branding is itself a version tell: pre-v9 installs announce "concrete5",
    the v9 rebrand announces "Concrete CMS".
    """
    if version:
        major = int(version.split(".")[0])
        if major < 9:
            return 0, "EOL_CONFIRMED", "yes"   # 5.x–8.x — support ended 2024-12-31
        return 3, "CURRENT_V9", "no"
    if generator and "concrete5" in generator.lower():
        return 0, "LIKELY_EOL_OLD_BRANDING", "likely"   # concrete5 branding = pre-v9
    if generator:  # "Concrete CMS" branding, version hidden
        return 3, "CURRENT_LIKELY_V9", "no"
    if signals:
        return 1, "CONCRETE_VERSION_UNKNOWN", "likely"
    return 4, "NOT_CONCRETE", ""


def scan(domain, delay):
    domain = domain.strip().rstrip("/")
    if not domain or domain.startswith("#"):
        return None
    bare = re.sub(r"^https?://", "", domain)
    time.sleep(delay)

    html, final_url, err = fetch(f"https://{bare}")
    if html is None:
        html, final_url, err2 = fetch(f"http://{bare}")
        err = err if html is None else None

    row = {"domain": bare, "priority": "", "version": "", "eol": "", "signals": "",
           "title": "", "emails": "", "phones": "", "final_url": final_url, "error": ""}

    if html is None:
        row["priority"], row["_rank"], row["error"] = "ERROR", 5, err or "unreachable"
        return row

    found = []
    version = ""
    generator = ""
    m = GENERATOR_RE.search(html) or GENERATOR_RE2.search(html)
    if m:
        generator = m.group(1).strip()
        found.append(f"generator:{generator}")
        vm = VERSION_RE.search(generator)
        if vm:
            version = vm.group(1)
    for name, rx in SIGNALS[1:]:
        if rx.search(html):
            found.append(name)

    rank, label, eol = classify(version, generator, found)
    tm = TITLE_RE.search(html)

    row.update({
        "priority": label, "_rank": rank, "version": version, "eol": eol,
        "signals": "; ".join(found),
        "title": re.sub(r"\s+", " ", tm.group(1)).strip() if tm else "",
        "emails": "; ".join(sorted(set(e.lower() for e in EMAIL_RE.findall(html)))[:3]),
        "phones": "; ".join(sorted(set(p.strip() for p in TEL_RE.findall(html)))[:2]),
    })
    return row


def main():
    ap = argparse.ArgumentParser(description="Concrete CMS prospect fingerprinter")
    ap.add_argument("input", help="text file of domains, one per line")
    ap.add_argument("-o", "--output", default="prospects.csv")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--delay", type=float, default=0.3, help="seconds between requests per worker")
    args = ap.parse_args()

    with open(args.input) as f:
        domains = [ln.strip() for ln in f if ln.strip() and not ln.strip().startswith("#")]

    rows, done = [], 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(scan, d, args.delay): d for d in domains}
        for fut in concurrent.futures.as_completed(futures):
            row = fut.result()
            done += 1
            if row:
                rows.append(row)
                with print_lock:
                    print(f"[{done}/{len(domains)}] {row['domain']:<40} {row['priority']}"
                          f"{' ' + row['version'] if row['version'] else ''}", file=sys.stderr)

    rows.sort(key=lambda r: (r.get("_rank", 9), r["domain"]))
    fields = ["domain", "priority", "version", "eol", "signals", "title", "emails",
              "phones", "final_url", "error"]
    with open(args.output, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    hot = sum(1 for r in rows if r["priority"] == "EOL_CONFIRMED")
    warm = sum(1 for r in rows if r["priority"] == "CONCRETE_VERSION_UNKNOWN")
    print(f"\n{len(rows)} scanned → {args.output}", file=sys.stderr)
    print(f"  EOL_CONFIRMED (call these first): {hot}", file=sys.stderr)
    print(f"  Concrete, version unknown:        {warm}", file=sys.stderr)


if __name__ == "__main__":
    main()
