const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'procedures');
const GROUPS = {
  'co-con-nho': 'Có con nhỏ',
  'hoc-tap': 'Học tập',
  'viec-lam': 'Việc làm',
  'cu-tru-va-giay-to-tuy-than': 'Cư trú và giấy tờ tùy thân',
  'hon-nhan-va-gia-dinh': 'Hôn nhân và gia đình',
  'dien-luc-nha-o-dat-dai': 'Điện lực, nhà ở, đất đai',
  'suc-khoe-va-y-te': 'Sức khỏe và y tế',
  'phuong-tien-va-nguoi-lai': 'Phương tiện và người lái',
  'huu-tri': 'Hưu trí',
  'nguoi-than-qua-doi': 'Người thân qua đời',
  'giai-quyet-khieu-kien': 'Giải quyết khiếu kiện',
};

const directGroup = new Map([
  ['Khai sinh', 'co-con-nho'], ['Nhận con nuôi', 'co-con-nho'],
  ['Liên thông khai sinh, bảo hiểm, cư trú', 'co-con-nho'],
  ['Tuyển sinh', 'hoc-tap'], ['Học bổng và chính sách hỗ trợ', 'hoc-tap'],
  ['Học tập ở nước ngoài bằng ngân sách nhà nước', 'hoc-tap'],
  ['Cấp văn bằng, chứng chỉ; công nhận văn bằng, chứng chỉ do cơ sở nước ngoài cấp', 'hoc-tap'],
  ['Quản lý lao động', 'viec-lam'], ['Cấp phép lao động cho người nước ngoài', 'viec-lam'],
  ['Bảo hiểm xã hội, thất nghiệp, trợ cấp', 'viec-lam'],
  ['Hộ chiếu', 'cu-tru-va-giay-to-tuy-than'], ['Tạm trú', 'cu-tru-va-giay-to-tuy-than'],
  ['Tạm vắng', 'cu-tru-va-giay-to-tuy-than'], ['Cư trú', 'cu-tru-va-giay-to-tuy-than'],
  ['Hộ khẩu', 'cu-tru-va-giay-to-tuy-than'], ['Lưu trú', 'cu-tru-va-giay-to-tuy-than'],
  ['Căn cước công dân/ Chứng minh nhân dân', 'cu-tru-va-giay-to-tuy-than'],
  ['Kết hôn', 'hon-nhan-va-gia-dinh'], ['Nhận cha, mẹ con', 'hon-nhan-va-gia-dinh'],
  ['Giám hộ', 'hon-nhan-va-gia-dinh'], ['Cải chính, trích lục hộ tịch', 'hon-nhan-va-gia-dinh'],
  ['Tiếp cận đất đai', 'dien-luc-nha-o-dat-dai'], ['Cung cấp điện năng', 'dien-luc-nha-o-dat-dai'],
  ['Tiếp cận điện năng', 'dien-luc-nha-o-dat-dai'], ['Đăng ký tài sản', 'dien-luc-nha-o-dat-dai'],
  ['Chính sách Y tế', 'suc-khoe-va-y-te'], ['Chứng chỉ hành nghề', 'suc-khoe-va-y-te'],
  ['Đăng ký phương tiện', 'phuong-tien-va-nguoi-lai'],
  ['Chế độ hưu trí', 'huu-tri'], ['Chuẩn bị nghỉ hưu', 'huu-tri'],
  ['Khai tử', 'nguoi-than-qua-doi'], ['Chế độ tử tuất, mai táng phí', 'nguoi-than-qua-doi'],
]);

const rules = [
  ['nguoi-than-qua-doi', /khai tử|tử tuất|mai táng|người chết|qua đời|thừa kế/i],
  ['huu-tri', /hưu trí|nghỉ hưu|lương hưu/i],
  ['co-con-nho', /khai sinh|trẻ em|con nuôi|nhận con nuôi|thai sản|sơ sinh/i],
  ['hon-nhan-va-gia-dinh', /kết hôn|ly hôn|hôn nhân|gia đình|giám hộ|cha,? mẹ,? con|hộ tịch/i],
  ['cu-tru-va-giay-to-tuy-than', /căn cước|hộ chiếu|xuất nhập cảnh|quốc tịch|cư trú|tạm trú|thường trú|lưu trú|định danh|hộ khẩu|thị thực|visa/i],
  ['phuong-tien-va-nguoi-lai', /phương tiện|đăng kiểm|đường bộ|đường sắt|hàng không|hàng hải|đường thủy|giấy phép lái|người lái|tàu bay|tàu biển|ô tô|xe máy/i],
  ['viec-lam', /vật liệu nổ|tiền chất thuốc nổ|thuốc nổ|thuốc pháo|pháo hoa|dịch vụ nổ mìn/i],
  ['suc-khoe-va-y-te', /y tế|y dược|khám bệnh|chữa bệnh|phòng bệnh|dược|thuốc|vắc xin|vaccine|an toàn thực phẩm|bảo hiểm y tế|sức khỏe|thiết bị y tế/i],
  ['hoc-tap', /giáo dục|đào tạo|tuyển sinh|học tập|học sinh|sinh viên|văn bằng|chứng chỉ|học bổng|nhà giáo/i],
  ['dien-luc-nha-o-dat-dai', /đất đai|nhà ở|xây dựng|điện lực|điện năng|bất động sản|địa chất|khoáng sản|tài nguyên|môi trường|khí tượng|thủy văn|biển và hải đảo|đê điều/i],
  ['giai-quyet-khieu-kien', /khiếu nại|tố cáo|khiếu kiện|tranh chấp|hòa giải|trợ giúp pháp lý|thi hành án|bồi thường|tòa án|trọng tài|công chứng|chứng thực|luật sư/i],
  ['viec-lam', /việc làm|lao động|bảo hiểm xã hội|thất nghiệp|người có công|tiền lương|doanh nghiệp|kinh doanh|đầu tư|thuế|hải quan|thương mại|ngân hàng|tài chính|chứng khoán|sở hữu trí tuệ/i],
];

