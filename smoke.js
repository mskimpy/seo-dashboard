/* Прогон дашборда в jsdom: проверяем, что данные доезжают до DOM,
   таблицы заполняются, переключатель баз работает и ошибок нет.
   Запуск: node scripts/smoke.js   (или через npm test) */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'latest.json'), 'utf8'));

const problems = [];
const check = (ok, message) => {
  console.log(`  ${ok ? 'v' : 'x'} ${message}`);
  if (!ok) problems.push(message);
};

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

// Chart.js заменяем заглушкой: проверяем не отрисовку пикселей, а конфигурацию.
const chartCalls = [];
class ChartStub {
  constructor(ctx, config) {
    this.config = config;
    this.canvasId = ctx && ctx.id;
    chartCalls.push({
      id: this.canvasId,
      type: config.type,
      datasets: (config.data.datasets || []).length,
      labels: (config.data.labels || []).length,
      stackable: (config.data.datasets || []).every((d) => Array.isArray(d.data)),
    });
  }
  destroy() {}
  static defaults = {
    font: {}, color: null,
    plugins: { legend: { labels: {} } },
  };
}
window.Chart = ChartStub;
window.HTMLCanvasElement.prototype.getContext = () => ({});

// fetch подменяем на чтение локального файла данных
window.fetch = async (url) => {
  if (String(url).startsWith('data/latest.json')) {
    return { ok: true, status: 200, json: async () => data };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

window.eval(appJs);

const flush = () => new Promise((r) => setTimeout(r, 60));

(async () => {
  // app.js вешает загрузку на DOMContentLoaded, который в jsdom уже прошёл
  await flush(); await flush();

  const $ = (sel) => window.document.querySelector(sel);
  const $$ = (sel) => Array.from(window.document.querySelectorAll(sel));

  console.log('\nОшибки в консоли:');
  check(errors.length === 0, errors.length ? `исключения: ${errors.join(' | ')}` : 'исключений нет');

  console.log('\nKPI-плитки:');
  const kpis = $$('#kpi-grid .kpi');
  check(kpis.length === 5, `плиток: ${kpis.length} (ожидалось 5)`);
  check(!$('#content').innerHTML.includes('Не удалось загрузить данные'), 'данные загрузились, а не упали в ошибку');

  console.log('\nПереключатель баз:');
  const baseButtons = $$('#base-switch button');
  check(baseButtons.length === (data.bases || []).length, `кнопок: ${baseButtons.length} (баз: ${(data.bases || []).length})`);
  check(!!$('#subtitle').textContent.trim(), 'подпись с датой снимка заполнена');

  console.log('\nТаблица сравнения:');
  const compareRows = $$('#compare-table tbody tr');
  const expectedDomains = Object.keys(data.domains[data.bases[0]]).length;
  check(compareRows.length === expectedDomains, `строк: ${compareRows.length} (доменов: ${expectedDomains})`);
  const siteRow = $('#compare-table tbody tr.is-site');
  check(!!siteRow, 'строка сайта выделена');
  check(!!siteRow && siteRow.textContent.includes(data.site), `в выделенной строке — ${data.site}`);
  const siteValues = siteRow ? Array.from(siteRow.querySelectorAll('td')).slice(1).map((td) => td.textContent.trim()) : [];
  check(siteValues.filter((v) => v && v !== '—').length >= 8, `заполненных метрик в строке сайта: ${siteValues.filter((v) => v && v !== '—').length}`);

  console.log('\nТаблица запросов:');
  const kwRows = $$('#kw-table tbody tr');
  check(kwRows.length > 0, `строк: ${kwRows.length}`);
  const headCols = $$('#kw-head-row th');
  const expectedCols = 5 + Math.max(0, expectedDomains - 1);
  check(headCols.length === expectedCols, `колонок: ${headCols.length} (ожидалось ${expectedCols})`);
  check(headCols.some((th) => th.textContent.includes(data.site)), 'есть колонка позиций сайта');
  const anyPos = $$('#kw-table tbody .pos-badge').length;
  check(anyPos > 0, `бейджей позиций: ${anyPos}`);

  console.log('\nСортировка:');
  const kwHeader = $('#kw-head-row th[data-key="wsk"]');
  if (kwHeader) {
    kwHeader.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flush();
    const asc = $$('#kw-table tbody tr').map((tr) => Number(tr.querySelectorAll('td')[1].textContent.replace(/\s/g, '')));
    const sorted = asc.every((v, i) => i === 0 || asc[i - 1] <= v);
    check(sorted, 'сортировка по частотности по возрастанию работает');
    kwHeader.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flush();
  } else {
    check(false, 'заголовок частотности не найден');
  }

  console.log('\nПоиск по запросам:');
  const search = $('#kw-search');
  search.value = 'zzz-нет-такого-запроса';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await flush();
  check($$('#kw-table tbody tr').length === 0, 'фильтр без совпадений даёт пустую таблицу');
  search.value = '';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await flush();
  check($$('#kw-table tbody tr').length > 0, 'после сброса фильтра строки вернулись');

  console.log('\nГрафики:');
  const ids = chartCalls.map((c) => c.id).sort();
  const expectedCharts = ['chart-depth', 'chart-pages', 'chart-trend', 'chart-traffic'].sort();
  const sameSet = ids.length === expectedCharts.length && ids.every((id, i) => id === expectedCharts[i]);
  check(sameSet, `созданы графики: ${ids.join(', ')}`);
  check(chartCalls.every((c) => c.stackable), 'во всех графиках данные — массивы значений');
  const trend = chartCalls.find((c) => c.id === 'chart-trend');
  check(!!trend && trend.datasets === expectedDomains, `линий в графике видимости: ${trend ? trend.datasets : 0}`);
  check(!!trend && trend.labels > 0, `точек по месяцам: ${trend ? trend.labels : 0}`);

  console.log('\nПереключение на вторую базу:');
  if (baseButtons.length > 1) {
    baseButtons[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flush();
    const trend2 = chartCalls.filter((c) => c.id === 'chart-trend').pop();
    const compare2 = $$('#compare-table tbody tr').length;
    check(compare2 === expectedDomains, `после переключения строк в таблице: ${compare2}`);
    check(!!trend2 && trend2.datasets === expectedDomains, 'график перерисован для второй базы');
    const secondBase = data.bases[1];
    const v1 = data.domains[data.bases[0]][data.site].summary.vis;
    const v2 = data.domains[secondBase][data.site].summary.vis;
    check(v1 !== v2, `данные баз различаются (${v1} vs ${v2})`);
  }

  console.log('\nПодвал:');
  check($('#footer-source').textContent.includes('Keys.so'), 'указан источник данных');
  if ((data.errors || []).length) {
    check($('#footer-errors').textContent.includes('не удалось'), 'предупреждения о неполных отчётах показаны');
  } else {
    check(true, 'ошибок сбора нет');
  }

  console.log('');
  if (problems.length) {
    console.log(`ПРОВАЛЕНО проверок: ${problems.length}`);
    problems.forEach((p) => console.log('  - ' + p));
    process.exit(1);
  }
  console.log('ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ: дашборд отрисовывается на демо-данных.');
})();
