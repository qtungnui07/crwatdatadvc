/**
 * scraper.js - Cao toan bo 5665 thu tuc tu dichvucong.gov.vn
 *
 * Cau truc thu muc output:
 *   procedures/
 *     co-con-nho/
 *       1.001234/
 *         procedure.json        <- metadata + chi tiet
 *         chi-tiet-TENFILE.pdf  <- PDF tong hop thu tuc
 *         mau/
 *           TenMau.docx         <- Cac file mau bieu
 *     hoc-tap/
 *       ...
 *
 * Chay: node scraper.js
 * Co the resume neu bi gian doan (bo qua folder da co)
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const BASE_URL    = 'https://dichvucong.gov.vn';
const API_BASE    = BASE_URL + '/api/v1';
const OUTPUT_DIR  = path.join(__dirname, 'procedures');
const ERRORS_FILE = path.join(__dirname, 'errors.txt');
const STATE_FILE  = path.join(__dirname, 'scraper-state.json');

const BATCH_SIZE  = 50;   // So thu tuc lay moi lan
const DELAY_MS    = 500;  // Delay giua cac request (ms)
const MAX_RETRIES = 3;    // So lan retry

// ─── SERVICE GROUPS ───────────────────────────────────────────────────────────
const SERVICE_GROUPS = [
  { id: '019b694a-3c88-759a-8c84-1e02eb92a91b', slug: 'co-con-nho' },
  { id: '019b6e01-a0e9-75f9-b0a5-edac82b03d78', slug: 'hoc-tap' },
  { id: '019b6e11-d140-759c-a0b9-0bb7efd3fc4a', slug: 'viec-lam' },
  { id: '019b6e13-0cf4-70b7-b443-45281c901b6e', slug: 'cu-tru-va-giay-to-tuy-than' },
  { id: '019b6e14-5b92-776a-ab2b-af9f0c261d97', slug: 'hon-nhan-va-gia-dinh' },
  { id: '019b6e1a-3e04-7798-b659-49a14d3d2e58', slug: 'dien-luc-nha-o-dat-dai' },
  { id: '019b6e22-16dd-70db-ac65-d3fe6b69906c', slug: 'suc-khoe-va-y-te' },
  { id: '019b6e26-4c8c-74a8-8467-9edb2713d23e', slug: 'phuong-tien-va-nguoi-lai' },
  { id: '019b6e27-7642-76e5-8f29-649db67dd5e4', slug: 'huu-tri' },
  { id: '019b6e29-6dd5-7456-8d3e-a91feaae9f04', slug: 'nguoi-than-qua-doi' },
  { id: '019b6e31-866e-71ce-959b-af9f0836a7a2', slug: 'giai-quyet-khieu-kien' },
  { id: '019b6e0e-a904-742a-8407-d48b3d8c4730', slug: 'khoi-su-kinh-doanh' },
  { id: '019b6e0f-ad98-712e-96e6-5eea147fa53e', slug: 'lao-dong-va-bao-hiem-xa-hoi' },
  { id: '019b6e12-4c57-72fa-86a4-d3e76970213e', slug: 'tai-chinh-doanh-nghiep' },
  { id: '019b6e13-ad15-70ba-9889-126bb7521276', slug: 'dien-luc-dat-dai-xay-dung' },
  { id: '019b6e15-e590-71ed-9d9f-ce979fcdd9b2', slug: 'thuong-mai-quang-cao' },
  { id: '019b6e21-735f-75c6-82d2-cfc723b40a47', slug: 'so-huu-tri-tue-dang-ky-tai-san' },
  { id: '019b6e25-92b4-72d4-aae2-bae2eecf448b', slug: 'thanh-lap-chi-nhanh-van-phong' },
  { id: '019b6e26-f7a1-702f-9ace-47f15cca232b', slug: 'dau-thau-mua-sam-cong' },
  { id: '019b6e27-e274-7534-afba-98c2f732d180', slug: 'tai-co-cau-doanh-nghiep' },
  { id: '019b6e30-48a2-732a-8f83-b24540fddb77', slug: 'giai-quyet-tranh-chap-hop-dong' },
  { id: '019b6e32-be21-756c-a306-06cf253a0b6f', slug: 'tam-dung-cham-dut-hoat-dong' },
];

// ─── UTILS ────────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function sanitize(name) {
  return String(name || 'unknown')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .trim()
    .substring(0, 200) || 'unknown';
}

function logError(msg) {
  fs.appendFileSync(ERRORS_FILE, new Date().toISOString() + ' | ' + msg + '\n');
  console.error('[ERR]', msg);
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch(e) {}
  }
  return { processed: {}, groupProgress: {} };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── API (chay trong Playwright context - bypass WAF) ─────────────────────────
async function apiPost(page, endpoint, body) {
  return page.evaluate(
    function(p) {
      return fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Accept': 'application/json;odata=verbose' },
        body: JSON.stringify(p.body),
      })
      .then(function(r) { return r.json().then(function(d) { return { ok: true, data: d, status: r.status }; }); })
      .catch(function(e) { return { ok: false, error: e.message }; });
    },
    { url: API_BASE + '/' + endpoint, body: body }
  );
}

// Download binary file (tra ve Uint8Array tu browser)
async function downloadBinary(page, endpoint, body) {
  var result = await page.evaluate(
    function(p) {
      return fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Accept': '*/*' },
        body: JSON.stringify(p.body),
      })
      .then(function(r) {
        if (!r.ok) return { ok: false, status: r.status, error: 'HTTP ' + r.status };
        var ct = r.headers.get('content-type') || '';
        return r.arrayBuffer().then(function(ab) {
          return { ok: true, bytes: Array.from(new Uint8Array(ab)), contentType: ct };
        });
      })
      .catch(function(e) { return { ok: false, error: e.message }; });
    },
    { url: API_BASE + '/' + endpoint, body: body }
  );
  return result;
}

