// ── Pairwise study comparison ────────────────────────────────────────────────
function findCardById(id) {
  return allCards.find(card => String(card.paper_id) === String(id));
}

function fillCompareSelects() {
  const aSelect = document.getElementById('compare-a-select');
  const bSelect = document.getElementById('compare-b-select');

  if (!allCards.length) {
    aSelect.innerHTML = '<option>No cards available</option>';
    bSelect.innerHTML = '<option>No cards available</option>';
    compareState.a = null;
    compareState.b = null;
    syncCompareOptions();
    return;
  }

  const fill = (select, selected) => {
    select.innerHTML = '';
    allCards.forEach(card => {
      const option = document.createElement('option');
      option.value = String(card.paper_id);
      option.textContent = `#${card.paper_id} · ${card.year || 'n.d.'} · ${card.paper_title || 'Untitled'}`;
      select.appendChild(option);
    });
    if (selected !== null) select.value = String(selected);
  };

  compareState.a = findCardById(compareState.a) ? String(compareState.a) : String(allCards[0].paper_id);
  if (allCards.length === 1) {
    compareState.b = null;
    fill(aSelect, compareState.a);
    fill(bSelect, null);
    syncCompareOptions();
    return;
  }

  if (!findCardById(compareState.b) || String(compareState.b) === String(compareState.a)) {
    compareState.b = String(getNearTwin(findCardById(compareState.a)).card.paper_id);
  }

  fill(aSelect, compareState.a);
  fill(bSelect, compareState.b);
  syncCompareOptions();
}

function syncCompareOptions() {
  const aSelect = document.getElementById('compare-a-select');
  const bSelect = document.getElementById('compare-b-select');
  [...aSelect.options].forEach(option => option.disabled = option.value === String(compareState.b));
  [...bSelect.options].forEach(option => option.disabled = option.value === String(compareState.a));
  document.getElementById('near-twin-btn').disabled = allCards.length < 2;
}

function getNearTwin(source) {
  if (!source) return null;
  let best = null;

  allCards.forEach(candidate => {
    if (candidate.paper_id === source.paper_id) return;
    let matches = 0;
    let differences = 0;

    NEAR_TWIN_FIELDS.forEach(path => {
      const a = getField(source, path);
      const b = getField(candidate, path);
      if (isMissingValue(a) || isMissingValue(b)) return;
      if (comparisonValuesEqual(a, b)) matches++;
      else differences++;
    });

    const score = matches - differences * 0.35;
    const differentEffect = !comparisonValuesEqual(source.interaction_task?.effect_direction, candidate.interaction_task?.effect_direction);
    if (!best || score > best.score ||
        (score === best.score && matches > best.matches) ||
        (score === best.score && matches === best.matches && differentEffect && !best.differentEffect)) {
      best = { card: candidate, score, matches, differences, differentEffect };
    }
  });

  return best;
}

function selectNearTwin() {
  const nearest = getNearTwin(findCardById(compareState.a));
  if (!nearest) return;
  compareState.b = String(nearest.card.paper_id);
  fillCompareSelects();
  renderComparison();
  showToast(`Nearest study selected (${nearest.matches} matching fields)`, 'success');
}

function renderComparison() {
  const a = findCardById(compareState.a);
  const b = findCardById(compareState.b);
  const hostA = document.getElementById('compare-card-a');
  const hostB = document.getElementById('compare-card-b');
  const summary = document.getElementById('comparison-summary');

  if (!a || !b || a.paper_id === b.paper_id) {
    hostA.className = 'compare-empty';
    hostB.className = 'compare-empty';
    hostA.textContent = allCards.length < 2 ? 'At least two cards are needed for comparison.' : 'Select Study A.';
    hostB.textContent = allCards.length < 2 ? 'At least two cards are needed for comparison.' : 'Select Study B.';
    summary.innerHTML = '';
    return;
  }

  hostA.className = '';
  hostB.className = '';
  hostA.innerHTML = renderComparisonCard(a, b);
  hostB.innerHTML = renderComparisonCard(b, a);
  renderComparisonSummary(a, b);
}

function renderComparisonCard(card, other) {
  const effect = effectMeta(card.interaction_task?.effect_direction);
  const authors = Array.isArray(card.authors) ? card.authors.join(', ') : (card.authors || '');
  const groups = COMPARE_GROUPS.map(group => `
    <div class="compare-section">
      <h3 class="compare-section-title" style="color:${group.color}">${group.title}</h3>
      ${group.fields.map(field => {
        const value = getField(card, field.path);
        const otherValue = getField(other, field.path);
        const state = compareState.highlight ? (comparisonValuesEqual(value, otherValue) ? ' same' : ' diff') : '';
        return `<div class="compare-field${state}">
          <div class="compare-label">${field.label}</div>
          <div class="compare-value">${escHtml(displayComparisonValue(value, field.path))}</div>
        </div>`;
      }).join('')}
    </div>`).join('');

  return `<article class="compare-card">
    <div class="compare-card-header">
      <div class="flex flex-wrap items-center gap-1.5 mb-2">
        <span class="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-white font-semibold">#${card.paper_id}</span>
        <span class="text-xs px-2 py-0.5 rounded-full font-medium ${effect.badge}">${effect.label}</span>
        ${card.study_type ? `<span class="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">${escHtml(card.study_type)}</span>` : ''}
      </div>
      <h3 class="font-bold text-slate-900 text-base leading-snug mb-1">${escHtml(card.paper_title || 'Untitled')}</h3>
      <p class="text-xs text-slate-500 leading-relaxed">${escHtml(authors)}</p>
    </div>
    ${groups}
  </article>`;
}

function renderComparisonSummary(a, b) {
  const fields = COMPARE_GROUPS.flatMap(group => group.fields);
  const reported = fields.filter(field => !isMissingValue(getField(a, field.path)) || !isMissingValue(getField(b, field.path)));
  const same = reported.filter(field => comparisonValuesEqual(getField(a, field.path), getField(b, field.path)));
  const different = reported.filter(field => !comparisonValuesEqual(getField(a, field.path), getField(b, field.path)));
  const resultPaths = new Set(['interaction_task.effect_direction', 'interaction_task.main_effects_summary']);
  const designDifferences = different.filter(field => !resultPaths.has(field.path));
  const nearTwin = designDifferences.length <= 3 && same.length >= 8;
  const shown = designDifferences.slice(0, 4).map(field => field.label);
  const extra = designDifferences.length - shown.length;
  const differenceText = shown.length ? `${shown.join(', ')}${extra > 0 ? `, plus ${extra} more` : ''}` : 'no reported design fields';
  const effectA = displayComparisonValue(a.interaction_task?.effect_direction, 'interaction_task.effect_direction');
  const effectB = displayComparisonValue(b.interaction_task?.effect_direction, 'interaction_task.effect_direction');
  const effectChanged = !comparisonValuesEqual(a.interaction_task?.effect_direction, b.interaction_task?.effect_direction);
  const summary = document.getElementById('comparison-summary');

  summary.innerHTML = `<div class="rounded-xl border ${nearTwin ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-slate-200 bg-white text-slate-700'} p-4 text-sm leading-relaxed">
    <strong>${nearTwin ? 'Near-twin contrast.' : 'Comparison summary.'}</strong>
    The studies match on <strong>${same.length}</strong> of <strong>${reported.length}</strong> reported fields and differ on ${differenceText}.
    ${effectChanged ? `Their effect directions also differ: <strong>${escHtml(effectA)}</strong> versus <strong>${escHtml(effectB)}</strong>.` : `Both report a <strong>${escHtml(effectA)}</strong> effect direction.`}
  </div>`;
}
