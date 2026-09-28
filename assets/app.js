/* ==========================================================================
   SEO-дашборд — логика отрисовки.
   Данные берутся из data/latest.json (файл обновляется по расписанию).
   ========================================================================== */

'use strict';

const DATA_URL = 'data/latest.json';

const PALETTE = [
  '#1f5fd6', // сайт
  '#e08a1e',
  '#12906b',
  '#a154d0',
  '#c9342b',
  '#0f8fb5',
  '#7a8b1f',
  '#d1527a',
];

const POS_LABELS = [
  { key: 'it1', label: 'Топ-1' },
  { key: 'it3', label: 'Топ-3' },
  { key: 'it5', label: 'Топ-5' },
  { key: 'it10', label: 'Топ-10' },
  { key: 'it50', label: 'Топ-50' },
];

const BASE_LABELS = {
  msk: 'Яндекс · Москва',
  gru: 'Google · Москва',
  spb: 'Яндекс · СПб',
  ekb: 'Яндекс · Екатеринбург',
  nsk: 'Яндекс · Новосибирск',
  kzn: 'Яндекс · Казань',
  gkv: 'Google · Киев',
  gny: 'Google · Нью-Йорк',
  zen: 'Дзен',
};

const state = {
  store: null,
  base: null,
  keywordSort: { key: 'wsk', dir: 'desc' },
  keywordFilter: '',
  charts: {},
};

const charts = state.charts;

/* ----------------------------- утилиты ---------------------------------- */

function fmt(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Math.round(value).toLocaleString('ru-RU').replace(/,/g, ' ');
}

function fmtMoney(value) {
  if (!value) return '—';
  if (value >= 1e9) return (value / 1e9).toFixed(1).replace('.', ',') + ' млрд ₽';
  if (value >= 1e6) return (value / 1e6).toFixed(1).replace('.', ',') + ' млн ₽';
  if (value >= 1e3) return Math.round(value / 1e3) + ' тыс. ₽';
  return fmt(value) + ' ₽';
}

function fmtPeriod(period) {
  // "2026.03" -> "мар 26"
  const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const parts = String(period).split('.');
  if (parts.length !== 2) return period;
  const [year, month] = parts;
  const idx = parseInt(month, 10) - 1;
  return (names[idx] || month) + ' ' + year.slice(2);
}

function deltaHtml(delta, suffix) {
  if (delta === null || delta === undefined) {
    return '<span class="delta flat">нет сравнения</span>';
  }
  const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const sign = delta > 0 ? '+' : '';
  const text = sign + fmt(delta) + (suffix || '');
  return `<span class="delta ${cls}">${text}</span>`;
}

