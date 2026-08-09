// ── Design-space map ────────────────────────────────────────────────────────
function fillMapDimensionSelects() {
  const fill = (id, selected) => {
    const select = document.getElementById(id);
    select.innerHTML = '';
    MAP_DIMENSIONS.forEach(dim => {
      const option = document.createElement('option');
      option.value = dim.key;
      option.textContent = dim.label;
      select.appendChild(option);
    });
    select.value = selected;
  };
  fill('map-y-select', mapState.y);
  fill('map-x-select', mapState.x);
  syncMapDimensionOptions();
}

function syncMapDimensionOptions() {
  const x = document.getElementById('map-x-select');
  const y = document.getElementById('map-y-select');
  [...x.options].forEach(option => option.disabled = option.value === mapState.y);
  [...y.options].forEach(option => option.disabled = option.value === mapState.x);
  x.value = mapState.x;
  y.value = mapState.y;
}

function getMapDimension(key) {
  return MAP_DIMENSIONS.find(dim => dim.key === key);
}

function mapDimensionValues(card, dim) {
  const raw = getField(card, dim.key);
  const values = dim.multi ? splitMapValues(raw) : [raw];
  const unique = new Map();
  values.forEach(value => {
    const normalized = dim.normalize ? dim.normalize(value) : normalizeText(value);
    if (normalized !== null) unique.set(mapValueKey(normalized), normalized);
  });
  return [...unique.values()];
}

function getMapValues(dim) {
  const present = new Map();
  allCards.forEach(card => {
    mapDimensionValues(card, dim).forEach(value => present.set(mapValueKey(value), value));
  });

  const values = [];
  (dim.order || []).forEach(value => {
    values.push(value);
    present.delete(mapValueKey(value));
  });
  [...present.values()].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })).forEach(value => values.push(value));
  return values;
}

function formatMapValue(dim, value) {
  if (dim.key === 'interaction_task.ai_role' || dim.key === 'interaction_task.effect_direction' || dim.key === 'study_type') return titleCase(value);
  return String(value);
}

function mapCellColor(count, max) {
  const t = max ? count / max : 0;
  const light = [219, 234, 254];
  const dark = [30, 58, 95];
  const rgb = light.map((v, i) => Math.round(v + (dark[i] - v) * t));
  return `rgb(${rgb.join(',')})`;
}


