/**
 * discover-api.js
 * Dùng Playwright để intercept tất cả API calls từ dichvucong.gov.vn
 * Chạy: node discover-api.js
 */

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://dichvucong.gov.vn';
const OUTPUT_FILE = 'api-discovery.json';

(async () => {
  console.log('Khởi động trình duyệt...');
  
  const browser = await chromium.launch({
    headless: false, // headless: false để có thể xem
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    }
  });

  const page = await context.newPage();
  
  const apiCalls = [];

  // Intercept tất cả requests
  page.on('request', request => {
    const url = request.url();
    const method = request.method();
    if (!url.includes('.js') && !url.includes('.css') && !url.includes('.png') && 
        !url.includes('.svg') && !url.includes('.ico') && !url.includes('fonts')) {
      apiCalls.push({
        type: 'REQUEST',
        url,
        method,
        headers: request.headers(),
        postData: request.postData()
      });
      console.log(`[REQ] ${method} ${url}`);
    }
  });

  page.on('response', async response => {
    const url = response.url();
    const status = response.status();
    const contentType = response.headers()['content-type'] || '';
    
    if (contentType.includes('json') || contentType.includes('application')) {
      try {
        const body = await response.text();
        apiCalls.push({
          type: 'RESPONSE',
          url,
          status,
          contentType,
          bodyPreview: body.substring(0, 500),
          fullBody: body
        });
        console.log(`[RES] ${status} ${url} (${contentType})`);
        console.log(`  Body preview: ${body.substring(0, 200)}`);
      } catch (e) {}
    }
  });

  // 1. Vào trang chủ
  console.log('\n=== Trang chủ ===');
  await page.goto(`${BASE_URL}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 2. Vào trang thủ tục hành chính
  console.log('\n=== Trang thủ tục hành chính ===');
  await page.goto(`${BASE_URL}/thu-tuc-hanh-chinh`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 3. Chụp màn hình để xem trang
  await page.screenshot({ path: 'screenshot-list.png', fullPage: true });

  // 4. Lấy HTML hiện tại
  const listHTML = await page.content();
  fs.writeFileSync('page-list.html', listHTML);
  console.log('Saved page-list.html');

  // 5. Thử click vào thủ tục đầu tiên
  try {
    const firstLink = await page.$('a[href*="chi-tiet"], a[href*="thu-tuc"], .procedure-item a, table a');
    if (firstLink) {
      const href = await firstLink.getAttribute('href');
      console.log(`\n=== Click vào: ${href} ===`);
      await firstLink.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'screenshot-detail.png', fullPage: true });
    }
  } catch (e) {
    console.log('Không click được:', e.message);
  }

  // 6. Lưu kết quả
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(apiCalls, null, 2));
  console.log(`\nĐã lưu ${apiCalls.length} API calls vào ${OUTPUT_FILE}`);

  // 7. Phân tích kết quả
  const jsonResponses = apiCalls.filter(c => c.type === 'RESPONSE' && c.contentType && c.contentType.includes('json'));
  console.log(`\n=== JSON Responses (${jsonResponses.length}) ===`);
  jsonResponses.forEach(r => {
    console.log(`URL: ${r.url}`);
    console.log(`Preview: ${r.bodyPreview}`);
    console.log('---');
  });

  await browser.close();
  console.log('\nXong!');
})();