function esc(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function baseLabel(code) {
  return BASE_LABELS[code] || code.toUpperCase();
}

/* --------------------------- подготовка данных -------------------------- */

function domainsFor(base) {
  return (state.store.domains && state.store.domains[base]) || {};
}

function domainList(base) {
  const map = domainsFor(base);
  const site = state.store.site;
  const others = Object.keys(map)
    .filter((d) => d !== site)
    .sort((a, b) => value(b, 'vis') - value(a, 'vis'));
  return [site].filter((d) => map[d]).concat(others);
}

function value(domain, key, base) {
  const map = domainsFor(base || state.base);
  const entry = map[domain];
  if (!entry || !entry.summary) return 0;
  return Number(entry.summary[key]) || 0;
}

function summaryOf(domain, base) {
  const map = domainsFor(base || state.base);
  return (map[domain] || {}).summary || null;
}

function historyOf(domain, base) {
  const map = domainsFor(base || state.base);
  return (map[domain] || {}).history || [];
}

function colorFor(domain, base) {
  const list = domainList(base || state.base);
  const idx = list.indexOf(domain);
  return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
}

function emptyHistoryRow(period) {
  return { period: period, it1: 0, it3: 0, it5: 0, it10: 0, it50: 0, vis: 0, ads: 0, pages: 0 };
}

/** Сводит истории всех доменов в общий набор периодов. */
function historyGrid(base, metric) {
  const domains = domainList(base);
  const periods = [];
  const seen = new Set();
  domains.forEach((domain) => {
    historyOf(domain, base).forEach((point) => {
      if (!seen.has(point.period)) { seen.add(point.period); periods.push(point.period); }
    });
  });
  periods.sort();

  const byDomain = {};
  domains.forEach((domain) => {
    const map = {};
    historyOf(domain, base).forEach((point) => { map[point.period] = point; });
    byDomain[domain] = periods.map((p) => {
      const point = map[p] || emptyHistoryRow(p);
      return Number(point[metric]) || 0;
    });
  });

  return { periods, byDomain, domains };
}

/* ------------------------------- KPI ------------------------------------ */

function renderKpis() {
  const grid = document.getElementById('kpi-grid');
  const site = state.store.site;
  const summary = summaryOf(site) || {};
  const previous = state.store.previous_at_msk;
  const delta = summary.delta || null;

  const cards = [
    {
      label: 'Видимость',
      value: fmt(summary.vis),
      delta: delta ? delta.vis : undefined,
      note: 'сумма частотностей по запросам в выдаче',
    },
    {
      label: 'Запросов в топ-10',
      value: fmt(summary.it10),
      delta: delta ? delta.it10 : undefined,
      note: `топ-3: ${fmt(summary.it3)} · топ-50: ${fmt(summary.it50)}`,
    },
    {
      label: 'Поисковый трафик',
      value: fmt(summary.topvis || summary.adtraf),
      delta: delta ? delta.topvis : undefined,
      note: `${fmt(summary.topkeys)} запросов приносят трафик`,
    },
    {
      label: 'Страниц в индексе',
      value: fmt(summary.pagesinindex),
      delta: delta ? delta.pagesinindex : undefined,
      note: `рекламный трафик: ${fmt(summary.adtraf)}`,
    },
    {
      label: 'Рекламный бюджет в поиске',
      value: fmtMoney(summary.adcost),
      note: summary.adscnt ? `${fmt(summary.adscnt)} объявлений · максимум ${fmtMoney(summary.adcost_max)}` : '',
    },
    {
      label: 'Число страниц в выдаче',
      value: fmt(Object.keys(domainList(state.base)).length),
      note: 'домены в отчёте',
    },
  ];

  grid.innerHTML = cards.slice(0, 5).map((card, idx) => `
    <div class="kpi ${idx === 0 ? 'is-site' : ''}">
      <div class="kpi-label">${esc(card.label)}</div>
      <div class="kpi-value">${card.value}</div>
      <div class="kpi-foot">
        ${card.delta !== undefined ? deltaHtml(card.delta) : ''}
        <span>${esc(card.note || '')}</span>
      </div>
    </div>
  `).join('');

  const subtitle = document.getElementById('subtitle');
  subtitle.innerHTML =
    `<strong>${esc(site)}</strong> · ${esc(baseLabel(state.base))} · ` +
    `данные на ${esc(state.store.generated_at_msk || state.store.generated_at)}` +
    (state.store.previous_at_msk ? ` · сравнение с ${esc(state.store.previous_at_msk)}` : '') +
    (state.store.demo ? '<span class="demo-badge">ДЕМО-ДАННЫЕ</span>' : '');
}

/* ------------------------------ графики --------------------------------- */

function chartDefaults() {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#6b7a8d';
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.padding = 14;
}

function killChart(name) {
  if (charts[name]) { charts[name].destroy(); delete charts[name]; }
}

const tooltipNumbers = {
  callbacks: {
    label(ctx) {
      const label = ctx.dataset.label ? ctx.dataset.label + ': ' : '';
      return label + fmt(ctx.parsed.y !== undefined ? ctx.parsed.y : ctx.parsed);
    },
  },
};

function renderTrendChart() {
  killChart('trend');
  const grid = historyGrid(state.base, 'vis');
  const isSite = (domain) => domain === state.store.site;

  charts.trend = new Chart(document.getElementById('chart-trend'), {
    type: 'line',
    data: {
      labels: grid.periods.map(fmtPeriod),
      datasets: grid.domains.map((domain, idx) => ({
        label: domain,
        data: grid.byDomain[domain],
        borderColor: colorFor(domain),
        backgroundColor: colorFor(domain),
        borderWidth: isSite(domain) ? 3 : 1.8,
        tension: 0.28,
        pointRadius: 0,
        pointHoverRadius: 5,
        order: isSite(domain) ? 1 : 2,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom' }, tooltip: tooltipNumbers },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: false,
          grid: { color: '#eef1f6' },
          ticks: { callback: (v) => fmt(v) },
        },
      },
    },
  });

  const hint = document.getElementById('trend-hint');
  if (hint) {
    hint.textContent = grid.periods.length
      ? `${grid.periods.length} мес. · ${grid.domains.length} домена(ов)`
      : 'история недоступна';
  }
}

function renderDepthChart() {
  killChart('depth');
  const domains = domainList(state.base);
  const byPos = POS_LABELS.map((pos) => ({
    label: pos.label,
    data: domains.map((domain) => value(domain, pos.key)),
  }));

  charts.depth = new Chart(document.getElementById('chart-depth'), {
    type: 'bar',
    data: {
      labels: domains,
      datasets: [
        POS_LABELS[4], POS_LABELS[3], POS_LABELS[2], POS_LABELS[1], POS_LABELS[0],
      ].map((pos, idx) => {
        const order = [4, 3, 2, 1, 0][idx];
        const shades = ['#c9d8f2', '#a8c1ec', '#7ba2e3', '#4b81d9', '#1f5fd6'];
        return {
          label: pos.label,
          data: domains.map((domain) => value(domain, pos.key)),
          backgroundColor: shades[idx],
          borderRadius: 3,
          borderSkipped: false,
        };
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label(ctx) {
              const total = byPos[4].data[ctx.dataIndex] || 1;
              const share = ((ctx.parsed.y / total) * 100).toFixed(0);
              return `${ctx.dataset.label}: ${fmt(ctx.parsed.y)} (${share}% от топ-50)`;
            },
          },
        },
      },
      scales: {
        x: { stacked: false, grid: { display: false } },
        y: { beginAtZero: true, grid: { color: '#eef1f6' }, ticks: { callback: (v) => fmt(v) } },
      },
    },
  });
}

function renderTrafficChart() {
  killChart('traffic');
  const grid = historyGrid(state.base, 'ads');
  const domains = grid.domains;
  const site = state.store.site;

  const datasets = domains.map((domain) => ({
    label: domain,
    data: grid.byDomain[domain],
    borderColor: colorFor(domain),
    backgroundColor: 'transparent',
    borderWidth: domain === site ? 3 : 1.8,
    tension: 0.28,
    pointRadius: 0,
    pointHoverRadius: 5,
  }));

  if (domainList(state.base).includes(site)) {
    const range = historyGrid(state.base, 'it50');
    datasets.push({
      label: 'Запросов в топ-50 (правая ось)',
      data: range.byDomain[site],
      borderColor: '#b9c4d4',
      backgroundColor: 'transparent',
      borderDash: [5, 4],
      borderWidth: 1.6,
      tension: 0.28,
      pointRadius: 0,
      yAxisID: 'y2',
    });
  }

  charts.traffic = new Chart(document.getElementById('chart-traffic'), {
    type: 'line',
    data: { labels: grid.periods.map(fmtPeriod), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom' }, tooltip: tooltipNumbers },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: false, grid: { color: '#eef1f6' }, ticks: { callback: (v) => fmt(v) } },
        y2: {
          position: 'right',
          beginAtZero: false,
          grid: { display: false },
          ticks: { callback: (v) => fmt(v) },
        },
      },
    },
  });
}

