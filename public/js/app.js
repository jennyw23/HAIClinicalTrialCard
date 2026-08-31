// ── App bootstrap, API calls, stats, toast, keyboard shortcuts ─────────────
document.addEventListener('DOMContentLoaded', () => {
  mountFormOptions();
  setupNavScroll();
  setupFadeIn();
  styleRadios();
  setupFeatureControls();
  mountTooltips();
  loadCards();
});

function setupNavScroll() {
  window.addEventListener('scroll', () => {
    document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 10);
  });
}

function setupFadeIn() {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-in').forEach(el => obs.observe(el));
}

function styleRadios() {
  document.querySelectorAll('.radio-opt input').forEach(inp => {
    inp.addEventListener('change', () => {
      const group = inp.closest('.radio-group');
      if (!group) return;
      group.querySelectorAll('.radio-opt').forEach(o => o.classList.remove('selected'));
      if (inp.checked) inp.closest('.radio-opt').classList.add('selected');
    });
    if (inp.checked) inp.closest('.radio-opt')?.classList.add('selected');
  });
  document.querySelectorAll('.check-opt input').forEach(inp => {
    inp.addEventListener('change', () => {
      inp.closest('.check-opt')?.classList.toggle('selected', inp.checked);
    });
    if (inp.checked) inp.closest('.check-opt')?.classList.add('selected');
  });
}

// Warns when a loaded card carries a coded value that is absent from the
// controlled vocabularies in utils.js. Those lists are transcribed from
// HAI_Studies_Master.csv by hand, so when the sheet gains a value this is what
// surfaces it — instead of the value silently matching no filter chip and
// appearing as a stray design-map row.
function checkVocabularies() {
  const specs = [
    ['study_type',                            c => [c.study_type],                                     STUDY_TYPES],
    ['ai_model.provider',                     c => [c.ai_model?.provider],                             AI_PROVIDERS],
    ['ai_model.access_method',                c => asList(c.ai_model?.access_method),                  ACCESS_METHODS],
    ['interaction_task.task_domain',          c => asList(c.interaction_task?.task_domain),            TASK_DOMAINS],
    ['human_participants.domain_expertise',   c => [c.human_participants?.domain_expertise],           DOMAIN_EXPERTISE_LEVELS],
    ['interaction_task.effect_direction',     c => [outcomeOf(c, 'effect_direction')],                 EFFECT_DIRECTIONS],
    ['study_setting',                         c => [c.study_setting],                                  STUDY_SETTINGS],
    ['interaction_task.automation_level',     c => [c.interaction_task?.automation_level],             AUTOMATION_LEVELS],
    ['outcomes.primary_outcome_family',       c => [c.outcomes?.primary_outcome_family],               OUTCOME_FAMILIES],
    ['ai_model.model_version',                c => [c.ai_model?.model_version],                        MODEL_GENERATIONS],
    ['human_participants.participant_type',   c => [c.human_participants?.participant_type],           PARTICIPANT_TYPES],
  ];
  const problems = [];
  specs.forEach(([label, pick, vocab]) => {
    const allowed = new Set(vocab.map(v => String(v).toLowerCase()));
    const unknown = new Map();
    allCards.forEach(card => {
      pick(card).forEach(raw => {
        if (raw === null || raw === undefined || raw === '') return;
        // 'Not reported' is a valid answer everywhere, not a vocabulary gap
        const v = String(raw).trim();
        if (/^not reported$/i.test(v)) return;
        const norm = label === 'interaction_task.effect_direction' ? normalizeEffect(v) : v;
        if (!allowed.has(String(norm).toLowerCase())) {
          unknown.set(norm, (unknown.get(norm) || 0) + 1);
        }
      });
    });
    if (unknown.size) problems.push({ field: label, values: [...unknown.entries()] });
  });
  if (problems.length) {
    console.warn(
      '[vocabulary] card values not present in the controlled vocabularies ' +
      '(utils.js) — update the list from HAI_Studies_Master.csv:',
      problems
    );
  }
  return problems;
}

async function loadCards() {
  try {
    const res = await fetch('/api/cards');
    if (!res.ok) throw new Error('Server error');
    allCards = await res.json();
    checkVocabularies();
    if (document.getElementById('card-grid')) {
      populateFilterOptions();
      applyFilters();
    }
    updateHeroStats();
    refreshFeatureViews();
  } catch (e) {
    const grid = document.getElementById('card-grid');
    if (grid) grid.innerHTML = `
      <div class="col-span-full bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <p class="text-red-700 font-medium text-sm">Could not connect to the server.</p>
        <p class="text-red-600 text-xs mt-1">Make sure the server is running: <code class="bg-red-100 px-1 rounded">npm start</code></p>
      </div>`;
    const mapGrid = document.getElementById('design-map-grid');
    if (mapGrid) mapGrid.innerHTML = '<div class="text-sm text-red-600 py-8">Could not load cards.</div>';
    const cardA = document.getElementById('compare-card-a');
    const cardB = document.getElementById('compare-card-b');
    if (cardA) cardA.textContent = 'Could not load cards.';
    if (cardB) cardB.textContent = 'Could not load cards.';
  }
}

