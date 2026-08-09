// ── Browse filters and card-grid rendering ──────────────────────────────────
function setChip(el, filterKey) {
  el.closest('.flex').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activeFilters[filterKey] = el.getAttribute('data-value');
  applyFilters();
}

function applyFilters() {
  const search = document.getElementById('search-input').value.toLowerCase();
  const domain = document.getElementById('filter-domain').value;
  const study  = document.getElementById('filter-study').value;
  const sort   = document.getElementById('sort-select').value;

  let result = allCards.filter(c => {
    const effect = normalizeEffect(outcomeOf(c, 'effect_direction'));
    if (activeFilters.effect && effect !== activeFilters.effect) return false;
    if (activeFilters.role) {
      const role = normalizeRole(c.interaction_task?.ai_role);
      if (role.toLowerCase() !== activeFilters.role.toLowerCase()) return false;
    }
    if (activeFilters.expertise && c.human_participants?.expertise_level !== activeFilters.expertise) return false;
    if (domain) {
      const domains = asList(c.interaction_task?.task_domain);
      if (!domains.some(d => d === domain || d.toLowerCase() === domain.toLowerCase())) return false;
    }
    if (study) {
      const methods = asList(c.methodology);
      const st = c.study_type || '';
      const hit = methods.some(m => m === study || m.toLowerCase() === study.toLowerCase()) || st === study || st.toLowerCase().includes(study.toLowerCase());
      if (!hit) return false;
    }
    if (search) {
      const hay = JSON.stringify(c).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  result.sort((a, b) => {
    if (sort === 'year')     return (b.year || 0) - (a.year || 0);
    if (sort === 'sample')   return (b.human_participants?.sample_size || 0) - (a.human_participants?.sample_size || 0);
    if (sort === 'complete') return getCompleteness(b).score - getCompleteness(a).score;
    if (sort === 'alpha')    return (a.paper_title || '').localeCompare(b.paper_title || '');
    return 0;
  });

  renderCards(result);
  document.getElementById('results-count').textContent = `${result.length} of ${allCards.length} cards`;
}

function clearFilters() {
  document.getElementById('search-input').value = '';
  document.getElementById('filter-domain').value = '';
  document.getElementById('filter-study').value = '';
  activeFilters = { effect: '', role: '', expertise: '', domain: '', study: '' };
  document.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.getAttribute('data-value') === '');
  });
  applyFilters();
}

function populateFilterOptions() {
  const domains = [...new Set(allCards.flatMap(c => asList(c.interaction_task?.task_domain)))].sort();
  const studies = [...new Set(allCards.flatMap(c => {
    const m = asList(c.methodology);
    return m.length ? m : (c.study_type ? [c.study_type] : []);
  }))].sort();

  const domSel = document.getElementById('filter-domain');
  domSel.innerHTML = '<option value="">All domains</option>';
  domains.forEach(d => { const o = document.createElement('option'); o.value = d; o.textContent = d; domSel.appendChild(o); });

  const stdSel = document.getElementById('filter-study');
  stdSel.innerHTML = '<option value="">All study types</option>';
  studies.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; stdSel.appendChild(o); });
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
  const { score, missing } = getCompleteness(card);
  const em = effectMeta(outcomeOf(card, 'effect_direction'));
  const barClass = score >= 80 ? 'bar-high' : score >= 50 ? 'bar-med' : 'bar-low';
  const authors = Array.isArray(card.authors) ? card.authors.slice(0, 2).join(', ') + (card.authors.length > 2 ? ' et al.' : '') : card.authors || '';
  const summary = outcomeOf(card, 'main_effects_summary') || '';
  const shortSummary = summary.length > 110 ? summary.substring(0, 107) + '...' : summary;
  const n = card.human_participants?.sample_size;
  const hasIncomplete = missing.length > 0;
  const domains = asList(card.interaction_task?.task_domain).join(', ') || '—';
  const studyLabel = asList(card.methodology)[0] || card.study_type || '';
  const access = asList(card.ai_model?.access_method).join(', ') || '—';

  return `
  <div class="bg-white rounded-xl border border-slate-200 shadow-sm card-lift ${em.border} overflow-hidden flex flex-col" onclick="showCardModal(${card.paper_id})">
    <div class="p-4 flex-1">
      <div class="flex flex-wrap items-center gap-1.5 mb-2.5">
        <span class="text-xs px-2 py-0.5 rounded-full font-medium ${em.badge}">${em.label}</span>
        ${studyLabel ? `<span class="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">${studyLabel.replace('Randomized Controlled Trial (RCT)','RCT')}</span>` : ''}
        ${card.year ? `<span class="text-xs text-slate-400 font-medium ml-auto">${card.year}</span>` : ''}
      </div>

      <h3 class="font-bold text-slate-900 text-sm leading-snug mb-1 line-clamp-2">${card.paper_title || 'Untitled'}</h3>
      <p class="text-xs text-slate-500 mb-3">${authors}${card.study_id ? ` · <span class="font-medium text-slate-400">${card.study_id}</span>` : ''}</p>

      <div class="grid grid-cols-2 gap-2 mb-3">
        <div class="bg-slate-50 rounded-lg p-2.5">
          <p class="text-xs font-semibold text-[#1e3a5f] mb-0.5">AI Model</p>
          <p class="text-xs text-slate-700 font-medium">${card.ai_model?.model_name || '—'}</p>
          <p class="text-xs text-slate-500">${card.ai_model?.provider || '—'}</p>
        </div>
        <div class="bg-slate-50 rounded-lg p-2.5">
          <p class="text-xs font-semibold text-[#0891b2] mb-0.5">Participants</p>
          <p class="text-xs text-slate-700 font-medium">${n != null ? `N = ${Number(n).toLocaleString()}` : 'N unknown'}</p>
          <p class="text-xs text-slate-500">${card.human_participants?.expertise_level || '—'} expertise</p>
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
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-xs text-slate-400">${score}% complete${missing.length > 0 ? ` · ${missing.length} missing` : ''}</span>
        ${score === 100 ? '<span class="text-xs text-green-600 font-medium">Complete</span>' : ''}
      </div>
      <div class="bar-bg mb-3"><div class="bar-fill ${barClass}" style="width:${score}%"></div></div>
      <div class="flex gap-2">
        <button class="flex-1 py-1.5 text-xs font-semibold border border-[#1e3a5f] text-[#1e3a5f] rounded-lg hover:bg-[#f0f4ff] transition-colors" onclick="event.stopPropagation(); showCardModal(${card.paper_id})">View Card</button>
        ${hasIncomplete ? `<button class="flex-1 py-1.5 text-xs font-semibold bg-amber-50 border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors" onclick="event.stopPropagation(); openCompleteModal(${card.paper_id})">Help Complete</button>` : ''}
      </div>
    </div>
  </div>`;
}
