// ── Card detail modal + complete-card modal ─────────────────────────────────
/** Fields shown on cards/modal only — clean display subset. */
function mainDbFields(card) {
  const methodology = asList(card.methodology).length ? asList(card.methodology) : card.study_type;
  const conditions = asList(card.interaction_task?.comparison_conditions).length
    ? asList(card.interaction_task?.comparison_conditions)
    : card.interaction_task?.experimental_conditions;
  return {
    doi: card.doi,
    abstract: card.abstract,
    paper_title: card.paper_title,
    authors: Array.isArray(card.authors) ? card.authors.join(', ') : (card.authors || ''),
    year: card.year,
    publication_venue: card.publication_venue,
    methodology,
    assignment_mechanism: card.assignment_mechanism,
    unit_of_randomization: card.unit_of_randomization,
    data_collection_period: card.human_participants?.data_collection_period || card.data_collection_period,
    sample_size: card.human_participants?.sample_size,
    population: card.human_participants?.population,
    population_normalized: card.human_participants?.population_normalized,
    domain_expertise: card.human_participants?.domain_expertise,
    ai_familiarity: card.human_participants?.ai_familiarity,
    ai_familiarity_measure: card.human_participants?.ai_familiarity_measure,
    provider: card.ai_model?.provider,
    model_name: card.ai_model?.model_name,
    access_method: card.ai_model?.access_method,
    fine_tuned: card.ai_model?.fine_tuned,
    key_parameters: card.ai_model?.key_parameters,
    configuration_setup: card.ai_model?.configuration_setup,
    task_domain: card.interaction_task?.task_domain,
    task_description: card.interaction_task?.task_description,
    comparison_conditions: conditions,
    primary_outcome_family: card.outcomes?.primary_outcome_family,
    primary_outcome: card.outcomes?.primary_outcome,
    effect_direction: outcomeOf(card, 'effect_direction'),
    estimate: card.outcomes?.estimate,
    estimate_type: card.outcomes?.estimate_type,
    units: card.outcomes?.units,
    se: card.outcomes?.se,
    ci_low: card.outcomes?.ci_low,
    ci_high: card.outcomes?.ci_high,
    p_value: card.outcomes?.p_value,
    who_benefited: card.outcomes?.who_benefited,
    main_effects_summary: outcomeOf(card, 'main_effects_summary'),
    author_proposed_mechanisms: outcomeOf(card, 'author_proposed_mechanisms'),
  };
}