// Strong sector-level signals take precedence over incidental words in titles.
// Hộ tịch, BHXH and general policy sectors are intentionally omitted because
// their correct life event depends on the specific procedure title.
const sectorRules = [
  ['dien-luc-nha-o-dat-dai', /đất đai|tài chính đất đai|nhà ở và công sở|hoạt động xây dựng|kinh doanh bất động sản|điện lực|^điện$|địa chất và khoáng sản|tài nguyên nước|biển và hải đảo|khí tượng, thủy văn|đo đạc, bản đồ|đê điều|biến đổi khí hậu|môi trường/i],
  ['phuong-tien-va-nguoi-lai', /đường bộ|đường sắt|hàng không|hàng hải|đường thủy|đăng kiểm|giấy phép lái xe|đăng ký, quản lý phương tiện|an ninh hàng không|quản lý vùng trời|vận chuyển hàng hóa nguy hiểm/i],
  ['suc-khoe-va-y-te', /dược phẩm|y dược|khám bệnh|chữa bệnh|phòng bệnh|an toàn thực phẩm|thiết bị y tế|bảo hiểm y tế|dân số, bà mẹ|an toàn bức xạ|thú y/i],
  ['hoc-tap', /giáo dục|đào tạo|tuyển sinh|kiểm định chất lượng giáo dục/i],
  ['cu-tru-va-giay-to-tuy-than', /quản lý xuất nhập cảnh|căn cước|định danh và xác thực|quốc tịch|đăng ký, quản lý cư trú|công tác lãnh sự|lý lịch tư pháp/i],
  ['giai-quyet-khieu-kien', /khiếu nại|tố cáo|bồi thường nhà nước|trợ giúp pháp lý|hòa giải|thi hành án|công chứng|chứng thực|luật sư|trọng tài thương mại/i],
  ['viec-lam', /thuế|hải quan|chứng khoán|sở hữu trí tuệ|ngân hàng|ngoại hối|tiền tệ|xuất nhập khẩu|thương mại|doanh nghiệp|kinh doanh|đầu tư|việc làm|quản lý lao động|báo chí|phát thanh|viễn thông|tần số vô tuyến|tiêu chuẩn đo lường|vật liệu nổ|vũ khí|công nghệ|bảo hiểm$/i],
];

const slug = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const arr = v => Array.isArray(v) ? v : [];
const nonempty = (...values) => values.find(v => v !== undefined && v !== null && v !== '') ?? '';
const methodLabels = { ONLINE: 'Trực tuyến', DIRECT: 'Trực tiếp', POSTAL: 'Qua dịch vụ bưu chính' };
const timeUnits = { WORKING_DAY: 'ngày làm việc', DAY: 'ngày', HOUR: 'giờ', MONTH: 'tháng', YEAR: 'năm', OTHER: '' };

function classify(detail) {
  for (const sg of arr(detail.serviceGroupsDetails)) if (directGroup.has(sg.name)) return [directGroup.get(sg.name), 'service_group'];
  const sector = detail.category?.name || arr(detail.categoriesDetails)[0]?.name || '';
  for (const [group, regex] of sectorRules) if (regex.test(sector)) return [group, 'sector_rule'];
  // Use only identifying metadata. Long descriptions often mention incidental
  // concepts (for example, "tranh chấp") that do not define the procedure's group.
  const text = [detail.name, detail.category?.name, ...arr(detail.categoriesDetails).map(x => x.name), detail.keywords].filter(Boolean).join(' | ');
  for (const [group, regex] of rules) if (regex.test(text)) return [group, 'keyword_rule'];
  return ['viec-lam', 'fallback'];
}