function renderPagesChart() {
  killChart('pages');
  const grid = historyGrid(state.base, 'pages');
  const site = state.store.site;

  charts.pages = new Chart(document.getElementById('chart-pages'), {
    type: 'line',
    data: {
      labels: grid.periods.map(fmtPeriod),
      datasets: grid.domains.map((domain) => ({
        label: domain,
        data: grid.byDomain[domain],
        borderColor: colorFor(domain),
        backgroundColor: 'rgba(31, 95, 214, .06)',
        fill: domain === site,
        borderWidth: domain === site ? 3 : 1.8,
        tension: 0.28,
        pointRadius: 0,
        pointHoverRadius: 5,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom' }, tooltip: tooltipNumbers },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: false, grid: { color: '#eef1f6' }, ticks: { callback: (v) => fmt(v) } },
      },
    },
  });
}

/* ------------------------------ таблицы --------------------------------- */

function renderCompareTable() {
  const tbody = document.querySelector('#compare-table tbody');
  const site = state.store.site;
  const domains = domainList(state.base);

  tbody.innerHTML = domains.map((domain) => {
    const s = summaryOf(domain) || {};
    const delta = s.delta || null;
    return `
      <tr class="${domain === site ? 'is-site' : ''}">
        <td>
          <span class="domain-cell">
            <span class="domain-dot" style="background:${colorFor(domain)}"></span>
            ${esc(domain)}${domain === site ? ' <span class="pill">сайт</span>' : ''}
          </span>
        </td>
        <td class="num">${fmt(s.vis)}</td>
        <td class="num">${deltaHtml(delta ? delta.vis : null)}</td>
        <td class="num">${fmt(s.topvis)}</td>
        <td class="num">${fmt(s.it3)}</td>
        <td class="num">${fmt(s.it10)}</td>
        <td class="num">${fmt(s.it50)}</td>
        <td class="num">${fmt(s.topkeys)}</td>
        <td class="num">${fmt(s.pagesinindex)}</td>
        <td class="num">${fmtMoney(s.adcost)}</td>
      </tr>
    `;
  }).join('');
}

function renderKeywordTable() {
  const headRow = document.getElementById('kw-head-row');
  const tbody = document.querySelector('#kw-table tbody');
  const site = state.store.site;
  const domains = domainList(state.base);

  const columns = [
    { key: 'word', label: 'Запрос', sortable: true, type: 'text' },
    { key: 'wsk', label: 'Частотность', sortable: true, type: 'num' },
    { key: 'ws', label: 'Wordstat', sortable: true, type: 'num' },
    { key: `pos:${site}`, label: `${site} — позиция`, sortable: true, type: 'num' },
    { key: `delta:${site}`, label: 'Δ', sortable: true, type: 'num' },
  ];

  domains.filter((d) => d !== site).forEach((domain) => {
    columns.push({ key: `pos:${domain}`, label: domain, sortable: true, type: 'num' });
  });

  headRow.innerHTML = columns.map((col) => {
    const active = state.keywordSort.key === col.key;
    const cls = ['sortable', col.type === 'num' ? 'num' : '', active ? `sorted-${state.keywordSort.dir}` : '']
      .filter(Boolean).join(' ');
    return `<th class="${cls}" data-key="${esc(col.key)}">${esc(col.label)}</th>`;
  }).join('');

  headRow.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (state.keywordSort.key === key) {
        state.keywordSort.dir = state.keywordSort.dir === 'desc' ? 'asc' : 'desc';
      } else {
        state.keywordSort = { key: key, dir: key === 'word' ? 'asc' : 'desc' };
      }
      renderKeywordTable();
    });
  });

  let rows = (state.store.keywords_recent || []).slice();
  const filter = state.keywordFilter.trim().toLowerCase();
  if (filter) {
    rows = rows.filter((row) => String(row.word).toLowerCase().includes(filter));
  }

  const { key, dir } = state.keywordSort;
  const sign = dir === 'desc' ? -1 : 1;

  rows.sort((a, b) => {
    const pick = (row) => {
      if (key === 'word') return row.word || '';
      if (key === 'wsk') return row.wsk || 0;
      if (key === 'ws') return row.ws || 0;
      const [field, domain] = key.split(':');
      const cell = (row.pos || {})[domain];
      if (!cell) return -1;
      const pos = Number(cell.pos) || 0;
      if (field === 'delta') return Number(cell.delta) || 0;
      return pos === 0 ? 999 : pos; // без позиции — в конец
    };
    const av = pick(a);
    const bv = pick(b);
    if (typeof av === 'string') return av.localeCompare(bv, 'ru') * sign;
    return (av - bv) * sign;
  });

  tbody.innerHTML = rows.map((row) => {
    const siteCell = (row.pos || {})[site];
    const posCell = (cell) => {
      if (!cell || !cell.pos) return '<span class="pos-none">—</span>';
      const p = Number(cell.pos);
      const cls = p === 1 ? 'pos-1' : p <= 3 ? 'pos-2' : p <= 5 ? 'pos-3' : p <= 10 ? 'pos-mid' : 'pos-low';
      const title = cell.url ? ` title="${esc(cell.url)}"` : '';
      return `<span class="pos-badge ${cls}"${title}>${p}</span>`;
    };

    const deltaCell = siteCell && siteCell.delta
      ? `<span class="delta ${siteCell.delta > 0 ? 'up' : siteCell.delta < 0 ? 'down' : 'flat'}">${siteCell.delta > 0 ? '+' : ''}${siteCell.delta}</span>`
      : '<span class="pos-none">—</span>';

    const serp = (word) => 'https://yandex.ru/search/?text=' + encodeURIComponent(word);

    return `
      <tr>
        <td class="word-cell"><a class="serp-link" target="_blank" rel="noopener" href="${esc(serp(row.word))}">${esc(row.word)}</a></td>
        <td class="num">${fmt(row.wsk)}</td>
        <td class="num">${fmt(row.ws)}</td>
        <td class="num">${posCell(siteCell)}</td>
        <td class="num">${deltaCell}</td>
        ${domains.filter((d) => d !== site).map((d) => `<td class="num">${posCell((row.pos || {})[d])}</td>`).join('')}
      </tr>
    `;
  }).join('');

  document.getElementById('kw-count').textContent =
    `${rows.length} из ${(state.store.keywords_recent || []).length} запросов`;
}

