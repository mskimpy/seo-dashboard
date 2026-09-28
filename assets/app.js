/* ==========================================================================
   SEO-дашборд — логика отрисовки.
   Данные берутся из data/latest.json (файл обновляется по расписанию).
   ========================================================================== */

'use strict';

const DATA_URL = 'data/latest.json';

/* Цвета по группам: внутри группы домены различаются оттенком. */
const GROUP_STYLE = {
  site:         { base: '#1f5fd6', tints: ['#1f5fd6'] },
  marketplaces: { base: '#e08a1e', tints: ['#e08a1e', '#eb9f43', '#d97a0c', '#f0b26b'] },
  close:        { base: '#12906b', tints: ['#12906b', '#37a583', '#0c7a5a'] },
  niche:        { base: '#8a5cd6', tints: ['#8a5cd6', '#9d75dd', '#7550bd', '#ad8ce3', '#6a45ac', '#bda0ea', '#5c3b99', '#cbb4f0', '#4f3187', '#d9c8f5', '#422975', '#e6dcf8'] },
};

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

const POS_LABELS = [
  { key: 'it1', label: 'Топ-1' },
  { key: 'it3', label: 'Топ-3' },
  { key: 'it5', label: 'Топ-5' },
  { key: 'it10', label: 'Топ-10' },
  { key: 'it50', label: 'Топ-50' },
];

const state = {
  store: null,
  base: null,
  selected: new Set(),      // домены-конкуренты, показанные на графиках и в таблице запросов
  keywordSort: { key: 'wsk', dir: 'desc' },
  keywordFilter: '',
  onlyLosing: false,
};

const charts = {};

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
  const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const parts = String(period).split('.');
  if (parts.length !== 2) return period;
  const idx = parseInt(parts[1], 10) - 1;
  return (names[idx] || parts[1]) + ' ' + parts[0].slice(2);
}

function deltaHtml(delta, suffix) {
  if (delta === null || delta === undefined) return '<span class="delta flat">нет сравнения</span>';
  const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  return `<span class="delta ${cls}">${delta > 0 ? '+' : ''}${fmt(delta)}${suffix || ''}</span>`;
}