async function parsePDF() {
  if (!selectedFile) return;
  showParseLoading(true);
  const fd = new FormData();
  fd.append('file', selectedFile);
  try {
    const res = await fetch('/api/parse', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Parse failed');
    prefillForm(data);
    showParseLoading(false);
    document.getElementById('parse-success-banner').classList.remove('hidden');
    document.getElementById('card-form-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('Card auto-filled from PDF', 'success');
  } catch (e) {
    showParseLoading(false);
    const el = document.getElementById('parse-error');
    el.textContent = 'Parse failed: ' + e.message;
    el.classList.remove('hidden');
  }
}

async function parseText() {
  const text = document.getElementById('text-input').value.trim();
  if (!text) return;
  showParseLoading(true);
  try {
    const res = await fetch('/api/parse-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Parse failed');
    prefillForm(data);
    switchTab('manual');
    showParseLoading(false);
    document.getElementById('parse-success-banner').classList.remove('hidden');
    document.getElementById('card-form-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('Card auto-filled from text', 'success');
  } catch (e) {
    showParseLoading(false);
    const el = document.getElementById('text-parse-error');
    el.textContent = 'Parse failed: ' + e.message;
    el.classList.remove('hidden');
  }
}

async function submitCard() {
  const data = gatherFormData();
  if (!data.paper_title) return showFormError('Paper title is required.');
  if (!data.study_id) return showFormError('Study ID is required.');
  const hasProvider = !!data.ai_model?.provider;
  const hasDomain = asList(data.interaction_task?.task_domain).length > 0;
  if (!hasProvider && !hasDomain) return showFormError('Provide at least AI provider or task domain.');

  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'Submitting...';

  try {
    const res = await fetch('/api/cards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) throw new Error((await res.json()).error);
    const newCard = await res.json();
    allCards.push(newCard);
    applyFilters();
    updateHeroStats();
    refreshFeatureViews();
    resetForm();
    showToast('Card submitted successfully!', 'success');
    document.getElementById('browse').scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    showFormError('Submit failed: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Submit HAI Clinical Trial Card';
  }
}

function exportCards(format) {
  window.location.href = `/api/export?format=${format}`;
}

function updateHeroStats() {
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set('stat-total', allCards.length);

  const domains = new Set();
  const models = new Set();
  let participants = 0;
  allCards.forEach(c => {
    asList(c.interaction_task?.task_domain).forEach(d => domains.add(d));
    if (c.ai_model?.model_name) models.add(c.ai_model.model_name.trim().toLowerCase());
    if (Number.isFinite(Number(c.human_participants?.sample_size))) participants += Number(c.human_participants.sample_size);
  });
  set('stat-domains', domains.size);
  set('stat-models', models.size);
  set('stat-participants', participants.toLocaleString());
}

function renderExportSummary() {
  const byEffect = {};
  const byDomain = {};
  let totalN = 0, missingN = 0;

  allCards.forEach(c => {
    const ef = normalizeEffect(outcomeOf(c, 'effect_direction')) || 'unknown';
    byEffect[ef] = (byEffect[ef] || 0) + 1;
    asList(c.interaction_task?.task_domain).forEach(dom => {
      byDomain[dom] = (byDomain[dom] || 0) + 1;
    });
    if (c.human_participants?.sample_size) totalN += c.human_participants.sample_size;
    else missingN++;
  });

  const rows = allCards.map(c => {
    const em = effectMeta(outcomeOf(c, 'effect_direction'));
    return `<tr class="border-b border-slate-100 hover:bg-slate-50 text-sm">
      <td class="py-2 px-3 font-medium text-slate-800 max-w-48 truncate">${c.paper_title}</td>
      <td class="py-2 px-3 text-slate-500">${c.year || '—'}</td>
      <td class="py-2 px-3"><span class="text-xs px-2 py-0.5 rounded-full font-medium ${em.badge}">${em.label}</span></td>
      <td class="py-2 px-3 text-slate-500">${asList(c.interaction_task?.task_domain).join(', ') || '—'}</td>
      <td class="py-2 px-3 text-slate-500">${c.human_participants?.sample_size?.toLocaleString() || '—'}</td>
    </tr>`;
  }).join('');

  const el = document.getElementById('export-summary');
  if (!el) return;
  el.innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-center">
      ${Object.entries(byEffect).map(([k, v]) => {
        const em = effectMeta(k);
        return `<div class="rounded-lg p-2 ${em.badge}"><div class="text-lg font-bold">${v}</div><div class="text-xs">${em.label}</div></div>`;
      }).join('')}
      <div class="rounded-lg p-2 bg-slate-100 text-slate-700"><div class="text-lg font-bold">${totalN.toLocaleString()}</div><div class="text-xs">Total participants</div></div>
    </div>
    <div class="overflow-x-auto rounded-lg border border-slate-100">
      <table class="w-full text-left min-w-[560px]">
        <thead class="bg-slate-50">
          <tr class="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <th class="py-2 px-3">Paper</th><th class="py-2 px-3">Year</th><th class="py-2 px-3">Effect</th>
            <th class="py-2 px-3">Domain</th><th class="py-2 px-3">N</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  document.getElementById('toast-icon').textContent = type === 'success' ? '✓' : '✗';
  document.getElementById('toast-msg').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal('card-modal');
  }
});
