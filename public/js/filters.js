// ── Browse filters and card-grid rendering ──────────────────────────────────
function setChip(el, filterKey) {
  el.closest('.flex').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activeFilters[filterKey] = el.getAttribute('data-value');
  applyFilters();
}

let periodYears = [];

function cardDataCollectionPeriod(card) {
  return card.human_participants?.data_collection_period || card.data_collection_period || '';
}

function extractYears(text) {
  return [...new Set(String(text || '').match(/\b(19|20)\d{2}\b/g) || [])];
}

function selectedPeriodYear() {
  const i = Number(document.getElementById('filter-period-slider').value);
  return i > 0 ? periodYears[i - 1] : '';
}

function onPeriodSliderInput() {
  const year = selectedPeriodYear();
  document.getElementById('filter-period-label').textContent = year ? `Data collected in ${year}` : 'All years';
  applyFilters();
}

function applyFilters() {
  const search     = document.getElementById('search-input').value.toLowerCase();
  const domain     = document.getElementById('filter-domain').value;
  const expertise  = document.getElementById('filter-domain-expertise').value;
  const period     = selectedPeriodYear();
  const sort       = document.getElementById('sort-select').value;

  let result = allCards.filter(c => {
    if (activeFilters.studyTypePrimary && c.study_type !== activeFilters.studyTypePrimary) return false;
    if (activeFilters.effectDirection && normalizeEffect(outcomeOf(c, 'effect_direction')) !== activeFilters.effectDirection) return false;
    if (domain) {
      const domains = asList(c.interaction_task?.task_domain);
      if (!domains.some(d => d === domain || d.toLowerCase() === domain.toLowerCase())) return false;
    }
    if (expertise && c.human_participants?.domain_expertise !== expertise) return false;
    if (period && !extractYears(cardDataCollectionPeriod(c)).includes(period)) return false;
    if (search) {
      const hay = JSON.stringify(c).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  result.sort((a, b) => {
    if (sort === 'year')     return (b.year || 0) - (a.year || 0);
    if (sort === 'sample')   return (b.human_participants?.sample_size || 0) - (a.human_participants?.sample_size || 0);
    if (sort === 'alpha')    return (a.paper_title || '').localeCompare(b.paper_title || '');
    return 0;
  });

  renderCards(result);
  document.getElementById('results-count').textContent = `${result.length} of ${allCards.length} cards`;
}

function clearFilters() {
  document.getElementById('search-input').value = '';
  document.getElementById('filter-domain').value = '';
  document.getElementById('filter-domain-expertise').value = '';
  document.getElementById('filter-period-slider').value = '0';
  document.getElementById('filter-period-label').textContent = 'All years';
  activeFilters = { studyTypePrimary: '', effectDirection: '' };
  document.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.getAttribute('data-value') === '');
  });
  applyFilters();
}

function populateFilterOptions() {
  const domains = [...new Set(allCards.flatMap(c => asList(c.interaction_task?.task_domain)))].sort();
  const expertiseLevels = [...new Set(allCards.map(c => c.human_participants?.domain_expertise).filter(Boolean))].sort();
  periodYears = [...new Set(allCards.flatMap(c => extractYears(cardDataCollectionPeriod(c))))].sort();

  const domSel = document.getElementById('filter-domain');
  domSel.innerHTML = '<option value="">All domains</option>';
  domains.forEach(d => { const o = document.createElement('option'); o.value = d; o.textContent = d; domSel.appendChild(o); });

  const expSel = document.getElementById('filter-domain-expertise');
  expSel.innerHTML = '<option value="">All expertise levels</option>';
  expertiseLevels.forEach(e => { const o = document.createElement('option'); o.value = e; o.textContent = e; expSel.appendChild(o); });

  const perSlider = document.getElementById('filter-period-slider');
  perSlider.max = String(periodYears.length);
  perSlider.value = '0';
  document.getElementById('filter-period-label').textContent = 'All years';
  document.getElementById('filter-period-max').textContent = periodYears.length
    ? `${periodYears[0]}–${periodYears[periodYears.length - 1]}`
    : 'No data';
}

function renderBrowse(cards) {
  renderCards(cards);
}

