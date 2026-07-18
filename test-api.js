/**
 * test-api.js - Test API structure de biet cau truc response
 * Chay: node test-api.js
 */
const { chromium } = require('playwright');

const BASE_URL = 'https://dichvucong.gov.vn';
const API_BASE = BASE_URL + '/api/v1';

async function apiPost(page, endpoint, body) {
  return page.evaluate(async function(p) {
    try {
      var res = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Accept': 'application/json;odata=verbose' },
        body: JSON.stringify(p.body),
      });
      var data = await res.json();
      return { ok: true, data: data, status: res.status };
    } catch (e) { return { ok: false, error: e.message }; }
  }, { url: API_BASE + '/' + endpoint, body: body });
}

(async () => {
  var browser = await chromium.launch({ headless: true });
  var page = await (await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  })).newPage();

  await page.goto(BASE_URL + '/thu-tuc-hanh-chinh', { waitUntil: 'networkidle', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // 1. Lay 3 thu tuc dau tien
  var listRes = await page.evaluate(async function(url) {
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Accept': 'application/json;odata=verbose' },
      body: JSON.stringify({ limit: 3, lastId: '', q: '', serviceGroupId: '019b694a-3c88-759a-8c84-1e02eb92a91b', categoryId: '', departmentCode: '' }),
    });
    return res.json();
  }, API_BASE + '/submitting/formality/list-all-public-formality-by-citizen');

  console.log('=== LIST RESPONSE KEYS ===');
  console.log(JSON.stringify(Object.keys(listRes), null, 2));
  if (listRes.data && listRes.data.items) {
    var item = listRes.data.items[0];
    console.log('\n=== ITEM KEYS ===');
    console.log(JSON.stringify(Object.keys(item), null, 2));
    console.log('\n=== ITEM SAMPLE ===');
    console.log(JSON.stringify(item, null, 2));

    // 2. Lay chi tiet
    var detailRes = await page.evaluate(async function(params) {
      var res = await fetch(params.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Accept': 'application/json;odata=verbose' },
        body: JSON.stringify({ id: params.id }),
      });
      return res.json();
    }, { url: API_BASE + '/configuring/formality/get-formality-by-citizen', id: item.id });

    console.log('\n=== DETAIL KEYS ===');
    if (detailRes.data) {
      console.log(JSON.stringify(Object.keys(detailRes.data), null, 2));
      console.log('\n=== DETAIL (no icon fields) ===');
      var d = detailRes.data;
      // Hien thi cac truong quan trong
      var important = {};
      for (var k of Object.keys(d)) {
        var v = d[k];
        if (Array.isArray(v)) {
          important[k] = { type: 'Array', length: v.length, sample: v[0] };
        } else if (typeof v === 'object' && v !== null) {
          important[k] = { type: 'Object', keys: Object.keys(v) };
        } else {
          important[k] = v;
        }
      }
      console.log(JSON.stringify(important, null, 2));
    }
  }

  await browser.close();
})().catch(console.error);