function showCardModal(paperId) {
  const card = allCards.find(c => c.paper_id === paperId);
  if (!card) return;
  const em = effectMeta(outcomeOf(card, 'effect_direction'));
  const d = mainDbFields(card);

  const val = (v) => {
    if (v === null || v === undefined || v === '') return `<span class="missing">Not reported</span>`;
    if (Array.isArray(v)) return v.length ? v.join(', ') : `<span class="missing">Not reported</span>`;
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  };

  const row = (label, value, tooltipKey, tooltipVariant) => `
    <div class="py-2 border-b border-slate-50 last:border-0">
      <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">${label}${tooltipKey ? `<span data-tooltip="${tooltipKey}"${tooltipVariant ? ` data-tooltip-variant="${tooltipVariant}"` : ''}></span>` : ''}</p>
      <p class="text-sm text-slate-800">${val(value)}</p>
    </div>`;

  const abstractRow = (abstract) => {
    if (!abstract) return row('Abstract', null);
    const text = String(abstract).trim();
    const words = text.split(/\s+/);
    const body = words.length <= 20
      ? escHtml(text)
      : `<span class="abstract-short">${escHtml(words.slice(0, 20).join(' '))}&hellip;</span><span class="abstract-full hidden">${escHtml(text)}</span> <button type="button" class="text-[#2563eb] font-medium hover:underline" onclick="toggleAbstract(this)">More</button>`;
    return `
      <div class="py-2 border-b border-slate-50 last:border-0">
        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Abstract</p>
        <p class="text-sm text-slate-800">${body}</p>
      </div>`;
  };

  const doiRow = (doi) => {
    if (!doi) return row('DOI', null);
    const clean = String(doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
    const href = `https://doi.org/${clean}`;
    return `
      <div class="py-2 border-b border-slate-50 last:border-0">
        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">DOI</p>
        <p class="text-sm text-slate-800"><a href="${escHtml(href)}" target="_blank" rel="noopener" class="text-[#2563eb] hover:underline">doi.org/${escHtml(clean)}</a></p>
      </div>`;
  };

  const estimateRow = (d) => {
    if (d.estimate === null || d.estimate === undefined || d.estimate === '') return row('Estimate', null, 'modal-estimate-caution', 'warn');
    let s = String(d.estimate);
    if (d.units) s += ` ${d.units}`;
    if (d.estimate_type) s += ` (${d.estimate_type})`;
    return row('Estimate', s, 'modal-estimate-caution', 'warn');
  };

  const uncertaintyRow = (d) => {
    const bits = [];
    if (d.ci_low !== null && d.ci_low !== undefined && d.ci_high !== null && d.ci_high !== undefined) bits.push(`95% CI [${d.ci_low}, ${d.ci_high}]`);
    else if (d.se !== null && d.se !== undefined && d.se !== '') bits.push(`SE = ${d.se}`);
    if (d.p_value !== null && d.p_value !== undefined && d.p_value !== '') bits.push(`p = ${d.p_value}`);
    return row('Uncertainty', bits.length ? bits.join(', ') : null, 'modal-estimate-caution', 'warn');
  };

  const outcomeMetricRow = (d) => {
    if (!d.primary_outcome_family && !d.primary_outcome) return row('Primary Outcome Metric', null);
    const s = d.primary_outcome ? `${d.primary_outcome_family || ''} - ${d.primary_outcome}`.trim() : d.primary_outcome_family;
    return row('Primary Outcome Metric', s);
  };

  document.getElementById('modal-content').innerHTML = `
    <div class="flex items-start justify-between mb-5">
      <div class="flex-1 pr-4">
        <div class="flex flex-wrap gap-1.5 mb-2">
          <span class="text-xs px-2 py-0.5 rounded-full font-medium ${em.badge}">${em.label} effect</span>
        </div>
        <h2 class="font-bold text-slate-900 text-lg leading-tight mb-1">${escHtml(d.paper_title || 'Untitled')}${d.year ? ` <span class="font-normal text-slate-400">(${escHtml(String(d.year))})</span>` : ''}</h2>
        <p class="text-sm text-slate-500">${escHtml(d.authors || '')}</p>
      </div>
      <button onclick="closeModal('card-modal')" class="text-slate-400 hover:text-slate-700 text-2xl leading-none flex-shrink-0">&times;</button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <div class="bg-slate-50 rounded-xl p-4">
        <h3 class="font-bold text-slate-700 text-xs uppercase tracking-widest mb-3">Study</h3>
        ${abstractRow(d.abstract)}
        ${doiRow(d.doi)}
        ${row('Publication Venue', d.publication_venue)}
        ${row('Methodology', d.methodology)}
        ${row('Assignment Mechanism', d.assignment_mechanism)}
        ${row('Unit of Randomization', d.unit_of_randomization)}
        ${row('Data Collection Period', d.data_collection_period)}
      </div>
      <div class="bg-cyan-50 rounded-xl p-4">
        <h3 class="font-bold text-[#0891b2] text-xs uppercase tracking-widest mb-3">Human Participants</h3>
        ${row('Sample Size (N)', d.sample_size)}
        ${row('Population', d.population)}
        ${row('Population (Normalized)', d.population_normalized)}
        ${row('Domain Expertise', d.domain_expertise)}
        ${row('AI Familiarity', d.ai_familiarity)}
        ${row('AI Familiarity Measure', d.ai_familiarity_measure)}
      </div>
      <div class="bg-[#f0f4ff] rounded-xl p-4">
        <h3 class="font-bold text-[#1e3a5f] text-xs uppercase tracking-widest mb-3">AI Model</h3>
        ${row('Provider', d.provider)}
        ${row('Model Name', d.model_name)}
        ${row('Access Method', d.access_method)}
        ${row('Fine-tuned', d.fine_tuned)}
        ${row('Key Parameters', d.key_parameters, 'modal-key-parameters')}
        ${row('Configuration / Prompting', d.configuration_setup)}
      </div>
      <div class="bg-green-50 rounded-xl p-4">
        <h3 class="font-bold text-[#059669] text-xs uppercase tracking-widest mb-3">Task &amp; Outcomes</h3>
        ${row('Task Domain', d.task_domain)}
        ${row('Task Description', d.task_description)}
        ${row('Comparison Conditions', d.comparison_conditions)}
        ${outcomeMetricRow(d)}
        ${row('Effect Direction', d.effect_direction)}
        ${estimateRow(d)}
        ${uncertaintyRow(d)}
        ${row('Who Benefited', d.who_benefited)}
      </div>
    </div>

    <div class="bg-rose-50 rounded-xl p-4 mb-4">
      ${row('Main Effects Summary', d.main_effects_summary)}
      ${row('Author Proposed Mechanisms', d.author_proposed_mechanisms)}
    </div>

    <div class="flex gap-3">
      <button onclick="closeModal('card-modal')" class="flex-1 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors">Close</button>
    </div>`;

  mountTooltips();
  openModal('card-modal');
}

function toggleAbstract(btn) {
  const p = btn.parentElement;
  const short = p.querySelector('.abstract-short');
  const full = p.querySelector('.abstract-full');
  short.classList.toggle('hidden');
  full.classList.toggle('hidden');
  btn.textContent = full.classList.contains('hidden') ? 'More' : 'Less';
}

function openModal(id)  { document.getElementById(id).classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { document.getElementById(id).classList.remove('open'); document.body.style.overflow = ''; }