/* ------------------------------- сборка --------------------------------- */

function renderAll() {
  renderKpis();
  renderCompareTable();
  renderKeywordTable();
  renderTrendChart();
  renderDepthChart();
  renderTrafficChart();
  renderPagesChart();

  const footer = document.getElementById('footer-source');
  footer.textContent =
    `Источник: Keys.so · снимок ${state.store.generated_at_msk || state.store.generated_at} · ` +
    `автообновление раз в 3 часа`;

  const errBox = document.getElementById('footer-errors');
  const errors = state.store.errors || [];
  errBox.textContent = errors.length
    ? `⚠ не удалось собрать ${errors.length} отчёт(ов) — часть блоков может быть пустой`
    : '';
  errBox.title = errors.slice(0, 12).join('\n');
}

function renderBaseSwitch() {
  const wrap = document.getElementById('base-switch');
  const bases = state.store.bases || ['msk'];
  wrap.innerHTML = bases.map((base) => `
    <button type="button" role="tab" data-base="${esc(base)}"
      aria-selected="${base === state.base}">${esc(baseLabel(base))}</button>
  `).join('');
  wrap.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.base === btn.dataset.base) return;
      state.base = btn.dataset.base;
      renderBaseSwitch();
      renderAll();
    });
  });
}

function showError(message) {
  document.getElementById('content').innerHTML =
    `<div class="error-box"><strong>Не удалось загрузить данные.</strong><br>${esc(message)}<br><br>
     Проверьте, что файл <code>data/latest.json</code> существует и что страница открыта
     через сервер (GitHub Pages), а не как локальный файл.</div>`;
  document.getElementById('overlay').hidden = true;
}

async function boot() {
  try {
    const resp = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' при чтении ' + DATA_URL);
    const store = await resp.json();
    if (!store || !store.domains) throw new Error('в файле данных нет раздела domains');

    state.store = store;
    state.base = (store.bases && store.bases[0]) || Object.keys(store.domains)[0];

    chartDefaults();
    renderBaseSwitch();
    renderAll();
    document.getElementById('overlay').hidden = true;
  } catch (err) {
    showError(err.message);
  }
}

document.getElementById('refresh-btn').addEventListener('click', () => {
  document.getElementById('overlay').hidden = false;
  boot();
});

document.getElementById('kw-search').addEventListener('input', (event) => {
  state.keywordFilter = event.target.value;
  if (state.store) renderKeywordTable();
});

document.addEventListener('DOMContentLoaded', boot);
