/* Скриншот дашборда через headless Chrome.
   Поднимает локальный сервер (иначе fetch не прочитает data/latest.json).
   Запуск: node scripts/screenshot.js  ->  docs/preview-*.png  */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs');
const PORT = 8137;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// chrome-headless-shell, установленный через `npx puppeteer browsers install`.
// Ищем в нескольких местах: переменная HOME может быть не задана, тогда
// os.homedir() возвращает /root, где браузера нет.
function findChrome() {
  const roots = [
    process.env.PUPPETEER_CACHE_DIR,
    process.env.HOME ? path.join(process.env.HOME, '.cache', 'puppeteer') : null,
    '/home/user/.cache/puppeteer',
    path.join(os.homedir(), '.cache', 'puppeteer'),
  ].filter(Boolean);

  // Полный Chrome предпочтительнее: chrome-headless-shell в этой среде
  // падает при подключении по протоколу отладки.
  const layouts = [
    ['chrome', 'chrome-linux64', 'chrome'],
    ['chrome-headless-shell', 'chrome-headless-shell-linux64', 'chrome-headless-shell'],
  ];

  for (const root of roots) {
    for (const parts of layouts) {
      const base = path.join(root, parts[0]);
      if (!fs.existsSync(base)) continue;
      for (const version of fs.readdirSync(base)) {
        const bin = path.join(base, version, parts[1], parts[2]);
        if (fs.existsSync(bin)) return bin;
      }
    }
  }
  return null;
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
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
  if (!executablePath) throw new Error('chrome-headless-shell не найден');

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: '/tmp/seo-dashboard-chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
      '--font-render-hinting=none',
      '--hide-scrollbars',
    ],
  });

  const errors = [];
  try {
    const page = await browser.newPage();
    // Chrome всегда запрашивает /favicon.ico — для пустой страницы это 404.
    // Иконка встроена в index.html как SVG, поэтому запрос безвреден и в отчёт не идёт.
    const isNoise = (text) => /favicon\.ico/.test(String(text));

    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !isNoise(m.text())) errors.push('console: ' + m.text());
    });
    page.on('requestfailed', (r) => {
      if (!isNoise(r.url())) errors.push('requestfailed: ' + r.url());
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && !isNoise(r.url())) errors.push('HTTP ' + r.status() + ': ' + r.url());
    });

    await page.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('#kpi-grid .kpi', { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 3000)); // дать графикам дорисоваться

    await page.screenshot({ path: path.join(OUT_DIR, 'preview-top.png') });

    // Отдельно — блок рейтинга, он самый нагруженный.
    const rankBox = await page.$('#chart-rank');
    if (rankBox) await rankBox.screenshot({ path: path.join(OUT_DIR, 'preview-rank.png') });

    await page.screenshot({ path: path.join(OUT_DIR, 'preview-full.png'), fullPage: true });

    const info = await page.evaluate(() => ({
      kpis: document.querySelectorAll('#kpi-grid .kpi').length,
      compareDomainRows: Array.from(document.querySelectorAll('#compare-table tbody tr'))
        .filter((tr) => !tr.classList.contains('group-row')).length,
      groupRows: document.querySelectorAll('#compare-table tbody tr.group-row').length,
      chips: document.querySelectorAll('#picker .chip[data-domain]').length,
      kwHeadCols: document.querySelectorAll('#kw-head-row th').length,
      kwRows: document.querySelectorAll('#kw-table tbody tr').length,
      canvases: Array.from(document.querySelectorAll('canvas')).map((c) => c.id + ':' + c.width + 'x' + c.height),
      docHeight: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    console.log(JSON.stringify(info, null, 2));
    console.log('\nОшибки страницы:', errors.length ? errors : 'нет');
  } finally {
    await browser.close();
    server.close();
  }
})();