// Lay danh sach thu tuc theo group
async function fetchList(page, serviceGroupId, lastId) {
  return apiPost(page, 'submitting/formality/list-all-public-formality-by-citizen', {
    limit: BATCH_SIZE,
    lastId: lastId || '',
    q: '',
    serviceGroupId: serviceGroupId,
    categoryId: '',
    departmentCode: '',
  });
}

// Lay chi tiet thu tuc
async function fetchDetail(page, id) {
  return apiPost(page, 'configuring/formality/get-formality-by-citizen', { id: id });
}

// Tai PDF tong hop thu tuc
async function downloadProcedurePDF(page, formalityId) {
  return downloadBinary(page, 'configuring/formality/export-pdf-formality-detail-by-citizen', { formalityId: formalityId });
}

// Tai file mau bieu (attachment)
async function downloadAttachment(page, fileId, filePath) {
  // Thu endpoint preview-attachment-by-citizen
  var result = await page.evaluate(
    function(p) {
      var params = new URLSearchParams({ fileId: p.fileId });
      return fetch(p.url + '?' + params.toString(), {
        method: 'GET',
        headers: { 'Accept': '*/*' },
      })
      .then(function(r) {
        if (!r.ok) return { ok: false, status: r.status, error: 'HTTP ' + r.status };
        return r.arrayBuffer().then(function(ab) { return { ok: true, bytes: Array.from(new Uint8Array(ab)) }; });
      })
      .catch(function(e) { return { ok: false, error: e.message }; });
    },
    { url: API_BASE + '/submitting/preview-attachment-by-citizen', fileId: fileId }
  );
  return result;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== DVC Scraper - dichvucong.gov.vn ===');
  console.log('Output: ' + OUTPUT_DIR);
  console.log('State:  ' + STATE_FILE);
  console.log('');

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  var state = loadState();

  // Khoi dong browser
  var browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  var context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7' }
  });
  var page = await context.newPage();

  // Load trang chinh de co session
  console.log('[INIT] Tai trang chinh...');
  await page.goto(BASE_URL + '/thu-tuc-hanh-chinh', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);
  console.log('[INIT] Session OK\n');

  var stats = { processed: 0, pdfDownloaded: 0, attachDownloaded: 0, errors: 0 };

  // Duyet tung group
  for (var gi = 0; gi < SERVICE_GROUPS.length; gi++) {
    var group = SERVICE_GROUPS[gi];

    if (state.groupProgress[group.id] === 'DONE') {
      console.log('[SKIP] ' + group.slug + ' (da hoan thanh)');
      continue;
    }

    var groupDir = path.join(OUTPUT_DIR, group.slug);
    if (!fs.existsSync(groupDir)) fs.mkdirSync(groupDir, { recursive: true });

    console.log('\n' + '═'.repeat(55));
    console.log('[GROUP] ' + group.slug);
    console.log('═'.repeat(55));

    var lastId = (state.groupProgress[group.id] && state.groupProgress[group.id] !== 'DONE')
                  ? state.groupProgress[group.id] : '';
    var groupTotal = 0;
    var pageNum = 0;

    while (true) {
      pageNum++;
      process.stdout.write('  [PAGE ' + pageNum + '] ');

      // Lay danh sach (retry)
      var listResult = null;
      for (var rt = 0; rt < MAX_RETRIES; rt++) {
        listResult = await fetchList(page, group.id, lastId);
        if (listResult.ok) break;
        await sleep(2000 * (rt + 1));
      }

      if (!listResult || !listResult.ok || !listResult.data || !listResult.data.data) {
        console.log('FAIL');
        logError('[' + group.slug + '] page ' + pageNum + ': ' + JSON.stringify(listResult).substring(0, 200));
        break;
      }

      var items = listResult.data.data.items || [];
      console.log(items.length + ' thu tuc');

      if (items.length === 0) break;
      groupTotal += items.length;

      // Xu ly tung thu tuc
      for (var ii = 0; ii < items.length; ii++) {
        var item = items[ii];
        var id   = item.id;
        var code = item.code || item.codeNotation || id;
        var name = item.name || 'unknown';

        // Bo qua neu da xu ly
        if (state.processed[id]) {
          continue;
        }

        var codeDir = path.join(groupDir, code);

        // Kiem tra folder da co du lieu chua
        if (fs.existsSync(codeDir) && fs.existsSync(path.join(codeDir, 'procedure.json'))) {
          state.processed[id] = true;
          continue;
        }

        if (!fs.existsSync(codeDir)) fs.mkdirSync(codeDir, { recursive: true });

        process.stdout.write('    [' + code + '] ' + name.substring(0, 50) + '... ');

        try {
          // 1. Lay chi tiet
          var detailResult = null;
          for (var dr = 0; dr < MAX_RETRIES; dr++) {
            detailResult = await fetchDetail(page, id);
            if (detailResult.ok) break;
            await sleep(1000 * (dr + 1));
          }

          if (!detailResult || !detailResult.ok || !detailResult.data || !detailResult.data.data) {
            process.stdout.write('FAIL_DETAIL\n');
            fs.writeFileSync(path.join(codeDir, 'khong-vao-duoc.txt'),
              'Khong lay duoc chi tiet.\n' +
              'URL: ' + BASE_URL + '/chi-tiet-thu-tuc/' + code + '\n' +
              'Error: ' + JSON.stringify(detailResult || {}).substring(0, 500) + '\n'
            );
            logError('[' + code + '] detail fail: ' + JSON.stringify(detailResult || {}).substring(0, 200));
            stats.errors++;
            state.processed[id] = 'error';
            stats.processed++;
            await sleep(DELAY_MS);
            continue;
          }

          var detail = detailResult.data.data;

          // Luu procedure.json
          fs.writeFileSync(
            path.join(codeDir, 'procedure.json'),
            JSON.stringify({ id: id, code: code, name: name, detail: detail }, null, 2)
          );

          process.stdout.write('JSON ');

          // 2. Tai PDF tong hop thu tuc
          var pdfResult = null;
          for (var pr = 0; pr < MAX_RETRIES; pr++) {
            pdfResult = await downloadProcedurePDF(page, id);
            if (pdfResult && pdfResult.ok) break;
            await sleep(1000 * (pr + 1));
          }

          if (pdfResult && pdfResult.ok && pdfResult.bytes && pdfResult.bytes.length > 100) {
            var pdfFileName = 'chi-tiet-thu-tuc-' + sanitize(code) + '.pdf';
            fs.writeFileSync(path.join(codeDir, pdfFileName), Buffer.from(pdfResult.bytes));
            process.stdout.write('PDF ');
            stats.pdfDownloaded++;
          } else {
            // Neu khong tai duoc PDF - ghi link
            fs.writeFileSync(path.join(codeDir, 'pdf-link.txt'),
              'PDF khong tai duoc qua API.\n' +
              'Thu cong: ' + BASE_URL + '/chi-tiet-thu-tuc/' + code + '\n' +
              (pdfResult ? 'Error: ' + JSON.stringify(pdfResult).substring(0, 200) : '') + '\n'
            );
            process.stdout.write('no-pdf ');
          }

          // 3. Tai cac file mau bieu tu profileComponents
          var profileComponents = detail.profileComponents || [];
          var attachDir = path.join(codeDir, 'mau');
          var attachCount = 0;

          for (var ci = 0; ci < profileComponents.length; ci++) {
            var comp = profileComponents[ci];
            var attachments = comp.attachments || [];

            for (var ai = 0; ai < attachments.length; ai++) {
              var att = attachments[ai];
              var fileId   = att.fileId || att.id;
              var fileName = att.fileName || att.name || ('mau-' + fileId);

              if (!fileId) continue;

              if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });

              var safeName = sanitize(fileName);
              var savePath = path.join(attachDir, safeName);

              if (fs.existsSync(savePath)) continue;

              try {
                var attResult = await downloadAttachment(page, fileId, att.filePath || '');
                if (attResult && attResult.ok && attResult.bytes && attResult.bytes.length > 0) {
                  fs.writeFileSync(savePath, Buffer.from(attResult.bytes));
                  attachCount++;
                  stats.attachDownloaded++;
                }
              } catch(attErr) {
                logError('[' + code + '] attach ' + fileName + ': ' + attErr.message);
              }

              await sleep(200);
            }
          }

          if (attachCount > 0) process.stdout.write('(' + attachCount + ' mau) ');
          process.stdout.write('OK\n');

          state.processed[id] = true;
          stats.processed++;

        } catch(err) {
          process.stdout.write('EXCEPTION\n');
          logError('[' + code + '] exception: ' + err.message);
          fs.writeFileSync(path.join(codeDir, 'khong-vao-duoc.txt'),
            'Exception: ' + err.message + '\n' +
            'URL: ' + BASE_URL + '/chi-tiet-thu-tuc/' + code + '\n'
          );
          stats.errors++;
          state.processed[id] = 'error';
          stats.processed++;
        }

        await sleep(DELAY_MS);
      } // end items loop

      // Cap nhat cursor
      var lastItem = items[items.length - 1];
      lastId = (lastItem && lastItem.id) ? lastItem.id : '';

      // Luu state
      state.groupProgress[group.id] = lastId;
      saveState(state);

      if (items.length < BATCH_SIZE) {
        console.log('  [DONE] ' + group.slug + ': ' + groupTotal + ' thu tuc');
        break;
      }

      await sleep(DELAY_MS);
    } // end pagination loop

    state.groupProgress[group.id] = 'DONE';
    saveState(state);
  } // end groups loop

  await browser.close();

  console.log('\n' + '═'.repeat(55));
  console.log('HOAN THANH!');
  console.log('  Thu tuc xu ly: ' + stats.processed);
  console.log('  PDF tai duoc : ' + stats.pdfDownloaded);
  console.log('  Mau tai duoc : ' + stats.attachDownloaded);
  console.log('  Loi          : ' + stats.errors);
  console.log('  Output       : ' + OUTPUT_DIR);
  console.log('  Log loi      : ' + ERRORS_FILE);
  console.log('═'.repeat(55));
}

main().catch(function(err) {
  console.error('FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