function esc(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function baseLabel(code) { return BASE_LABELS[code] || code.toUpperCase(); }

/* --------------------------- работа с данными --------------------------- */

function domainsFor(base) {
  return (state.store.domains && state.store.domains[base || state.base]) || {};
}

function entryOf(domain, base) { return domainsFor(base)[domain] || {}; }
function summaryOf(domain, base) { return entryOf(domain, base).summary || null; }
function historyOf(domain, base) { return entryOf(domain, base).history || []; }

function metric(domain, key, base) {
  const summary = summaryOf(domain, base);
  return summary ? Number(summary[key]) || 0 : 0;
}

function allDomains(base) {
  return Object.keys(domainsFor(base));
}

/** Домены, отобранные для графиков: сайт + отмеченные конкуренты, по убыванию видимости. */
function chosenDomains(base) {
  const b = base || state.base;
  const site = state.store.site;
  const competitors = allDomains(b)
    .filter((d) => d !== site && state.selected.has(d))
    .sort((a, c) => metric(c, 'vis', b) - metric(a, 'vis', b));
  return [site].filter((d) => domainsFor(b)[d]).concat(competitors);
}

/** Группа домена: 'site' | id группы конкурентов. */
function groupOf(domain) {
  if (domain === state.store.site) return 'site';
  for (const group of state.store.groups || []) {
    if ((group.domains || []).includes(domain)) return group.id;
  }
  return 'niche';
}

function colorFor(domain, base) {
  if (domain === state.store.site) return GROUP_STYLE.site.base;
  const group = groupOf(domain);
  const style = GROUP_STYLE[group] || GROUP_STYLE.niche;
  const siblings = allDomains(base).filter((d) => groupOf(d) === group);
  const idx = siblings.indexOf(domain);
  return style.tints[(idx < 0 ? 0 : idx) % style.tints.length];
}

function emptyHistoryRow(period) {
  return { period, it1: 0, it3: 0, it5: 0, it10: 0, it50: 0, vis: 0, ads: 0, pages: 0 };
}

/** Сводит истории выбранных доменов в общий набор месяцев. */
function historyGrid(metricKey, base, domains) {
  const list = domains || chosenDomains(base);
  const periods = [];
  const seen = new Set();
  list.forEach((domain) => {
    historyOf(domain, base).forEach((point) => {
      if (!seen.has(point.period)) { seen.add(point.period); periods.push(point.period); }
    });
  });
  periods.sort();

  const byDomain = {};
  list.forEach((domain) => {
    const map = {};
    historyOf(domain, base).forEach((point) => { map[point.period] = point; });
    byDomain[domain] = periods.map((p) => Number((map[p] || emptyHistoryRow(p))[metricKey]) || 0);
  });

  return { periods, byDomain, domains: list };
}

/* ------------------------------- KPI ------------------------------------ */

function renderKpis() {
  const site = state.store.site;
  const summary = summaryOf(site) || {};
  const delta = summary.delta || null;

  const ranked = allDomains(state.base).sort((a, b) => metric(b, 'vis') - metric(a, 'vis'));
  const place = ranked.indexOf(site) + 1;

  const cards = [
    {
      label: 'Видимость',
      value: fmt(summary.vis),
      delta: delta ? delta.vis : undefined,
      note: `${place}-е место из ${ranked.length} доменов`,
      cls: 'is-site',
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
      note: summary.adscnt ? `${fmt(summary.adscnt)} объявлений` : 'кампаний не найдено',
    },
  ];

  document.getElementById('kpi-grid').innerHTML = cards.map((card) => `
    <div class="kpi ${card.cls || ''}">
      <div class="kpi-label">${esc(card.label)}</div>
      <div class="kpi-value">${card.value}</div>
      <div class="kpi-foot">
        ${card.delta !== undefined ? deltaHtml(card.delta) : ''}
        <span>${esc(card.note || '')}</span>
      </div>
    </div>
  `).join('');

  document.getElementById('subtitle').innerHTML =
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
  Chart.defaults.plugins.legend.labels.padding = 12;
}

function killChart(name) {
  if (charts[name]) { charts[name].destroy(); delete charts[name]; }
}

const tooltipNumbers = {
  callbacks: { label: (ctx) => (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + fmt(ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed) },
};

/** Рейтинг: горизонтальные полосы по всем доменам. Читается и на двадцати. */
function renderRankChart() {
  killChart('rank');
  const site = state.store.site;
  const ranked = allDomains(state.base).sort((a, b) => metric(a, 'vis') - metric(b, 'vis'));
  const values = ranked.map((d) => metric(d, 'vis'));
  const colors = ranked.map((d) => colorFor(d));

  charts.rank = new Chart(document.getElementById('chart-rank'), {
    type: 'bar',
    data: {
      labels: ranked,
      datasets: [{
        label: 'Видимость',
        data: values,
        backgroundColor: colors,
        borderRadius: 4,
        borderSkipped: false,
        barPercentage: 0.72,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const domain = ranked[ctx.dataIndex];
              const s = summaryOf(domain) || {};
              const parts = [`Видимость: ${fmt(s.vis)}`];
              if (domain === site) parts.push('— это наш сайт');
              else {
                const our = metric(site, 'vis');
                const ours = our ? Math.round((s.vis / our) * 100) : 0;
                parts.push(`${ours}% от нашей видимости`);
              }
              return parts;
            },
          },
        },
      },
      scales: {
        x: { beginAtZero: true, grid: { color: '#eef1f6' }, ticks: { callback: (v) => fmt(v) } },
        y: {
          grid: { display: false },
          ticks: {
            autoSkip: false,
            font: (ctx) => ({ weight: ranked[ctx.index] === site ? '650' : '450', size: 12 }),
            color: (ctx) => (ranked[ctx.index] === site ? '#1f5fd6' : '#4a5a6e'),
          },
        },
      },
    },
  });
}