function implementation(detail) {
  const levels = [];
  if (detail.isMinistry) levels.push('Cấp bộ');
  if (detail.isProvince) levels.push('Cấp tỉnh');
  if (detail.isWard) levels.push('Cấp xã');
  if (detail.isOtherAgency) levels.push('Cơ quan khác');
  if (detail.isVertical) levels.push('Cơ quan ngành dọc');
  if (detail.isUndetermined) levels.push('Chưa xác định');
  return levels.length ? levels : ['Chưa xác định'];
}

function quantity(c) {
  const q = [];
  if (Number(c.originalQty)) q.push(`${c.originalQty} bản chính`);
  if (Number(c.copyQty)) q.push(`${c.copyQty} bản sao`);
  return q.join(', ') || null;
}

function documentItem(c, caseName) {
  const attachments = arr(c.attachments).map(a => ({
    id: nonempty(a.id, a.fileId), name: nonempty(a.name, a.fileName), url: nonempty(a.url, a.fileUrl),
  }));
  return { name: c.name || '', code: c.code || '', quantity: quantity(c), required: Boolean(c.required), case: caseName || null, attachments, source_page: null };
}

function buildDocuments(detail) {
  const forms = [], normally_required = [], conditional = [];
  const cases = arr(detail.executionCases);
  const sources = cases.length ? cases : [{ name: null, profileComponents: arr(detail.profileComponents) }];
  for (const ec of sources) for (const c of arr(ec.profileComponents)) {
    const item = documentItem(c, ec.name);
    if (c.hasElectronicForm || item.attachments.length) forms.push(item);
    else if (c.required) normally_required.push(item);
    else conditional.push(item);
  }
  return { forms, normally_required, conditional };
}

function buildMethods(detail) {
  return arr(detail.executionMethods).map(m => {
    const fees = arr(m.fees).map(f => ({ type: f.type || '', amount: f.value ?? null, currency: f.currencyId || 'VND', description: f.description || '', attachment: f.attachment || null }));
    const processing_time = m.processingTime == null ? '' : `${m.processingTime} ${timeUnits[m.processingTimeUnit] ?? m.processingTimeUnit ?? ''}`.trim();
    return { code: m.submissionMethod || '', label: methodLabels[m.submissionMethod] || m.submissionMethod || '', processing_time, processing_time_value: m.processingTime ?? null, processing_time_unit: m.processingTimeUnit || '', fees, description: m.description || '', source_page: null };
  });
}

function buildFees(methods, detail) {
  const items = [];
  for (const m of methods) for (const f of m.fees) items.push({ submission_method_code: m.code, submission_method: m.label, ...f });
  for (const f of arr(detail.fees)) items.push({ submission_method_code: null, submission_method: null, type: f.type || '', amount: f.value ?? null, currency: f.currencyId || 'VND', description: f.description || '', attachment: f.attachment || null });
  const isFree = items.length > 0 && items.every(x => Number(x.amount) === 0 && !/theo|quy định|cụ thể/i.test(x.description));
  return { status: items.length ? (isFree ? 'free' : 'varies') : 'not_specified', currency: 'VND', items };
}

