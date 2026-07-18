/**
 * scraper-fast.js - Phien ban NHANH (chay song song)
 *
 * Tang toc bang cach xu ly CONCURRENCY thu tuc cung luc.
 * Mac dinh: 5 tab chay dong thoi → nhanh gap ~5x.
 *
 * Chay: node scraper-fast.js
 * Hoac chi dinh concurrency: node scraper-fast.js --concurrency=8
 *
 * Resume tu diem dang do: tu dong doc scraper-state.json
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

const BATCH_SIZE   = 100;  // Lay nhieu hon moi page
const DELAY_MS     = 100;  // Giam delay xuong (song song nen it rui ro bi block hon)
const MAX_RETRIES  = 3;
// So tab chay dong thoi - doc tu CLI hoac mac dinh 5
const CONCURRENCY  = parseInt(
  (process.argv.find(a => a.startsWith('--concurrency=')) || '--concurrency=5')
    .split('=')[1]
);

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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function sanitize(n) {
  return String(n || 'x').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().substring(0, 200) || 'x';
}
function logError(msg) {
  fs.appendFileSync(ERRORS_FILE, new Date().toISOString() + ' | ' + msg + '\n');
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

// ─── CONCURRENCY POOL ─────────────────────────────────────────────────────────
// Chay toi da N task dong thoi
async function runPool(tasks, concurrency, worker) {
  const results = [];
  let i = 0;
  async function runNext() {
    while (i < tasks.length) {
      const idx  = i++;
      const task = tasks[idx];
      results[idx] = await worker(task);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(concurrency, tasks.length); w++) {
    workers.push(runNext());
  }
  await Promise.all(workers);
  return results;
}

// ─── API helpers (chay trong page context) ────────────────────────────────────
function makeApiPost(page) {
  return function(endpoint, body) {
    return page.evaluate(function(p) {
      return fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Accept': 'application/json;odata=verbose' },
        body: JSON.stringify(p.body),
      })
      .then(function(r) { return r.json().then(function(d) { return { ok: true, data: d }; }); })
      .catch(function(e) { return { ok: false, error: e.message }; });
    }, { url: p => p, body: body });
  };
}

// Page-aware fetch (fix closure)
async function apiFetch(page, endpoint, body) {
  return page.evaluate(
    function(p) {
      return fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Accept': 'application/json;odata=verbose' },
        body: JSON.stringify(p.body),
      })
      .then(function(r) { return r.json().then(function(d) { return { ok: true, data: d }; }); })
      .catch(function(e) { return { ok: false, error: e.message }; });
    },
    { url: API_BASE + '/' + endpoint, body: body }
  );
}

async function fetchBinary(page, endpoint, body) {
  return page.evaluate(
    function(p) {
      return fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Accept': '*/*' },
        body: JSON.stringify(p.body),
      })
      .then(function(r) {
        if (!r.ok) return { ok: false, status: r.status };
        return r.arrayBuffer().then(function(ab) { return { ok: true, bytes: Array.from(new Uint8Array(ab)) }; });
      })
      .catch(function(e) { return { ok: false, error: e.message }; });
    },
    { url: API_BASE + '/' + endpoint, body: body }
  );
}