function renderDesignMap() {
  const grid = document.getElementById('design-map-grid');
  const peakEl = document.getElementById('map-peak');
  const gapEl = document.getElementById('map-gap');
  const detail = document.getElementById('map-detail');

  if (!allCards.length) {
    grid.style.gridTemplateColumns = '1fr';
    grid.innerHTML = '<div class="text-sm text-slate-400 py-8">No cards are available.</div>';
    peakEl.textContent = 'No cards are available.';
    gapEl.textContent = 'No cards are available.';
    detail.innerHTML = '<p class="text-sm text-slate-400">No studies to display.</p>';
    return;
  }

  const xDim = getMapDimension(mapState.x);
  const yDim = getMapDimension(mapState.y);
  const xs = getMapValues(xDim);
  const ys = getMapValues(yDim);

  if (!xs.length || !ys.length) {
    grid.style.gridTemplateColumns = '1fr';
    grid.innerHTML = '<div class="text-sm text-slate-400 py-8">These dimensions do not have enough reported values to map.</div>';
    peakEl.textContent = 'No cells can be plotted for these axes.';
    gapEl.textContent = 'Choose another pair of dimensions.';
    detail.innerHTML = '<p class="text-sm text-slate-400">Choose another pair of dimensions.</p>';
    return;
  }

  const xIndex = new Map(xs.map((value, index) => [mapValueKey(value), index]));
  const yIndex = new Map(ys.map((value, index) => [mapValueKey(value), index]));
  const matrix = ys.map(() => xs.map(() => []));

  let plottedCards = 0;
  allCards.forEach(card => {
    const xValues = mapDimensionValues(card, xDim);
    const yValues = mapDimensionValues(card, yDim);
    if (!xValues.length || !yValues.length) return;
    plottedCards++;
    yValues.forEach(yValue => xValues.forEach(xValue => {
      const xi = xIndex.get(mapValueKey(xValue));
      const yi = yIndex.get(mapValueKey(yValue));
      if (xi !== undefined && yi !== undefined) matrix[yi][xi].push(card);
    }));
  });

  const rowTotals = matrix.map(row => row.reduce((sum, studies) => sum + studies.length, 0));
  const colTotals = xs.map((_, xi) => matrix.reduce((sum, row) => sum + row[xi].length, 0));
  const placements = rowTotals.reduce((sum, value) => sum + value, 0);
  const max = Math.max(0, ...matrix.flat().map(studies => studies.length));
  let peak = null;
  let bestGap = null;
  let fallbackGap = null;

  grid.style.gridTemplateColumns = `minmax(140px, 180px) repeat(${xs.length}, minmax(72px, 1fr)) 3rem`;
  const html = [];
  html.push(`<div class="map-corner">${escHtml(yDim.label)} ↓<br>${escHtml(xDim.label)} →</div>`);
  xs.forEach(value => html.push(`<div class="map-column-label">${escHtml(formatMapValue(xDim, value))}</div>`));
  html.push('<div class="map-column-label">Σ</div>');

  ys.forEach((yValue, yi) => {
    html.push(`<div class="map-row-label">${escHtml(formatMapValue(yDim, yValue))}</div>`);
    xs.forEach((xValue, xi) => {
      const studies = matrix[yi][xi];
      const count = studies.length;
      if (count > 0) {
        if (!peak || count > peak.count) peak = { count, xi, yi };
        const selected = mapState.selected && mapState.selected.x === mapValueKey(xValue) && mapState.selected.y === mapValueKey(yValue);
        const color = mapCellColor(count, max);
        const textColor = max && count / max > 0.45 ? '#fff' : '#1e293b';
        const label = `${count} studies at ${formatMapValue(yDim, yValue)} by ${formatMapValue(xDim, xValue)}`;
        html.push(`<button type="button" class="map-cell${selected ? ' selected' : ''}" data-map-y="${yi}" data-map-x="${xi}" style="background:${color};color:${textColor}" aria-label="${escHtml(label)}">${count}</button>`);
      } else {
        const score = rowTotals[yi] + colTotals[xi];
        const gap = { score, xi, yi, supported: rowTotals[yi] > 0 && colTotals[xi] > 0 };
        if (!fallbackGap || score > fallbackGap.score) fallbackGap = gap;
        if (gap.supported && (!bestGap || score > bestGap.score)) bestGap = gap;
        html.push('<div class="map-cell empty">GAP</div>');
      }
    });
    html.push(`<div class="map-total">${rowTotals[yi]}</div>`);
  });

  html.push('<div class="map-corner"></div>');
  colTotals.forEach(total => html.push(`<div class="map-total">${total}</div>`));
  html.push(`<div class="map-total">${placements}</div>`);
  grid.innerHTML = html.join('');

  grid.querySelectorAll('button[data-map-y]').forEach(button => {
    button.addEventListener('click', () => {
      const yi = Number(button.dataset.mapY);
      const xi = Number(button.dataset.mapX);
      mapState.selected = { y: mapValueKey(ys[yi]), x: mapValueKey(xs[xi]) };
      renderDesignMap();
    });
  });

  if (peak) {
    peakEl.innerHTML = `<strong>${escHtml(formatMapValue(yDim, ys[peak.yi]))} × ${escHtml(formatMapValue(xDim, xs[peak.xi]))}</strong> contains ${peak.count} card${peak.count === 1 ? '' : 's'}.`;
  } else {
    peakEl.textContent = 'No filled cells appear on these axes.';
  }

  bestGap = bestGap || fallbackGap;
  if (bestGap) {
    const yLabel = formatMapValue(yDim, ys[bestGap.yi]);
    const xLabel = formatMapValue(xDim, xs[bestGap.xi]);
    const absent = [rowTotals[bestGap.yi] === 0 ? yLabel : null, colTotals[bestGap.xi] === 0 ? xLabel : null].filter(Boolean);
    gapEl.innerHTML = bestGap.supported
      ? `<strong>${escHtml(yLabel)} × ${escHtml(xLabel)}</strong> has no studies even though both categories are represented elsewhere.`
      : `<strong>${escHtml(yLabel)} × ${escHtml(xLabel)}</strong> has no studies; ${absent.map(label => `<strong>${escHtml(label)}</strong>`).join(' and ')} ${absent.length === 1 ? 'is' : 'are'} absent from the current cards.`;
  } else {
    gapEl.textContent = 'Every combination on these axes has at least one study.';
  }

  if (mapState.selected) {
    const yi = ys.findIndex(value => mapValueKey(value) === mapState.selected.y);
    const xi = xs.findIndex(value => mapValueKey(value) === mapState.selected.x);
    if (yi >= 0 && xi >= 0 && matrix[yi][xi].length) {
      renderMapDetail(yDim, ys[yi], xDim, xs[xi], matrix[yi][xi]);
      return;
    }
  }

  const placementNote = placements === plottedCards ? '' : ` across ${placements} cell placements`;
  detail.innerHTML = `<p class="text-sm text-slate-400">${plottedCards} of ${allCards.length} cards are represented${placementNote}. Select a filled cell to list its studies.</p>`;
}

function renderMapDetail(yDim, yValue, xDim, xValue, studies) {
  const detail = document.getElementById('map-detail');
  detail.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <p class="text-sm font-bold text-slate-800">${escHtml(formatMapValue(yDim, yValue))} × ${escHtml(formatMapValue(xDim, xValue))}</p>
      <span class="text-xs text-slate-400">${studies.length} stud${studies.length === 1 ? 'y' : 'ies'}</span>
    </div>
    <div>${studies.map(card => {
      const effect = effectMeta(card.interaction_task?.effect_direction);
      return `<button type="button" class="map-study-row" data-paper-id="${card.paper_id}">
        <span class="map-study-id">#${card.paper_id}</span>
        <span class="map-study-title">${escHtml(card.paper_title || 'Untitled')}</span>
        <span class="text-xs px-2 py-0.5 rounded-full font-medium ${effect.badge}">${effect.label}</span>
      </button>`;
    }).join('')}</div>`;
  detail.querySelectorAll('[data-paper-id]').forEach(button => {
    button.addEventListener('click', () => showCardModal(Number(button.dataset.paperId)));
  });
}
