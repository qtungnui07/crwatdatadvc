const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const procedures = path.join(root, 'procedures');
const template = JSON.parse(fs.readFileSync(path.join(root, 'procedure.json'), 'utf8'));
const expectedRootKeys = Object.keys(template).sort();
const report = {
  audited_at: new Date().toISOString(), total: 0, groups: {}, valid_json: 0,
  schema_root_match: 0, official_conversion: 0, raw_identity_match: 0,
  pdf_present: 0, pdf_hash_match: 0, source_page_valid: 0,
  missing_pdf: [], schema_mismatches: [], identity_mismatches: [],
  hash_mismatches: [], source_page_errors: [], mojibake_records: [],
  governance_not_pending: [], citation: { citeable_fields: 0, cited_fields: 0 }
};

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function citedItems(record) {
  return [
    ...(record.steps || []), ...(record.legal_bases || []), ...(record.results || []),
    ...(record.submission_methods || []),
    ...Object.values(record.documents || {}).flatMap(x => Array.isArray(x) ? x : [])
  ];
}
for (const group of fs.readdirSync(procedures)) {
  const groupPath = path.join(procedures, group);
  if (!fs.statSync(groupPath).isDirectory()) continue;
  report.groups[group] = 0;
  for (const code of fs.readdirSync(groupPath)) {
    const folder = path.join(groupPath, code);
    if (!fs.statSync(folder).isDirectory()) continue;
    const rel = path.relative(root, folder).replaceAll('\\', '/');
    report.total++; report.groups[group]++;
    let record, raw;
    try {
      record = JSON.parse(fs.readFileSync(path.join(folder, 'procedure.json'), 'utf8'));
      raw = JSON.parse(fs.readFileSync(path.join(folder, 'raw_procedure.json'), 'utf8'));
      report.valid_json++;
    } catch (error) { report.schema_mismatches.push({ folder: rel, error: error.message }); continue; }
    if (JSON.stringify(Object.keys(record).sort()) === JSON.stringify(expectedRootKeys)) report.schema_root_match++;
    else report.schema_mismatches.push({ folder: rel, keys: Object.keys(record).sort() });
    if (record.source?.extraction_method === 'official_api_plus_pypdf_text_layer') report.official_conversion++;
    const detail = raw.detail || raw;
    if (record.id === (raw.id || detail.id) && record.procedure_code === String(raw.code || detail.code).trim() && record.title === String(raw.name || detail.name).trim()) report.raw_identity_match++;
    else report.identity_mismatches.push(rel);
    // Detect characteristic multi-codepoint UTF-8-as-Latin-1 sequences. Do not
    // flag legitimate Vietnamese uppercase "Ã" (for example, "XÃ HỘI").
    if (/(?:\u00e1\u00bb|\u00e1\u00ba|\u00c4\u2018|\u00c6\u00b0|\u00c2\u00a0|\u00e2\u20ac|\ufffd)/u.test(JSON.stringify(record))) report.mojibake_records.push(rel);
    if (record.governance?.review_status !== 'pending' || record.governance?.reviewed_at !== null || record.governance?.reviewer !== null) report.governance_not_pending.push(rel);
    const pdfs = fs.readdirSync(folder).filter(x => x.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) report.missing_pdf.push(rel);
    else {
      report.pdf_present++;
      const actual = hash(path.join(folder, pdfs[0]));
      if (actual === record.source?.source_sha256) report.pdf_hash_match++;
      else report.hash_mismatches.push(rel);
    }
    let pagesOk = true;
    for (const item of citedItems(record)) {
      report.citation.citeable_fields++;
      if (item.source_page != null) {
        report.citation.cited_fields++;
        if (!Number.isInteger(item.source_page) || item.source_page < 1 || item.source_page > record.source.page_count) pagesOk = false;
      }
    }
    if (pagesOk) report.source_page_valid++; else report.source_page_errors.push(rel);
  }
}
report.citation.rate = report.citation.citeable_fields ? Number((report.citation.cited_fields / report.citation.citeable_fields).toFixed(6)) : 0;
fs.writeFileSync(path.join(root, 'verified-data-audit.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
