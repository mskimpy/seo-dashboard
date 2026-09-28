/* Скриншот дашборда через headless Chrome.
   Сначала поднимает локальный сервер (иначе fetch не прочитает data/latest.json).
   Запуск: node scripts/screenshot.js  ->  docs/preview-*.png  */

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const os = require('os');

// chrome-headless-shell, установленный через `npx puppeteer browsers install`
function findChrome() {
  const base = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome-headless-shell');
  if (!fs.existsSync(base)) return null;
  for (const version of fs.readdirSync(base)) {
    const bin = path.join(base, version, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs');
const PORT = 8137;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
      if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await serve();
  const executablePath = findChrome();
  if (!executablePath) throw new Error('chrome-headless-shell не найден: npx puppeteer browsers install chrome-headless-shell');
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });

  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));

    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('#kpi-grid .kpi', { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 2500)); // дать графикам дорисоваться

    await page.screenshot({ path: path.join(OUT_DIR, 'preview-top.png') });
    await page.screenshot({ path: path.join(OUT_DIR, 'preview-full.png'), fullPage: true });

    const mobile = await browser.newPage();
    await mobile.setViewport({ width: 414, height: 900, deviceScaleFactor: 2 });
    await mobile.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle0', timeout: 60000 });
    await mobile.waitForSelector('#kpi-grid .kpi', { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 2000));
    await mobile.screenshot({ path: path.join(OUT_DIR, 'preview-mobile.png'), fullPage: true });

    const info = await page.evaluate(() => ({
      kpis: document.querySelectorAll('#kpi-grid .kpi').length,
      compareRows: document.querySelectorAll('#compare-table tbody tr').length,
      kwRows: document.querySelectorAll('#kw-table tbody tr').length,
      canvasDrawn: Array.from(document.querySelectorAll('canvas'))
        .map((c) => c.id + ':' + (c.getContext('2d') ? c.width + 'x' + c.height : 'no-ctx')),
      subtitle: document.getElementById('subtitle').textContent.trim(),
    }));
    console.log(JSON.stringify(info, null, 2));
    console.log('\nОшибки страницы:', errors.length ? errors : 'нет');
  } finally {
    await browser.close();
    server.close();
  }
})();
