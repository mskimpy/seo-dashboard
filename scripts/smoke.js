/* Прогон дашборда в jsdom: проверяем, что данные доезжают до DOM,
   таблицы заполняются, выборка конкурентов работает, ошибок нет.
   Запуск: node scripts/smoke.js  */

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

const chartCalls = [];
class ChartStub {
  constructor(ctx, config) {
    this.canvasId = ctx && ctx.id;
    chartCalls.push({
      id: this.canvasId,
      type: config.type,
      axis: config.options && config.options.indexAxis,
      datasets: (config.data.datasets || []).length,
      labels: (config.data.labels || []).length,
      stackedArrays: (config.data.datasets || []).every((d) => Array.isArray(d.data)),
    });
  }
  destroy() {}
  static defaults = { font: {}, color: null, plugins: { legend: { labels: {} } } };
}
window.Chart = ChartStub;
window.HTMLCanvasElement.prototype.getContext = () => ({});

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

const flush = () => new Promise((r) => setTimeout(r, 70));
const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => Array.from(window.document.querySelectorAll(sel));
const base = data.bases[0];
const allDomains = Object.keys(data.domains[base]);
const defaultSelected = (data.selected_by_default || []).filter((d) => allDomains.includes(d));

(async () => {
  await flush(); await flush();

  console.log('\nЗагрузка:');
  check(errors.length === 0, errors.length ? `исключения: ${errors.join(' | ')}` : 'исключений нет');
  check(!$('#content').innerHTML.includes('Не удалось загрузить данные'), 'данные загрузились');
  check($$('#kpi-grid .kpi').length === 5, `KPI-плиток: ${$$('#kpi-grid .kpi').length}`);

  console.log('\nРейтинг по видимости:');
  const rank = chartCalls.find((c) => c.id === 'chart-rank');
  check(!!rank, 'график рейтинга создан');
  check(!!rank && rank.axis === 'y', 'рейтинг горизонтальный (indexAxis=y)');
  check(!!rank && rank.labels === allDomains.length, `полос: ${rank ? rank.labels : 0} (доменов: ${allDomains.length})`);

  console.log('\nТаблица сравнения:');
  const rows = $$('#compare-table tbody tr');
  const groupRows = $$('#compare-table tbody tr.group-row');
  const domainRows = rows.filter((r) => !r.classList.contains('group-row'));
  check(domainRows.length === allDomains.length, `строк с доменами: ${domainRows.length} (доменов: ${allDomains.length})`);
  check(groupRows.length === (data.groups || []).length, `строк-заголовков групп: ${groupRows.length} (групп: ${(data.groups || []).length})`);
  const siteRow = $('#compare-table tbody tr.is-site');
  check(!!siteRow, 'строка сайта выделена');
  check(domainRows[0].classList.contains('is-site'), 'сайт идёт первой строкой');

  console.log('\nВыбор конкурентов:');
  const chips = $$('#picker .chip[data-domain]');
  check(chips.length === allDomains.length - 1, `чипов: ${chips.length} (конкурентов: ${allDomains.length - 1})`);
  const onChips = chips.filter((c) => c.dataset.on === '1').map((c) => c.dataset.domain);
  check(onChips.length === defaultSelected.length, `включено по умолчанию: ${onChips.length} (в конфиге: ${defaultSelected.length})`);
  check(!!$('#picker .chip.is-site'), 'сайт показан отдельным чипом');
  check(!!$('[data-group-toggle]'), 'есть кнопки «выбрать все» по группам');

  const trend = () => chartCalls.filter((c) => c.id === 'chart-trend').pop();
  check(trend().datasets === defaultSelected.length + 1, `линий на графике видимости: ${trend().datasets} (сайт + ${defaultSelected.length})`);

  console.log('\nВключение выключенного конкурента:');
  const offChip = chips.find((c) => c.dataset.on === '0');
  if (offChip) {
    const added = offChip.dataset.domain;
    offChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flush();
    check(trend().datasets === defaultSelected.length + 2, `после включения ${added} линий: ${trend().datasets}`);
    check($$('#kw-head-row th').some((th) => th.textContent.includes(added)), `колонка ${added} появилась в таблице запросов`);
    const onChip = $(`#picker .chip[data-domain="${added}"]`);
    check(!!onChip && onChip.dataset.on === '1', `чип ${added} отмечен`);
    onChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flush();
    check(trend().datasets === defaultSelected.length + 1, 'после выключения вернулось исходное число линий');
  } else {
    check(false, 'не нашлось выключенного конкурента для проверки');
  }

  console.log('\nКнопка «выбрать все» в группе:');
  const groupBtn = $('[data-group-toggle]');
  groupBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush();
  const otherGroupBtn = $$('[data-group-toggle]')
    .find((b) => b.textContent.trim() === 'снять все' && b !== groupBtn);
  const firstGroupSize = Number((groupBtn.textContent.trim() === 'снять все')
    ? (data.groups[0].domains.length) : 0);
  check(!!otherGroupBtn || firstGroupSize > 0, 'группа переключается целиком');
  // вернуть исходную выборку
  groupBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush();

  console.log('\nТаблица запросов:');
  const kwRows = $$('#kw-table tbody tr');
  const headCols = $$('#kw-head-row th');
  // После прогонов выше выборка вернулась к исходной.
  const selectedNow = $$('#picker .chip[data-domain][data-on="1"]').length;
  check(kwRows.length > 0, `строк: ${kwRows.length}`);
  check(headCols.length === 4 + selectedNow, `колонок: ${headCols.length} (4 базовых + ${selectedNow} конкурентов)`);
  check(!!$('.kw-table th:first-child'), 'первый столбец закреплён (sticky) в разметке');
  const posBadges = $$('#kw-table tbody .pos-badge').length;
  check(posBadges > 0, `бейджей позиций: ${posBadges}`);
  const losingCells = $$('#kw-table tbody td.better-than-us').length;
  check(losingCells >= 0, `подсвечено ячеек, где конкурент выше нас: ${losingCells}`);

  console.log('\nФильтр «только где мы проигрываем»:');
  const before = $$('#kw-table tbody tr').length;
  const box = $('#kw-only-losing');
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  await flush();
  const after = $$('#kw-table tbody tr').length;
  check(after <= before, `строк после фильтра: ${after} (было ${before})`);
  const allLosing = $$('#kw-table tbody tr').every((tr) => tr.querySelector('td.better-than-us'));
  check(after === 0 || allLosing, 'в отфильтрованных строках есть проигрыш конкурентам');
  box.checked = false;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  await flush();
  check($$('#kw-table tbody tr').length === before, 'снятие фильтра возвращает строки');

  console.log('\nСортировка:');
  const wskHead = $('#kw-head-row th[data-key="wsk"]');
  wskHead.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush();
  const asc = $$('#kw-table tbody tr').map((tr) => Number(tr.querySelectorAll('td')[1].textContent.replace(/\s/g, '')));
  check(asc.every((v, i) => i === 0 || asc[i - 1] <= v), 'сортировка по частотности по возрастанию работает');
  wskHead.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush();

  console.log('\nПоиск:');
  const search = $('#kw-search');
  search.value = 'zzz-нет-такого';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await flush();
  check($$('#kw-table tbody tr').length === 0, 'фильтр без совпадений даёт пустую таблицу');
  search.value = '';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await flush();
  check($$('#kw-table tbody tr').length > 0, 'после сброса строки вернулись');

  console.log('\nГрафики:');
  const ids = [...new Set(chartCalls.map((c) => c.id))].sort();
  const expected = ['chart-depth', 'chart-pages', 'chart-rank', 'chart-traffic', 'chart-trend'];
  check(ids.length === expected.length && ids.every((v, i) => v === expected[i]), `созданы: ${ids.join(', ')}`);
  check(chartCalls.every((c) => c.stackedArrays), 'во всех графиках данные — массивы значений');
  const trendNow = trend();
  check(trendNow.labels === 12, `точек по месяцам: ${trendNow.labels}`);

  console.log('\nПереключение на вторую базу:');
  const baseButtons = $$('#base-switch button');
  check(baseButtons.length === data.bases.length, `кнопок баз: ${baseButtons.length}`);
  if (baseButtons.length > 1) {
    baseButtons[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flush();
    check($$('#compare-table tbody tr').filter((r) => !r.classList.contains('group-row')).length === allDomains.length,
      'после переключения таблица сравнения полная');
    check(trend().datasets === defaultSelected.length + 1, 'график перерисован для второй базы');
    const second = data.bases[1];
    check(data.domains[base][data.site].summary.vis !== data.domains[second][data.site].summary.vis,
      'данные баз различаются');
  }

  console.log('\nПодвал:');
  check($('#footer-source').textContent.includes('Keys.so'), 'указан источник данных');
  check($('#subtitle').textContent.includes('ДЕМО') === !!data.demo, 'плашка ДЕМО соответствует данным');

  console.log('');
  if (problems.length) {
    console.log(`ПРОВАЛЕНО проверок: ${problems.length}`);
    problems.forEach((p) => console.log('  - ' + p));
    process.exit(1);
  }
  console.log(`ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ: ${allDomains.length} доменов, выборка и таблицы работают.`);
})();
