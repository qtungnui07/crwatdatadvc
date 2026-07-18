"""Convert official DVC API snapshots to the training schema and verify against PDFs.

No generative model is used. Structured values come only from raw_procedure.json;
PDF text is used to locate source pages and to produce verification metrics.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / ".deps"))
from pypdf import PdfReader  # type: ignore

ROOT = Path(__file__).parent / "procedures"
METHOD_LABELS = {"ONLINE": "Trực tuyến", "DIRECT": "Trực tiếp", "POSTAL": "Qua dịch vụ bưu chính"}
TIME_UNITS = {"WORKING_DAY": "ngày làm việc", "DAY": "ngày", "HOUR": "giờ", "MONTH": "tháng", "YEAR": "năm", "OTHER": ""}


def arr(value):
    # The upstream API occasionally emits null elements inside object arrays.
    return [item for item in value if item is not None] if isinstance(value, list) else []


def text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def first(*values):
    for value in values:
        if value is not None and value != "":
            return value
    return ""


def slug(value: str) -> str:
    value = unicodedata.normalize("NFKD", text(value)).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", value))


def norm(value: str) -> str:
    value = unicodedata.normalize("NFKC", text(value)).lower()
    value = re.sub(r"[^\w]+", " ", value, flags=re.UNICODE)
    return re.sub(r"\s+", " ", value).strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def pdf_pages(path: Path) -> list[str]:
    reader = PdfReader(str(path), strict=False)
    return [(page.extract_text() or "") for page in reader.pages]


def page_for(value: str, pages_normalized: list[str]) -> int | None:
    """Locate API text in PDF pages without inventing a citation."""
    target = norm(value)
    if len(target) < 8:
        return None
    # Exact normalized match first. For long fields, stable 12-word windows cope
    # with PDF table layout and line wrapping.
    for index, page in enumerate(pages_normalized):
        if target in page:
            return index + 1
    words = target.split()
    windows = []
    width = min(12, len(words))
    if width >= 4:
        starts = {0, max(0, (len(words) - width) // 2), max(0, len(words) - width)}
        windows = [" ".join(words[start:start + width]) for start in starts]
    best_page, best_hits = None, 0
    for index, page in enumerate(pages_normalized):
        hits = sum(1 for window in windows if window and window in page)
        if hits > best_hits:
            best_page, best_hits = index + 1, hits
    return best_page if best_hits else None


STEP_MARKER = re.compile(
    r"(?im)(?=^[ \t]*(?:[-+*][ \t]*)?b(?:ư|u)ớc[ \t]+(?:\d+|[ivxlcdm]+)\b)"
)
STEP_TITLE = re.compile(
    r"(?i)^[ \t]*(?:[-+*][ \t]*)?(b(?:ư|u)ớc[ \t]+(?:\d+|[ivxlcdm]+))\b"
)


def split_execution_step(item: dict) -> list[tuple[str, str]]:
    """Split an upstream executionSteps item containing multiple numbered steps.

    DVC frequently stores "Bước 1 ...\nBước 2 ..." in one API object. Splitting
    is deterministic and only occurs when at least two line-leading markers exist.
    """
    description = text(item.get("description"))
    starts = [match.start() for match in STEP_MARKER.finditer(description)]
    if len(starts) < 2:
        return [(text(item.get("name")), description)]
    prefix = description[:starts[0]].strip()
    chunks = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(description)
        chunk = description[start:end].strip()
        if index == 0 and prefix:
            chunk = f"{prefix}\n{chunk}"
        marker = STEP_TITLE.search(chunk)
        chunks.append((marker.group(1).strip().capitalize() if marker else "", chunk))
    return chunks


def implementation(detail: dict) -> list[str]:
    levels = []
    for key, label in (
        ("isMinistry", "Cấp bộ"), ("isProvince", "Cấp tỉnh"),
        ("isWard", "Cấp xã"), ("isOtherAgency", "Cơ quan khác"),
        ("isVertical", "Cơ quan ngành dọc"), ("isUndetermined", "Chưa xác định"),
    ):
        if detail.get(key) is True:
            levels.append(label)
    return levels


def quantity(component: dict) -> str | None:
    values = []
    if component.get("originalQty") not in (None, 0, "0", ""):
        values.append(f"{component['originalQty']} bản chính")
    if component.get("copyQty") not in (None, 0, "0", ""):
        values.append(f"{component['copyQty']} bản sao")
    return ", ".join(values) or None


def attachment_value(component: dict):
    attachments = arr(component.get("attachments"))
    if not attachments:
        return None
    # The target schema defines attachment as string|null. Use only official
    # names/URLs and never synthesize a filename.
    values = [text(first(item.get("name"), item.get("fileName"), item.get("url"), item.get("fileUrl")))
              for item in attachments]
    return "; ".join(value for value in values if value) or None


def document_item(component: dict, pages: list[str]) -> dict:
    name = text(component.get("name"))
    return {"name": name, "quantity": quantity(component), "attachment": attachment_value(component), "source_page": page_for(name, pages)}


def build_documents(detail: dict, pages: list[str]) -> dict:
    result = {"forms": [], "normally_required": [], "conditional": []}
    cases = arr(detail.get("executionCases"))
    sources = cases or [{"name": "", "profileComponents": arr(detail.get("profileComponents"))}]
    for case in sources:
        case_name = text(case.get("name"))
        for component in arr(case.get("profileComponents")):
            item = document_item(component, pages)
            # Preserve the official case in the name when the API marks a condition.
            if case_name and not component.get("required"):
                item["name"] = f"{case_name}: {item['name']}" if item["name"] else case_name
            if component.get("hasElectronicForm") or arr(component.get("attachments")):
                bucket = "forms"
            elif component.get("required") is True:
                bucket = "normally_required"
            else:
                bucket = "conditional"
            result[bucket].append(item)
    return result


def methods_and_fees(detail: dict, pages: list[str]):
    methods, fee_items = [], []
    for method in arr(detail.get("executionMethods")):
        code = text(method.get("submissionMethod"))
        label = METHOD_LABELS.get(code, code)
        value, unit = method.get("processingTime"), text(method.get("processingTimeUnit"))
        processing = "" if value is None else f"{value} {TIME_UNITS.get(unit, unit)}".strip()
        description = text(method.get("description"))
        method_fee_texts = []
        for fee in arr(method.get("fees")):
            amount = fee.get("value")
            description_fee = text(fee.get("description"))
            amount_text = description_fee or (str(amount) if amount is not None else "")
            fee_items.append({"submission_method_code": code, "submission_method": label,
                              "amount_text": amount_text, "is_free": amount == 0 and not description_fee,
                              "source_page": page_for(first(description_fee, label), pages)})
            method_fee_texts.append(amount_text)
        methods.append({"code": code, "label": label, "processing_time": processing,
                        "fee": "; ".join(dict.fromkeys(x for x in method_fee_texts if x)) or None,
                        "description": description, "source_page": page_for(first(description, label), pages)})
    for fee in arr(detail.get("fees")):
        amount = fee.get("value")
        description_fee = text(fee.get("description"))
        fee_items.append({"submission_method_code": None, "submission_method": None,
                          "amount_text": description_fee or (str(amount) if amount is not None else ""),
                          "is_free": amount == 0 and not description_fee,
                          "source_page": page_for(description_fee, pages)})
    if not fee_items:
        status = "not_specified"
    elif all(item["is_free"] for item in fee_items):
        status = "free"
    else:
        status = "varies_by_submission_method"
    summary = "; ".join(dict.fromkeys(item["amount_text"] for item in fee_items if item["amount_text"]))
    return methods, {"summary": summary, "status": status, "currency": "VND", "items": fee_items}


def convert(folder: Path) -> dict:
    raw_path = folder / "raw_procedure.json"
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    detail = raw.get("detail") or raw
    pdfs = sorted(folder.glob("*.pdf"))
    pdf = pdfs[0] if pdfs else None
    extracted_pages, pdf_error = [], None
    if pdf:
        try:
            extracted_pages = pdf_pages(pdf)
        except Exception as exc:  # retain API truth and report unreadable source
            pdf_error = f"{type(exc).__name__}: {exc}"
    pages = [norm(page) for page in extracted_pages]
    levels = implementation(detail)
    sector = text(first((detail.get("category") or {}).get("name"),
                        (arr(detail.get("categoriesDetails")) or [{}])[0].get("name")))
    targets = [text(item.get("name")) for item in arr(detail.get("subjectTypesDetails")) if text(item.get("name"))]
    executing = arr(detail.get("departmentsExecuting")) + arr(detail.get("unitGroupsExecuting"))
    authority = arr(detail.get("departmentsAuthority")) + arr(detail.get("unitGroupsAuthority"))
    steps = []
    for item in arr(detail.get("executionSteps")):
        for upstream_title, description in split_execution_step(item):
            index = len(steps) + 1
            steps.append({"order": index, "title": upstream_title or f"Bước {index}",
                          "description": description, "example": None, "source_page": page_for(description, pages)})
    documents = build_documents(detail, pages)
    methods, fees = methods_and_fees(detail, pages)
    legal = [{"title": text(item.get("name")), "document_number": text(item.get("code")),
              "source_page": page_for(first(item.get("name"), item.get("code")), pages)}
             for item in arr(detail.get("legalBasisesDetails"))]
    results = [{"title": text(item.get("name")), "code": text(item.get("code")),
                "source_page": page_for(first(item.get("name"), item.get("code")), pages)}
               for item in arr(detail.get("resultsDetails"))]
    now = datetime.now(timezone.utc).isoformat()
    relative_pdf = pdf.resolve().relative_to(Path(__file__).parent.resolve()).as_posix() if pdf else ""
    record = {
        "schema_version": "3.0-pdf", "record_type": "public_service_procedure_knowledge",
        "id": first(raw.get("id"), detail.get("id")),
        "procedure_code": text(first(raw.get("code"), detail.get("code"))),
        "title": text(first(raw.get("name"), detail.get("name"))), "language": "vi",
        "status": "extracted_pending_review",
        "source": {"publisher": "Cổng Dịch vụ công Quốc gia",
                   "source_url": f"https://dichvucong.gov.vn/thu-tuc-hanh-chinh/{first(raw.get('id'), detail.get('id'))}",
                   "source_file": pdf.name if pdf else "", "source_path": relative_pdf,
                   "page_count": len(extracted_pages) if pdf and not pdf_error else None,
                   "extracted_at": now, "extraction_method": "official_api_plus_pypdf_text_layer",
                   "source_sha256": sha256(pdf) if pdf else ""},
        "governance": {"review_status": "pending", "reviewed_at": None, "reviewer": None, "freshness_days": 30},
        "decision_number": text(first(detail.get("decisionNo"), (detail.get("procedureProposal") or {}).get("proposalNumber"),
                                      (detail.get("procedureProposal") or {}).get("decisionNumber"))),
        "implementation_level": ", ".join(levels),
        "procedure_type": text(first(detail.get("formalityType"), detail.get("type"))),
        "sector": sector, "target_users": targets,
        "agency": {"competent_agency": "; ".join(text(item.get("name")) for item in authority if text(item.get("name"))),
                   "executing_agency": text(first(detail.get("executingAgencies"), "; ".join(text(item.get("name")) for item in executing if text(item.get("name")))))},
        "steps": steps, "documents": documents, "submission_methods": methods, "fees": fees,
        "legal_bases": legal, "conditions": text(detail.get("requirementsAndConditions")), "results": results,
        "raw_sections": {
            "TRÌNH TỰ THỰC HIỆN": "\n".join(item["description"] for item in steps),
            "THÀNH PHẦN HỒ SƠ": "\n".join(item["name"] for bucket in documents.values() for item in bucket),
            "CÁCH THỨC THỰC HIỆN": "\n".join(f"{item['label']}: {item['processing_time']}" for item in methods),
            "CĂN CỨ PHÁP LÝ": "\n".join(f"{item['title']} - {item['document_number']}" for item in legal),
            "CƠ QUAN THỰC HIỆN": text(first(detail.get("executingAgencies"), "; ".join(text(item.get("name")) for item in executing))),
            "YÊU CẦU, ĐIỀU KIỆN THỰC HIỆN": text(detail.get("requirementsAndConditions")),
            "KẾT QUẢ XỬ LÝ": "\n".join(f"{item['title']} - {item['code']}" for item in results),
            "TỪ KHÓA": text(detail.get("keywords")), "MÔ TẢ": text(first(detail.get("description"), detail.get("note"))),
        },
        "classification": {
            "sector": {"name": sector, "slug": slug(sector)},
            "implementation_levels": [{"name": name, "slug": slug(name)} for name in levels],
            "target_users": [{"name": name, "slug": slug(name)} for name in targets],
            "agencies": [{"name": text(item.get("name")), "slug": slug(text(item.get("name")))} for item in executing if text(item.get("name"))],
            "administrative_scope": "non_territorial" if detail.get("isNonTerritorial") is True else "not_specified",
        },
    }
    cited = sum(item.get("source_page") is not None for item in steps + legal + results + [x for v in documents.values() for x in v] + methods)
    citeable = len(steps) + len(legal) + len(results) + sum(len(v) for v in documents.values()) + len(methods)
    return {"record": record, "pdf_error": pdf_error, "has_pdf": bool(pdf), "pages": len(extracted_pages),
            "cited": cited, "citeable": citeable, "text_chars": sum(len(page) for page in extracted_pages)}


def main():
    folders = sorted(path.parent for path in ROOT.glob("*/*/raw_procedure.json"))
    report = {"generated_at": datetime.now(timezone.utc).isoformat(), "total": len(folders), "converted": 0,
              "with_pdf": 0, "pdf_read_ok": 0, "pdf_errors": [], "missing_pdf": [],
              "pdf_pages": 0, "pdf_text_chars": 0, "citeable_fields": 0, "cited_fields": 0}
    def run_one(folder):
        try:
            result = convert(folder)
            (folder / "procedure.json").write_text(json.dumps(result["record"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            return folder, result, None
        except Exception as exc:
            return folder, None, f"CONVERT: {type(exc).__name__}: {exc}"

    workers = max(1, int(os.environ.get("PDF_WORKERS", "4")))
    with ThreadPoolExecutor(max_workers=workers) as pool:
      for index, (folder, result, error) in enumerate(pool.map(run_one, folders), 1):
        if result is not None:
            report["converted"] += 1
            report["with_pdf"] += int(result["has_pdf"])
            report["pdf_read_ok"] += int(result["has_pdf"] and not result["pdf_error"])
            report["pdf_pages"] += result["pages"]
            report["pdf_text_chars"] += result["text_chars"]
            report["citeable_fields"] += result["citeable"]
            report["cited_fields"] += result["cited"]
            if not result["has_pdf"]:
                report["missing_pdf"].append(folder.relative_to(Path(__file__).parent).as_posix())
            if result["pdf_error"]:
                report["pdf_errors"].append({"folder": folder.relative_to(Path(__file__).parent).as_posix(), "error": result["pdf_error"]})
        else:
            report["pdf_errors"].append({"folder": folder.relative_to(Path(__file__).parent).as_posix(), "error": error})
        if index % 100 == 0 or index == len(folders):
            print(f"{index}/{len(folders)}", flush=True)
    report["citation_rate"] = round(report["cited_fields"] / report["citeable_fields"], 6) if report["citeable_fields"] else 0
    (Path(__file__).parent / "verified-conversion-audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
