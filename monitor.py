# -*- coding: utf-8 -*-
"""
monitor.py - Theo doi tien do scraper dichvucong.gov.vn
Chay: python monitor.py
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import os
import json
import time
from pathlib import Path
from tqdm import tqdm
from datetime import datetime

BASE_DIR      = Path(__file__).parent / "procedures"
STATE_FILE    = Path(__file__).parent / "scraper-state.json"
ERRORS_FILE   = Path(__file__).parent / "errors.txt"

TOTAL_TARGET  = 5665  # Tong so thu tuc can cao

GROUPS = [
    ("co-con-nho",                  "Co con nho"),
    ("hoc-tap",                     "Hoc tap"),
    ("viec-lam",                    "Viec lam"),
    ("cu-tru-va-giay-to-tuy-than",  "Cu tru & giay to tuy than"),
    ("hon-nhan-va-gia-dinh",        "Hon nhan & gia dinh"),
    ("dien-luc-nha-o-dat-dai",      "Dien luc, nha o, dat dai"),
    ("suc-khoe-va-y-te",            "Suc khoe & y te"),
    ("phuong-tien-va-nguoi-lai",    "Phuong tien & nguoi lai"),
    ("huu-tri",                     "Huu tri"),
    ("nguoi-than-qua-doi",          "Nguoi than qua doi"),
    ("giai-quyet-khieu-kien",       "Giai quyet khieu kien"),
    ("khoi-su-kinh-doanh",          "Khoi su kinh doanh"),
    ("lao-dong-va-bao-hiem-xa-hoi", "Lao dong & BHXH"),
    ("tai-chinh-doanh-nghiep",      "Tai chinh doanh nghiep"),
    ("dien-luc-dat-dai-xay-dung",   "Dien luc, dat dai, XD"),
    ("thuong-mai-quang-cao",        "Thuong mai, quang cao"),
    ("so-huu-tri-tue-dang-ky-tai-san","So huu tri tue"),
    ("thanh-lap-chi-nhanh-van-phong","Thanh lap chi nhanh"),
    ("dau-thau-mua-sam-cong",       "Dau thau, mua sam cong"),
    ("tai-co-cau-doanh-nghiep",     "Tai co cau doanh nghiep"),
    ("giai-quyet-tranh-chap-hop-dong","Giai quyet tranh chap"),
    ("tam-dung-cham-dut-hoat-dong", "Tam dung/Cham dut HD"),
]


def scan_dir():
    """Quet thu muc procedures, tra ve thong ke chi tiet."""
    stats = {
        "total_procedures": 0,
        "total_pdf":        0,
        "total_no_pdf":     0,
        "total_error":      0,
        "total_size_bytes": 0,
        "groups":           {},
    }

    if not BASE_DIR.exists():
        return stats

    for slug, label in GROUPS:
        group_dir = BASE_DIR / slug
        g = {"label": label, "procedures": 0, "pdf": 0, "no_pdf": 0, "error": 0, "size_bytes": 0}

        if group_dir.exists():
            for code_dir in group_dir.iterdir():
                if not code_dir.is_dir():
                    continue
                files = list(code_dir.iterdir())
                file_names = {f.name for f in files}

                if "procedure.json" in file_names:
                    g["procedures"] += 1

                    # Kiem tra PDF
                    pdfs = [f for f in files if f.suffix.lower() == ".pdf"]
                    if pdfs:
                        g["pdf"] += 1
                        g["size_bytes"] += sum(f.stat().st_size for f in pdfs)
                    else:
                        g["no_pdf"] += 1

                    # Kiem tra loi
                    if "khong-vao-duoc.txt" in file_names:
                        g["error"] += 1

        stats["groups"][slug] = g
        stats["total_procedures"] += g["procedures"]
        stats["total_pdf"]        += g["pdf"]
        stats["total_no_pdf"]     += g["no_pdf"]
        stats["total_error"]      += g["error"]
        stats["total_size_bytes"] += g["size_bytes"]

    return stats


def load_state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def count_errors():
    if ERRORS_FILE.exists():
        try:
            return sum(1 for _ in ERRORS_FILE.open(encoding="utf-8", errors="ignore"))
        except Exception:
            pass
    return 0


def fmt_size(b):
    if b < 1024:
        return f"{b} B"
    elif b < 1024 ** 2:
        return f"{b/1024:.1f} KB"
    elif b < 1024 ** 3:
        return f"{b/1024**2:.1f} MB"
    return f"{b/1024**3:.2f} GB"


def render(stats, state, error_lines, elapsed_sec, prev_total):
    os.system("cls" if os.name == "nt" else "clear")

    now      = datetime.now().strftime("%H:%M:%S")
    total    = stats["total_procedures"]
    pct      = total / TOTAL_TARGET * 100
    speed    = (total - prev_total) / max(elapsed_sec, 1) * 60  # items/min

    # ETA
    remaining = TOTAL_TARGET - total
    eta_min   = remaining / speed if speed > 0 else float("inf")
    eta_str   = f"{eta_min:.0f} phut" if eta_min < 9999 else "..."

    print("=" * 62)
    print(f"  DVC Scraper Monitor  |  {now}")
    print("=" * 62)

    # Thanh tien do tong
    bar_len  = 50
    filled   = int(bar_len * total / TOTAL_TARGET)
    bar      = "#" * filled + "-" * (bar_len - filled)
    print(f"\n  TONG TIEN DO: [{bar}] {pct:.1f}%")
    print(f"  {total:,} / {TOTAL_TARGET:,} thu tuc  |  "
          f"PDF: {stats['total_pdf']:,}  |  "
          f"Loi: {stats['total_error']:,}  |  "
          f"Dung luong: {fmt_size(stats['total_size_bytes'])}")
    print(f"  Toc do: ~{speed:.1f} thu tuc/phut  |  ETA: {eta_str}  |  Log loi: {error_lines} dong\n")

    # Tung group
    print(f"  {'NHOM':<35} {'THU TUC':>8} {'PDF':>6} {'LOI':>5} {'TRANG THAI'}")
    print("  " + "-" * 60)

    state_progress = state.get("groupProgress", {})
    GROUP_IDS = {
        "co-con-nho":                  "019b694a-3c88-759a-8c84-1e02eb92a91b",
        "hoc-tap":                     "019b6e01-a0e9-75f9-b0a5-edac82b03d78",
        "viec-lam":                    "019b6e11-d140-759c-a0b9-0bb7efd3fc4a",
        "cu-tru-va-giay-to-tuy-than":  "019b6e13-0cf4-70b7-b443-45281c901b6e",
        "hon-nhan-va-gia-dinh":        "019b6e14-5b92-776a-ab2b-af9f0c261d97",
        "dien-luc-nha-o-dat-dai":      "019b6e1a-3e04-7798-b659-49a14d3d2e58",
        "suc-khoe-va-y-te":            "019b6e22-16dd-70db-ac65-d3fe6b69906c",
        "phuong-tien-va-nguoi-lai":    "019b6e26-4c8c-74a8-8467-9edb2713d23e",
        "huu-tri":                     "019b6e27-7642-76e5-8f29-649db67dd5e4",
        "nguoi-than-qua-doi":          "019b6e29-6dd5-7456-8d3e-a91feaae9f04",
        "giai-quyet-khieu-kien":       "019b6e31-866e-71ce-959b-af9f0836a7a2",
        "khoi-su-kinh-doanh":          "019b6e0e-a904-742a-8407-d48b3d8c4730",
        "lao-dong-va-bao-hiem-xa-hoi": "019b6e0f-ad98-712e-96e6-5eea147fa53e",
        "tai-chinh-doanh-nghiep":      "019b6e12-4c57-72fa-86a4-d3e76970213e",
        "dien-luc-dat-dai-xay-dung":   "019b6e13-ad15-70ba-9889-126bb7521276",
        "thuong-mai-quang-cao":        "019b6e15-e590-71ed-9d9f-ce979fcdd9b2",
        "so-huu-tri-tue-dang-ky-tai-san":"019b6e21-735f-75c6-82d2-cfc723b40a47",
        "thanh-lap-chi-nhanh-van-phong":"019b6e25-92b4-72d4-aae2-bae2eecf448b",
        "dau-thau-mua-sam-cong":       "019b6e26-f7a1-702f-9ace-47f15cca232b",
        "tai-co-cau-doanh-nghiep":     "019b6e27-e274-7534-afba-98c2f732d180",
        "giai-quyet-tranh-chap-hop-dong":"019b6e30-48a2-732a-8f83-b24540fddb77",
        "tam-dung-cham-dut-hoat-dong": "019b6e32-be21-756c-a306-06cf253a0b6f",
    }

    for slug, label in GROUPS:
        g      = stats["groups"].get(slug, {})
        cnt    = g.get("procedures", 0)
        pdf    = g.get("pdf", 0)
        err    = g.get("error", 0)
        gid    = GROUP_IDS.get(slug, "")
        prog   = state_progress.get(gid, "")

        if prog == "DONE":
            status = "[DONE]"
        elif cnt > 0:
            status = "[...] "
        else:
            status = "[ -- ]"

        print(f"  {label:<35} {cnt:>8,} {pdf:>6,} {err:>5}  {status}")

    print("\n  [Ctrl+C de thoat]  Cap nhat moi 5 giay...")
    print("=" * 62)
    sys.stdout.flush()


def main():
    print("Dang quet... vui long cho.")
    prev_total    = 0
    start_time    = time.time()
    interval      = 5  # giay

    try:
        while True:
            stats       = scan_dir()
            state       = load_state()
            error_lines = count_errors()
            elapsed     = time.time() - start_time

            render(stats, state, error_lines, elapsed, prev_total)

            prev_total = stats["total_procedures"]
            time.sleep(interval)

    except KeyboardInterrupt:
        print("\n\nDa thoat monitor.")


if __name__ == "__main__":
    main()