function build(folder, raw, old, group, method) {
  const d = raw.detail || raw;
  const pdf = fs.readdirSync(folder).find(x => x.toLowerCase().endsWith('.pdf')) || '';
  const pdfPath = pdf ? path.join(folder, pdf) : '';
  const source = old.source || {};
  const methods = buildMethods(d);
  const levels = implementation(d);
  const executing = [...arr(d.departmentsExecuting), ...arr(d.unitGroupsExecuting)].filter(Boolean);
  const authority = [...arr(d.departmentsAuthority), ...arr(d.unitGroupsAuthority)].filter(Boolean);
  const legal = arr(d.legalBasisesDetails).map(x => ({ title: x.name || '', document_number: x.code || '', id: x.id || '', source_page: null }));
  const results = arr(d.resultsDetails).map(x => ({ title: x.name || '', code: x.code || '', id: x.id || '', source_page: null }));
  const steps = arr(d.executionSteps).map((x, i) => ({ order: i + 1, title: x.name || `Bước ${i + 1}`, description: x.description || '', example: null, source_page: null }));
  const sector = d.category?.name || arr(d.categoriesDetails)[0]?.name || '';
  const targetUsers = arr(d.subjectTypesDetails).map(x => x.name).filter(Boolean);
  const updated = d.updatedAt ? new Date(d.updatedAt).toISOString() : source.extracted_at;
  return {
    schema_version: '3.1-api', record_type: 'public_service_procedure_knowledge',
    id: nonempty(raw.id, d.id), procedure_code: String(nonempty(raw.code, d.code)).trim(), title: nonempty(raw.name, d.name).trim(),
    language: 'vi', status: d.state || old.status || 'extracted_pending_review',
    source: { publisher: 'Cổng Dịch vụ công Quốc gia', source_url: `https://dichvucong.gov.vn/thu-tuc-hanh-chinh/${nonempty(raw.id, d.id)}`, source_file: pdf, source_path: pdf ? `procedures/${group}/${path.basename(folder).trim()}/${pdf}` : '', page_count: source.page_count || null, extracted_at: source.extracted_at || null, source_updated_at: updated || null, extraction_method: 'api_to_json_mapping', source_sha256: pdfPath ? crypto.createHash('sha256').update(fs.readFileSync(pdfPath)).digest('hex') : '' },
    governance: old.governance || { review_status: 'pending', reviewed_at: null, reviewer: null, freshness_days: 30 },
    decision_number: nonempty(d.decisionNo, d.procedureProposal?.proposalNumber, d.procedureProposal?.decisionNumber),
    implementation_level: levels.join(', '), implementation_levels: levels,
    procedure_type: nonempty(d.formalityType, d.type), sector, target_users: targetUsers,
    agency: { competent_agency: authority.map(x => x.name).filter(Boolean).join('; '), executing_agency: nonempty(d.executingAgencies, executing.map(x => x.name).filter(Boolean).join('; ')), authorized_agency: d.authorizedAgencies || '', coordinating_agency: d.coordinatingAgencies || '', receiving_address: d.dossierReceivingAddresses || '' },
    steps, documents: buildDocuments(d), submission_methods: methods, fees: buildFees(methods, d), legal_bases: legal,
    conditions: d.requirementsAndConditions || '', results,
    raw_sections: { 'TRÌNH TỰ THỰC HIỆN': steps.map(x => x.description).join('\n'), 'THÀNH PHẦN HỒ SƠ': arr(d.executionCases).map(c => `${c.name || ''}\n${arr(c.profileComponents).map(x => x.name).join('\n')}`).join('\n'), 'CÁCH THỨC THỰC HIỆN': methods.map(x => `${x.label}: ${x.processing_time}${x.description ? ` - ${x.description}` : ''}`).join('\n'), 'CĂN CỨ PHÁP LÝ': legal.map(x => `${x.title} - ${x.document_number}`).join('\n'), 'CƠ QUAN THỰC HIỆN': nonempty(d.executingAgencies, executing.map(x => x.name).join('; ')), 'YÊU CẦU, ĐIỀU KIỆN THỰC HIỆN': d.requirementsAndConditions || '', 'KẾT QUẢ XỬ LÝ': results.map(x => `${x.title} - ${x.code}`).join('\n'), 'TỪ KHÓA': d.keywords || '', 'MÔ TẢ': d.description || d.note || '' },
    classification: { life_event_group: { name: GROUPS[group], slug: group, method }, sector: { name: sector, slug: slug(sector) }, implementation_levels: levels.map(name => ({ name, slug: slug(name) })), target_users: targetUsers.map(name => ({ name, slug: slug(name) })), agencies: executing.map(x => ({ name: x.name || '', slug: slug(x.name) })), administrative_scope: 'nationwide' },
  };
}

for (const group of Object.keys(GROUPS)) fs.mkdirSync(path.join(ROOT, group), { recursive: true });
const locations = [];
for (const group of fs.readdirSync(ROOT)) {
  const groupPath = path.join(ROOT, group);
  if (!fs.statSync(groupPath).isDirectory()) continue;
  for (const code of fs.readdirSync(groupPath)) {
    const folder = path.join(groupPath, code);
    if (fs.statSync(folder).isDirectory() && fs.existsSync(path.join(folder, 'raw_procedure.json'))) locations.push(folder);
  }
}

const counts = Object.fromEntries(Object.keys(GROUPS).map(x => [x, 0]));
const methods = { service_group: 0, sector_rule: 0, keyword_rule: 0, fallback: 0 };
for (const folder of locations) {
  const raw = JSON.parse(fs.readFileSync(path.join(folder, 'raw_procedure.json'), 'utf8'));
  const old = JSON.parse(fs.readFileSync(path.join(folder, 'procedure.json'), 'utf8'));
  const [group, method] = classify(raw.detail || raw);
  const code = nonempty(raw.code, raw.detail?.code, path.basename(folder)).trim();
  const target = path.join(ROOT, group, code);
  const enriched = build(folder, raw, old, group, method);
  fs.writeFileSync(path.join(folder, 'procedure.json'), `${JSON.stringify(enriched, null, 2)}\n`, 'utf8');
  // Directory moves are performed afterward with PowerShell's native Move-Item.
  // On Windows, fs.renameSync can fail with EPERM for otherwise valid moves.
  counts[group]++;
  methods[method]++;
}
console.log(JSON.stringify({ total: locations.length, counts, classification_methods: methods }, null, 2));