// ─── XU LY 1 THU TUC (dung page rieng) ───────────────────────────────────────
async function processProcedure(page, item, codeDir) {
  const id   = item.id;
  const code = item.code || item.codeNotation || id;

  // 1. Chi tiet
  let detail = null;
  for (let r = 0; r < MAX_RETRIES; r++) {
    const res = await apiFetch(page, 'configuring/formality/get-formality-by-citizen', { id });
    if (res.ok && res.data && res.data.data) { detail = res.data.data; break; }
    await sleep(500 * (r + 1));
  }

  if (!detail) {
    fs.writeFileSync(path.join(codeDir, 'khong-vao-duoc.txt'),
      'Khong lay duoc chi tiet.\nURL: ' + BASE_URL + '/chi-tiet-thu-tuc/' + code + '\n');
    logError('[' + code + '] detail fail');
    return { code, ok: false };
  }

  // Luu JSON
  fs.writeFileSync(
    path.join(codeDir, 'procedure.json'),
    JSON.stringify({ id, code, name: item.name, detail }, null, 2)
  );

  // 2. PDF
  let pdfOk = false;
  for (let r = 0; r < MAX_RETRIES; r++) {
    const res = await fetchBinary(page, 'configuring/formality/export-pdf-formality-detail-by-citizen', { formalityId: id });
    if (res.ok && res.bytes && res.bytes.length > 100) {
      fs.writeFileSync(path.join(codeDir, 'chi-tiet-thu-tuc-' + sanitize(code) + '.pdf'), Buffer.from(res.bytes));
      pdfOk = true;
      break;
    }
    await sleep(500 * (r + 1));
  }

  if (!pdfOk) {
    fs.writeFileSync(path.join(codeDir, 'pdf-link.txt'),
      'PDF khong tai duoc.\nURL: ' + BASE_URL + '/chi-tiet-thu-tuc/' + code + '\n');
  }

  // 3. File mau bieu (neu co)
  const comps = detail.profileComponents || [];
  let attachCount = 0;
  for (const comp of comps) {
    for (const att of (comp.attachments || [])) {
      const fileId   = att.fileId || att.id;
      const fileName = att.fileName || att.name || ('mau-' + fileId);
      if (!fileId) continue;
      const mauDir = path.join(codeDir, 'mau');
      if (!fs.existsSync(mauDir)) fs.mkdirSync(mauDir);
      const savePath = path.join(mauDir, sanitize(fileName));
      if (fs.existsSync(savePath)) continue;
      try {
        const res = await page.evaluate(function(p) {
          return fetch(p.url + '?fileId=' + encodeURIComponent(p.fileId), { headers: { 'Accept': '*/*' } })
            .then(function(r) { return r.ok ? r.arrayBuffer().then(function(ab) { return { ok: true, bytes: Array.from(new Uint8Array(ab)) }; }) : { ok: false }; })
            .catch(function(e) { return { ok: false }; });
        }, { url: API_BASE + '/submitting/preview-attachment-by-citizen', fileId });
        if (res.ok && res.bytes && res.bytes.length > 0) {
          fs.writeFileSync(savePath, Buffer.from(res.bytes));
          attachCount++;
        }
      } catch(e) {}
      await sleep(50);
    }
  }

  return { code, ok: true, pdfOk, attachCount };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== DVC Scraper FAST (concurrency=' + CONCURRENCY + ') ===');
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const state = loadState();
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7' }
  });

  // Tao pool cac page (tabs)
  console.log('Tao ' + CONCURRENCY + ' tabs song song...');
  const pages = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    const p = await context.newPage();
    await p.goto(BASE_URL + '/thu-tuc-hanh-chinh', { waitUntil: 'networkidle', timeout: 30000 });
    pages.push(p);
    process.stdout.write('  Tab ' + (i + 1) + ' san sang\n');
  }
  await sleep(1000);
  console.log('Tat ca ' + CONCURRENCY + ' tabs da san sang!\n');

  // Page dung de lay danh sach (1 page rieng)
  const listPage = pages[0];
  // Pages xu ly: all pages
  let pageIdx = 0; // round-robin tab

  let stats = { processed: 0, pdf: 0, errors: 0 };
  const startTime = Date.now();

  for (const group of SERVICE_GROUPS) {
    if (state.groupProgress[group.id] === 'DONE') {
      console.log('[SKIP] ' + group.slug);
      continue;
    }

    const groupDir = path.join(OUTPUT_DIR, group.slug);
    if (!fs.existsSync(groupDir)) fs.mkdirSync(groupDir, { recursive: true });

    console.log('\n[GROUP] ' + group.slug);

    let lastId = (state.groupProgress[group.id] && state.groupProgress[group.id] !== 'DONE')
                  ? state.groupProgress[group.id] : '';
    let groupTotal = 0;
    let pNum = 0;

    while (true) {
      pNum++;

      // Lay danh sach
      let listResult = null;
      for (let r = 0; r < MAX_RETRIES; r++) {
        listResult = await apiFetch(listPage, 'submitting/formality/list-all-public-formality-by-citizen', {
          limit: BATCH_SIZE, lastId: lastId || '', q: '', serviceGroupId: group.id,
          categoryId: '', departmentCode: '',
        });
        if (listResult.ok) break;
        await sleep(2000);
      }

      if (!listResult || !listResult.ok || !listResult.data || !listResult.data.data) {
        logError('[' + group.slug + '] page ' + pNum + ' fail');
        break;
      }

      const items = listResult.data.data.items || [];
      if (items.length === 0) break;
      groupTotal += items.length;

      // Loc bo item da xu ly / folder da co
      const toProcess = items.filter(function(item) {
        if (state.processed[item.id]) return false;
        const code    = item.code || item.codeNotation || item.id;
        const codeDir = path.join(groupDir, code);
        if (fs.existsSync(codeDir) && fs.existsSync(path.join(codeDir, 'procedure.json'))) {
          state.processed[item.id] = true;
          return false;
        }
        return true;
      });

      process.stdout.write('  [p' + pNum + '] ' + items.length + ' items, xu ly: ' + toProcess.length + '\n');

      if (toProcess.length > 0) {
        // Chay song song voi pool
        await runPool(toProcess, CONCURRENCY, async function(item) {
          const code    = item.code || item.codeNotation || item.id;
          const codeDir = path.join(groupDir, code);
          if (!fs.existsSync(codeDir)) fs.mkdirSync(codeDir, { recursive: true });

          // Round-robin chon tab
          const pg = pages[pageIdx % CONCURRENCY];
          pageIdx++;

          try {
            const result = await processProcedure(pg, item, codeDir);
            state.processed[item.id] = true;
            stats.processed++;
            if (result.pdfOk) stats.pdf++;
            if (!result.ok) stats.errors++;

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            const speed   = (stats.processed / Math.max(1, elapsed) * 60).toFixed(1);
            process.stdout.write(
              '    [' + code + '] ' + (result.ok ? 'OK' : 'ERR') +
              (result.pdfOk ? '+PDF' : '') +
              ' | tong: ' + stats.processed + ' | ' + speed + '/phut\n'
            );
          } catch(err) {
            logError('[' + code + '] exception: ' + err.message);
            state.processed[item.id] = 'error';
            stats.errors++;
          }

          await sleep(DELAY_MS);
        });
      }

      // Cap nhat cursor + luu state
      const lastItem = items[items.length - 1];
      lastId = (lastItem && lastItem.id) ? lastItem.id : '';
      state.groupProgress[group.id] = lastId;
      saveState(state);

      if (items.length < BATCH_SIZE) break;
      await sleep(200);
    }

    state.groupProgress[group.id] = 'DONE';
    saveState(state);
    console.log('  [DONE] ' + group.slug + ': ' + groupTotal + ' thu tuc\n');
  }

  await browser.close();

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('='.repeat(55));
  console.log('HOAN THANH! Thoi gian: ' + totalSec + 's');
  console.log('  Xu ly: ' + stats.processed + ' | PDF: ' + stats.pdf + ' | Loi: ' + stats.errors);
  console.log('='.repeat(55));
}

main().catch(function(err) {
  console.error('FATAL:', err.message);
  process.exit(1);
});
