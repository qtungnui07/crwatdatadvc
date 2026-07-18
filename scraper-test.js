const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://dichvucong.gov.vn';
const API_BASE = BASE_URL + '/api/v1';
const OUTPUT_DIR = path.join(__dirname, 'procedures');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function sanitize(n) { return String(n||'x').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim().substring(0,200); }

(async () => {
  var browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  var page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).newPage();
  
  await page.goto(BASE_URL + '/thu-tuc-hanh-chinh', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);
  console.log('Session OK');
  
  // Test group "huu-tri"
  var listRes = await page.evaluate(async (u) => {
    var r = await fetch(u, { method:'POST', headers:{'Content-Type':'application/json; charset=UTF-8','Accept':'application/json'}, body: JSON.stringify({limit:3,lastId:'',q:'',serviceGroupId:'019b6e27-7642-76e5-8f29-649db67dd5e4',categoryId:'',departmentCode:''}) });
    return r.json();
  }, API_BASE + '/submitting/formality/list-all-public-formality-by-citizen');
  
  var items = (listRes.data && listRes.data.items) || [];
  console.log('Got ' + items.length + ' items from huu-tri group');
  
  if (items.length === 0) {
    console.log('No items! Check API response:', JSON.stringify(listRes).substring(0,300));
    await browser.close(); return;
  }
  
  var item = items[0];
  console.log('First item: ' + item.code + ' - ' + item.name);
  
  // Test detail
  var detailRes = await page.evaluate(async (params) => {
    var r = await fetch(params.url, { method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'}, body: JSON.stringify({id: params.id}) });
    return r.json();
  }, { url: API_BASE + '/configuring/formality/get-formality-by-citizen', id: item.id });
  
  console.log('Detail OK:', detailRes.code);
  var detail = detailRes.data || {};
  var comps = detail.profileComponents || [];
  console.log('Profile components:', comps.length);
  
  // Test PDF download
  var pdfRes = await page.evaluate(async (params) => {
    var r = await fetch(params.url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({formalityId: params.id}) });
    if (!r.ok) return { ok: false, status: r.status };
    var ab = await r.arrayBuffer();
    return { ok: true, size: ab.byteLength, ct: r.headers.get('content-type') };
  }, { url: API_BASE + '/configuring/formality/export-pdf-formality-detail-by-citizen', id: item.id });
  
  console.log('PDF result:', JSON.stringify(pdfRes));
  
  // Test attachment (lay tu profileComponent dau tien neu co)
  for (var ci = 0; ci < comps.length; ci++) {
    var atts = comps[ci].attachments || [];
    if (atts.length > 0) {
      var att = atts[0];
      console.log('Testing attachment:', att.fileId, att.fileName);
      
      var attRes = await page.evaluate(async (params) => {
        var url = params.url + '?fileId=' + encodeURIComponent(params.fileId);
        var r = await fetch(url, { headers: {'Accept':'*/*'} });
        if (!r.ok) return { ok: false, status: r.status, ct: r.headers.get('content-type') };
        var ab = await r.arrayBuffer();
        return { ok: true, size: ab.byteLength, ct: r.headers.get('content-type') };
      }, { url: API_BASE + '/submitting/preview-attachment-by-citizen', fileId: att.fileId });
      
      console.log('Attachment result:', JSON.stringify(attRes));
      break;
    }
  }
  
  await browser.close();
  console.log('Test DONE!');
})().catch(console.error);