function renderCards(cards) {
  const grid = document.getElementById('card-grid');
  if (!cards || cards.length === 0) {
    grid.innerHTML = `<div class="col-span-full text-center py-14 text-slate-400 text-sm">No cards match your filters.</div>`;
    return;
  }
  grid.innerHTML = cards.map(cardHTML).join('');
}

function effectMeta(direction) {
  const label = normalizeEffect(direction) || 'Unknown';
  if (label === 'Positive') return { badge: 'badge-positive', border: 'border-positive', label };
  if (label === 'Negative') return { badge: 'badge-negative', border: 'border-negative', label };
  if (label === 'Heterogeneous') return { badge: 'badge-mixed', border: 'border-mixed', label };
  if (label === 'Null / No Effect') return { badge: 'badge-unknown', border: 'border-unknown', label };
  if (label === 'Unclear') return { badge: 'badge-unknown', border: 'border-unknown', label };
  return { badge: 'badge-unknown', border: 'border-unknown', label: direction || 'Unknown' };
}

function cardHTML(card) {
  const em = effectMeta(outcomeOf(card, 'effect_direction'));
  const authors = Array.isArray(card.authors) ? card.authors.slice(0, 2).join(', ') + (card.authors.length > 2 ? ' et al.' : '') : card.authors || '';
  const summary = outcomeOf(card, 'main_effects_summary') || '';
  const shortSummary = summary.length > 110 ? summary.substring(0, 107) + '...' : summary;
  const n = card.human_participants?.sample_size;
  const domains = asList(card.interaction_task?.task_domain).join(', ') || '—';
  const access = asList(card.ai_model?.access_method).join(', ') || '—';

  return `
  <div class="bg-white rounded-xl border border-slate-200 shadow-sm card-lift ${em.border} overflow-hidden flex flex-col" onclick="showCardModal(${card.paper_id})">
    <div class="bg-[#1e3a5f] px-4 py-1.5 flex items-center justify-end">
      <span class="text-xs text-white/85 font-semibold tracking-wide">${card.year || '—'}</span>
    </div>
    <div class="p-4 flex-1">
      <h3 class="font-bold text-slate-900 text-sm leading-snug mb-1 line-clamp-2">${card.paper_title || 'Untitled'}</h3>
      <p class="text-xs text-slate-500 mb-3">${authors}${card.publication_venue ? ` · <span class="font-medium text-slate-400">${card.publication_venue}</span>` : ''}</p>

      <div class="grid grid-cols-2 gap-2 mb-3">
        <div class="bg-slate-50 rounded-lg p-2.5">
          <p class="text-xs font-semibold text-[#1e3a5f] mb-0.5">AI Model</p>
          <p class="text-xs text-slate-700 font-medium">${card.ai_model?.model_name || '—'}</p>
          <p class="text-xs text-slate-500">${card.ai_model?.provider || '—'}</p>
        </div>
        <div class="bg-slate-50 rounded-lg p-2.5">
          <p class="text-xs font-semibold text-[#0891b2] mb-0.5">Participants</p>
          <p class="text-xs text-slate-700 font-medium">${n != null ? `N = ${Number(n).toLocaleString()}` : 'N unknown'}</p>
          <p class="text-xs text-slate-500">${card.human_participants?.domain_expertise || '—'} expertise</p>
        </div>
      </div>

      <div class="bg-slate-50 rounded-lg p-2.5 mb-3">
        <p class="text-xs font-semibold text-[#059669] mb-0.5">Task &amp; Access</p>
        <p class="text-xs text-slate-700">${domains} · <span>${normalizeRole(card.interaction_task?.ai_role) || '—'}</span> AI</p>
        <p class="text-xs text-slate-500 truncate">${access}</p>
      </div>

      ${shortSummary ? `<p class="text-xs text-slate-600 italic leading-relaxed">"${shortSummary}"</p>` : ''}
    </div>

    <div class="px-4 pb-4 pt-2 border-t border-slate-100 mt-2">
      <div class="flex gap-2">
        <button class="flex-1 py-1.5 text-xs font-semibold border border-[#1e3a5f] text-[#1e3a5f] rounded-lg hover:bg-[#f0f4ff] transition-colors" onclick="event.stopPropagation(); showCardModal(${card.paper_id})">View Card</button>
      </div>
    </div>
  </div>`;
}