function renderTrendChart() {
  killChart('trend');
  const grid = historyGrid('vis');
  const site = state.store.site;

  charts.trend = new Chart(document.getElementById('chart-trend'), {
    type: 'line',
    data: {
      labels: grid.periods.map(fmtPeriod),
      datasets: grid.domains.map((domain) => ({
        label: domain,
        data: grid.byDomain[domain],
        borderColor: colorFor(domain),
        backgroundColor: colorFor(domain),
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

  document.getElementById('trend-hint').textContent = grid.periods.length
    ? `${grid.periods.length} мес. · ${grid.domains.length - 1} конкурент(ов)`
    : 'история недоступна';
}

function renderDepthChart() {
  killChart('depth');
  const domains = chosenDomains();
  const shades = ['#c9d8f2', '#a8c1ec', '#7ba2e3', '#4b81d9', '#1f5fd6'];
  const order = [4, 3, 2, 1, 0];

  charts.depth = new Chart(document.getElementById('chart-depth'), {
    type: 'bar',
    data: {
      labels: domains,
      datasets: order.map((idx, i) => ({
        label: POS_LABELS[idx].label,
        data: domains.map((d) => metric(d, POS_LABELS[idx].key)),
        backgroundColor: shades[i],
        borderRadius: 3,
        borderSkipped: false,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label(ctx) {
              const total = metric(domains[ctx.dataIndex], 'it50') || 1;
              return `${ctx.dataset.label}: ${fmt(ctx.parsed.y)} (${Math.round((ctx.parsed.y / total) * 100)}% от топ-50)`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 60, minRotation: 40 } },
        y: { beginAtZero: true, grid: { color: '#eef1f6' }, ticks: { callback: (v) => fmt(v) } },
      },
    },
  });
}

function renderTrafficChart() {
  killChart('traffic');
  const grid = historyGrid('ads');
  const site = state.store.site;

  const datasets = grid.domains.map((domain) => ({
    label: domain,
    data: grid.byDomain[domain],
    borderColor: colorFor(domain),
    backgroundColor: 'transparent',
    borderWidth: domain === site ? 3 : 1.8,
    tension: 0.28,
    pointRadius: 0,
    pointHoverRadius: 5,
  }));

  const range = historyGrid('it50');
  if (range.byDomain[site]) {
    datasets.push({
      label: 'Запросов в топ-50 у нас (правая ось)',
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
        y2: { position: 'right', beginAtZero: false, grid: { display: false }, ticks: { callback: (v) => fmt(v) } },
      },
    },
  });
}

function renderPagesChart() {
  killChart('pages');
  const grid = historyGrid('pages');
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

  const rowHtml = (domain) => {
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
      </tr>`;
  };

  const parts = [rowHtml(site)];
  (state.store.groups || []).forEach((group) => {
    const present = (group.domains || []).filter((d) => summaryOf(d));
    if (!present.length) return;
    parts.push(`<tr class="group-row"><td colspan="10">${esc(group.title || group.id)}</td></tr>`);
    present.forEach((domain) => parts.push(rowHtml(domain)));
  });

  tbody.innerHTML = parts.join('');
}

function renderKeywordTable() {
  const headRow = document.getElementById('kw-head-row');
  const tbody = document.querySelector('#kw-table tbody');
  const site = state.store.site;
  const rivals = chosenDomains().filter((d) => d !== site);

  const columns = [
    { key: 'word', label: 'Запрос', type: 'text' },
    { key: 'wsk', label: 'Частотность', type: 'num' },
    { key: `pos:${site}`, label: `${site}`, type: 'num' },
    { key: `delta:${site}`, label: 'Δ', type: 'num' },
  ];
  rivals.forEach((d) => columns.push({ key: `pos:${d}`, label: d, type: 'num' }));

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
        state.keywordSort = { key, dir: key === 'word' ? 'asc' : 'desc' };
      }
      renderKeywordTable();
    });
  });

  let rows = (state.store.keywords_recent || []).slice();
  const filter = state.keywordFilter.trim().toLowerCase();
  if (filter) rows = rows.filter((row) => String(row.word).toLowerCase().includes(filter));

  if (state.onlyLosing) {
    rows = rows.filter((row) => {
      const ours = ((row.pos || {})[site] || {}).pos || 0;
      return rivals.some((d) => {
        const rival = ((row.pos || {})[d] || {}).pos || 0;
        if (!rival) return false;
        return ours === 0 || rival < ours;
      });
    });
  }

  const { key, dir } = state.keywordSort;
  const sign = dir === 'desc' ? -1 : 1;

  const pick = (row) => {
    if (key === 'word') return row.word || '';
    if (key === 'wsk') return row.wsk || 0;
    if (key === 'ws') return row.ws || 0;
    const [field, domain] = key.split(':');
    const cell = (row.pos || {})[domain];
    if (!cell) return -1;
    if (field === 'delta') return Number(cell.delta) || 0;
    const pos = Number(cell.pos) || 0;
    return pos === 0 ? 999 : pos;   // «вне топа» уходит в конец
  };

  rows.sort((a, b) => {
    const av = pick(a);
    const bv = pick(b);
    if (typeof av === 'string') return av.localeCompare(bv, 'ru') * sign;
    return (av - bv) * sign;
  });

  const posCell = (cell) => {
    if (!cell || !cell.pos) return '<span class="pos-none">—</span>';
    const p = Number(cell.pos);
    const cls = p === 1 ? 'pos-1' : p <= 3 ? 'pos-2' : p <= 5 ? 'pos-3' : p <= 10 ? 'pos-mid' : 'pos-low';
    const title = cell.url ? ` title="${esc(cell.url)}"` : '';
    return `<span class="pos-badge ${cls}"${title}>${p}</span>`;
  };

  tbody.innerHTML = rows.map((row) => {
    const siteCell = (row.pos || {})[site];
    const ourPos = siteCell && siteCell.pos ? Number(siteCell.pos) : 0;

    const deltaCell = siteCell && siteCell.delta
      ? `<span class="delta ${siteCell.delta > 0 ? 'up' : siteCell.delta < 0 ? 'down' : 'flat'}">${siteCell.delta > 0 ? '+' : ''}${siteCell.delta}</span>`
      : '<span class="pos-none">—</span>';

    const rivalCells = rivals.map((domain) => {
      const cell = (row.pos || {})[domain];
      const p = cell && cell.pos ? Number(cell.pos) : 0;
      const losing = p && (!ourPos || p < ourPos);
      return `<td class="num${losing ? ' better-than-us' : ''}">${posCell(cell)}</td>`;
    }).join('');

    return `
      <tr>
        <td class="word-cell">
          <a class="serp-link" target="_blank" rel="noopener"
             href="https://yandex.ru/search/?text=${encodeURIComponent(row.word)}">${esc(row.word)}</a>
        </td>
        <td class="num">${fmt(row.wsk)}</td>
        <td class="num">${posCell(siteCell)}</td>
        <td class="num">${deltaCell}</td>
        ${rivalCells}
      </tr>`;
  }).join('');

  document.getElementById('kw-count').textContent =
    `${rows.length} из ${(state.store.keywords_recent || []).length} запросов · конкурентов в таблице: ${rivals.length}`;
}

/* --------------------------- выбор конкурентов -------------------------- */

function renderPicker() {
  const wrap = document.getElementById('picker');
  const site = state.store.site;

  const groupsHtml = (state.store.groups || []).map((group) => {
    const domains = allDomains(state.base).filter((d) => (group.domains || []).includes(d));
    if (!domains.length) return '';
    return `
      <div class="picker-group">
        <div class="picker-group-head">
          <span>${esc(group.title || group.id)}</span>
          <button type="button" class="link-btn" data-group-toggle="${esc(group.id)}">
            ${domains.every((d) => state.selected.has(d)) ? 'снять все' : 'выбрать все'}
          </button>
        </div>
        <div class="picker-chips">
          ${domains.map((d) => `
            <span class="chip" role="button" tabindex="0"
                  aria-pressed="${state.selected.has(d) ? 'true' : 'false'}"
                  data-on="${state.selected.has(d) ? 1 : 0}" data-domain="${esc(d)}">
              <span class="chip-dot"></span>
              ${esc(d)}
            </span>`).join('')}
        </div>
      </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="picker-chips">
      <span class="chip is-site" data-on="1">
        <span class="chip-dot"></span>
        ${esc(site)}
      </span>
    </div>
    <div class="picker-actions">
      <button type="button" class="link-btn" id="pick-none">оставить только сайт</button>
      <span class="hint">выбрано конкурентов: ${state.selected.size}</span>
    </div>
    ${groupsHtml}`;

  wrap.querySelectorAll('.chip[data-domain]').forEach((chip) => {
    const toggle = () => {
      const domain = chip.dataset.domain;
      if (state.selected.has(domain)) state.selected.delete(domain);
      else state.selected.add(domain);
      renderPicker();
      renderChartsAndTable();
    };
    chip.addEventListener('click', toggle);
    chip.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
    });
  });

  wrap.querySelectorAll('[data-group-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = (state.store.groups || []).find((g) => g.id === btn.dataset.groupToggle);
      const domains = allDomains(state.base).filter((d) => (group.domains || []).includes(d));
      const allOn = domains.every((d) => state.selected.has(d));
      domains.forEach((d) => (allOn ? state.selected.delete(d) : state.selected.add(d)));
      renderPicker();
      renderChartsAndTable();
    });
  });

  const none = document.getElementById('pick-none');
  if (none) {
    none.addEventListener('click', () => {
      state.selected.clear();
      renderPicker();
      renderChartsAndTable();
    });
  }
}

/* ------------------------------- сборка --------------------------------- */

/** Графики и таблица запросов зависят от выборки — перерисовываются вместе. */
function renderChartsAndTable() {
  renderTrendChart();
  renderDepthChart();
  renderTrafficChart();
  renderPagesChart();
  renderKeywordTable();
}

function renderAll() {
  renderKpis();
  renderRankChart();
  renderCompareTable();
  renderPicker();
  renderChartsAndTable();

  document.getElementById('footer-source').textContent =
    `Источник: Keys.so · снимок ${state.store.generated_at_msk || state.store.generated_at} · автообновление раз в 3 часа`;

  const errors = state.store.errors || [];
  const box = document.getElementById('footer-errors');
  box.textContent = errors.length
    ? `⚠ не собралось отчётов: ${errors.length} — часть блоков может быть пустой`
    : '';
  box.title = errors.slice(0, 12).join('\n');
}

function renderBaseSwitch() {
  const wrap = document.getElementById('base-switch');
  const bases = state.store.bases || ['msk'];
  wrap.innerHTML = bases.map((base) => `
    <button type="button" role="tab" data-base="${esc(base)}"
      aria-selected="${base === state.base}">${esc(baseLabel(base))}</button>`).join('');

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

    const defaults = (store.selected_by_default || [])
      .filter((d) => domainsFor(state.base)[d] && d !== store.site);
    state.selected = new Set(defaults.length ? defaults : []);

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

document.getElementById('kw-only-losing').addEventListener('change', (event) => {
  state.onlyLosing = event.target.checked;
  if (state.store) renderKeywordTable();
});

document.addEventListener('DOMContentLoaded', boot);
