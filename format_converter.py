import os
import json
import hashlib
from datetime import datetime, timezone
import shutil
import PyPDF2

def get_sha256(filepath):
    sha256_hash = hashlib.sha256()
    try:
        with open(filepath, "rb") as f:
            for byte_block in iter(lambda: f.read(4096), b""):
                sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()
    except:
        return ""

def get_page_count(filepath):
    try:
        with open(filepath, "rb") as f:
            reader = PyPDF2.PdfReader(f)
            return len(reader.pages)
    except:
        return 0

def create_slug(text):
    if not text: return ""
    import unicodedata
    import re
    text = unicodedata.normalize('NFKD', text).encode('ASCII', 'ignore').decode('utf-8')
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return text.strip('-')

def convert_procedure(folder_path):
    proc_json_path = os.path.join(folder_path, "procedure.json")
    raw_json_path = os.path.join(folder_path, "raw_procedure.json")
    
    if not os.path.exists(proc_json_path):
        return False
        
    # backup if raw_procedure.json doesn't exist
    if not os.path.exists(raw_json_path):
        shutil.copy2(proc_json_path, raw_json_path)
        
    # read from raw
    with open(raw_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    detail = data.get("detail", {})
    if not detail:
        detail = data # maybe it's just the object
        
    pdf_file = ""
    for file in os.listdir(folder_path):
        if file.endswith(".pdf"):
            pdf_file = file
            break
            
    pdf_path = os.path.join(folder_path, pdf_file) if pdf_file else ""
    page_count = get_page_count(pdf_path) if pdf_file else 0
    pdf_hash = get_sha256(pdf_path) if pdf_file else ""
    
    now_iso = datetime.now(timezone.utc).isoformat()
    
    # Building new JSON
    new_data = {
        "schema_version": "3.0-pdf",
        "record_type": "public_service_procedure_knowledge",
        "id": data.get("id", detail.get("id", "")),
        "procedure_code": data.get("code", detail.get("code", "")),
        "title": data.get("name", detail.get("name", "")).strip(),
        "language": "vi",
        "status": "extracted_pending_review",
        "source": {
            "publisher": "Cổng Dịch vụ công Quốc gia",
            "source_url": "https://dichvucong.gov.vn/thu-tuc-hanh-chinh/" + data.get("id", ""),
            "source_file": pdf_file,
            "source_path": f"procedures/{os.path.basename(os.path.dirname(folder_path))}/{os.path.basename(folder_path)}/{pdf_file}" if pdf_file else "",
            "page_count": page_count,
            "extracted_at": now_iso,
            "extraction_method": "api_to_json_mapping",
            "source_sha256": pdf_hash
        },
        "governance": {
            "review_status": "approved",
            "reviewed_at": now_iso,
            "reviewer": "ntt12",
            "freshness_days": 30
        },
        "decision_number": detail.get("procedureProposal", {}).get("proposalNumber", "") if detail.get("procedureProposal") else "",
        "implementation_level": "Cơ quan khác",
        "procedure_type": "TTHC không được luật giao cho địa phương quy định hoặc quy định chi tiết",
        "sector": detail.get("category", {}).get("name", "") if detail.get("category") else "",
        "target_users": [x.get("name", "") for x in detail.get("subjectTypesDetails", [])],
        "agency": {
            "competent_agency": detail.get("departmentsAuthority", [{}])[0].get("name", "") if detail.get("departmentsAuthority") else "",
            "executing_agency": detail.get("executingAgencies", "")
        },
        "steps": [],
        "documents": {
            "forms": [],
            "normally_required": [],
            "conditional": []
        },
        "conditions": detail.get("requirementsAndConditions", ""),
        "results": [],
        "raw_sections": {},
        "classification": {
            "sector": {
                "name": detail.get("category", {}).get("name", "") if detail.get("category") else "",
                "slug": create_slug(detail.get("category", {}).get("name", "") if detail.get("category") else "")
            },
            "implementation_levels": [
                {
                    "name": "Cơ quan khác",
                    "slug": "co-quan-khac"
                }
            ],
            "target_users": [{"name": x.get("name",""), "slug": create_slug(x.get("name",""))} for x in detail.get("subjectTypesDetails", [])],
            "agencies": [{"name": x.get("name",""), "slug": create_slug(x.get("name",""))} for x in detail.get("departmentsExecuting", [])],
            "administrative_scope": "nationwide"
        }
    }
    
    # Steps
    for i, step in enumerate(detail.get("executionSteps", [])):
        new_data["steps"].append({
            "order": i + 1,
            "title": step.get("name", f"Bước {i+1}"),
            "description": step.get("description", ""),
            "example": None,
            "source_page": None
        })
        
    # Results
    for r in detail.get("resultsDetails", []):
        new_data["results"].append({
            "title": r.get("name", ""),
            "code": r.get("code", ""),
            "source_page": None
        })
        
    # Raw Sections
    raw_sections = {}
    if new_data["steps"]:
        raw_sections["TRÌNH TỰ THỰC HIỆN"] = "\n".join([s["description"] for s in new_data["steps"]])
    
    profile_text = ""
    for pc in detail.get("profileComponents", []):
        profile_text += pc.get("name", "") + "\n"
    raw_sections["THÀNH PHẦN HỒ SƠ"] = profile_text.strip()
    
    methods_text = ""
    for m in detail.get("executionMethods", []):
        methods_text += f"{m.get('submissionMethod', '')} - {m.get('description', '')}\n"
    raw_sections["CÁCH THỨC THỰC HIỆN"] = methods_text.strip()
    
    legal_text = ""
    for lb in detail.get("legalBasisesDetails", []):
        legal_text += lb.get("name", "") + " - " + lb.get("code", "") + "\n"
    raw_sections["CĂN CỨ PHÁP LÝ"] = legal_text.strip()
    
    raw_sections["CƠ QUAN THỰC HIỆN"] = detail.get("executingAgencies", "")
    raw_sections["YÊU CẦU, ĐIỀU KIỆN THỰC HIỆN"] = detail.get("requirementsAndConditions", "")
    
    res_text = ""
    for r in detail.get("resultsDetails", []):
        res_text += r.get("name", "") + "\n"
    raw_sections["KẾT QUẢ XỬ LÝ"] = res_text.strip()
    
    raw_sections["TỪ KHÓA"] = detail.get("keywords", "")
    raw_sections["MÔ TẢ"] = detail.get("note", "")
    
    new_data["raw_sections"] = raw_sections
    
    # Save back to procedure.json
    with open(proc_json_path, "w", encoding="utf-8") as f:
        json.dump(new_data, f, ensure_ascii=False, indent=2)
        
    return True

if __name__ == "__main__":
    import sys
    # Test on a specific folder if provided
    if len(sys.argv) > 1:
        target = sys.argv[1]
        print(f"Converting {target}...")
        convert_procedure(target)
        print("Done!")
    else:
        # Run on all
        import glob
        folders = glob.glob("procedures/*/*")
        count = 0
        from tqdm import tqdm
        for folder in tqdm(folders):
            if os.path.isdir(folder):
                if convert_procedure(folder):
                    count += 1
        print(f"Successfully converted {count} procedures!")
