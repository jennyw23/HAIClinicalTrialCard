// ── Card detail modal + complete-card modal ─────────────────────────────────
/** Fields shown on cards/modal only — clean display subset. */
function mainDbFields(card) {
  const methodology = asList(card.methodology).length ? asList(card.methodology) : card.study_type;
  const conditions = asList(card.interaction_task?.comparison_conditions).length
    ? asList(card.interaction_task?.comparison_conditions)
    : card.interaction_task?.experimental_conditions;
  return {
    paper_id: card.study_id || card.paper_id,
    needs_review: card.needs_review || (card.status === 'pending' ? 'Yes' : 'No'),
    paper_title: card.paper_title,
    authors: Array.isArray(card.authors) ? card.authors.join(', ') : (card.authors || ''),
    year: card.year,
    publication_type: card.publication_type,
    methodology,
    data_collection_period: card.human_participants?.data_collection_period || card.data_collection_period,
    randomized: card.randomized,
    sample_size: card.human_participants?.sample_size,
    population: card.human_participants?.population,
    expertise_level: card.human_participants?.expertise_level,
    ai_familiarity: card.human_participants?.ai_familiarity,
    training_provided: card.human_participants?.training_provided,
    provider: card.ai_model?.provider,
    model_name: card.ai_model?.model_name,
    model_type: card.ai_model?.model_type,
    access_method: card.ai_model?.access_method,
    task_domain: card.interaction_task?.task_domain,
    ai_role: card.interaction_task?.ai_role,
    comparison_conditions: conditions,
    outcome_metrics: outcomeOf(card, 'outcome_metrics'),
    effect_direction: outcomeOf(card, 'effect_direction'),
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

  const row = (label, value) => `
    <div class="py-2 border-b border-slate-50 last:border-0">
      <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">${label}</p>
      <p class="text-sm text-slate-800">${val(value)}</p>
    </div>`;

  document.getElementById('modal-content').innerHTML = `
    <div class="flex items-start justify-between mb-5">
      <div class="flex-1 pr-4">
        <div class="flex flex-wrap gap-1.5 mb-2">
          <span class="text-xs px-2 py-0.5 rounded-full font-medium ${em.badge}">${em.label} effect</span>
          ${d.year ? `<span class="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">${d.year}</span>` : ''}
          ${d.paper_id ? `<span class="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">ID ${escHtml(String(d.paper_id))}</span>` : ''}
          ${d.needs_review === 'Yes' ? `<span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">Needs review</span>` : ''}
        </div>
        <h2 class="font-bold text-slate-900 text-lg leading-tight mb-1">${escHtml(d.paper_title || 'Untitled')}</h2>
        <p class="text-sm text-slate-500">${escHtml(d.authors || '')}</p>
      </div>
      <button onclick="closeModal('card-modal')" class="text-slate-400 hover:text-slate-700 text-2xl leading-none flex-shrink-0">&times;</button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <div class="bg-slate-50 rounded-xl p-4">
        <h3 class="font-bold text-slate-700 text-xs uppercase tracking-widest mb-3">Study</h3>
        ${row('DOI', d.paper_id)}
        ${row('Paper Title', d.paper_title)}
        ${row('Author', d.authors)}
        ${row('Year', d.year)}
        ${row('Publication Type', d.publication_type)}
        ${row('Methodology', d.methodology)}
        ${row('Data Collection Period', d.data_collection_period)}
        ${row('Randomized?', d.randomized)}
      </div>
      <div class="bg-cyan-50 rounded-xl p-4">
        <h3 class="font-bold text-[#0891b2] text-xs uppercase tracking-widest mb-3">Human Participants</h3>
        ${row('Sample Size (N)', d.sample_size)}
        ${row('Population', d.population)}
        ${row('Expertise Level', d.expertise_level)}
        ${row('AI Familiarity', d.ai_familiarity)}
        ${row('Training Provided', d.training_provided)}
      </div>
      <div class="bg-[#f0f4ff] rounded-xl p-4">
        <h3 class="font-bold text-[#1e3a5f] text-xs uppercase tracking-widest mb-3">AI Model</h3>
        ${row('Provider', d.provider)}
        ${row('Model Name', d.model_name)}
        ${row('Model Type', d.model_type)}
        ${row('Access Method', d.access_method)}
      </div>
      <div class="bg-green-50 rounded-xl p-4">
        <h3 class="font-bold text-[#059669] text-xs uppercase tracking-widest mb-3">Task &amp; Outcomes</h3>
        ${row('Task Domain', d.task_domain)}
        ${row('AI Role', d.ai_role)}
        ${row('Comparison Conditions', d.comparison_conditions)}
        ${row('Outcome Metrics', d.outcome_metrics)}
        ${row('Effect Direction', d.effect_direction)}
      </div>
    </div>

    <div class="bg-rose-50 rounded-xl p-4 mb-4">
      ${row('Main Effects Summary', d.main_effects_summary)}
      ${row('Author Proposed Mechanisms', d.author_proposed_mechanisms)}
    </div>

    <div class="flex gap-3">
      <button onclick="closeModal('card-modal')" class="flex-1 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors">Close</button>
    </div>`;

  openModal('card-modal');
}

function openCompleteModal(paperId) {
  const card = allCards.find(c => c.paper_id === paperId);
  if (!card) return;
  completingCardId = paperId;
  const { missing } = getCompleteness(card);

  const labelMap = {
    'Study ID': 'study_id', 'Paper title': 'paper_title', 'Authors': 'authors', 'Year': 'year',
    'Methodology': 'methodology', 'AI provider': 'ai_model.provider', 'AI model name': 'ai_model.model_name',
    'Access method': 'ai_model.access_method', 'Sample size': 'human_participants.sample_size',
    'Population': 'human_participants.population', 'Expertise level': 'human_participants.expertise_level',
    'AI familiarity': 'human_participants.ai_familiarity', 'Task domain': 'interaction_task.task_domain',
    'AI role': 'interaction_task.ai_role',
    'Effects summary': 'outcomes.main_effects_summary', 'Effect direction': 'outcomes.effect_direction',
  };

  const fieldsHTML = missing.map(label => {
    const field = labelMap[label] || label;
    return `<div>
      <label class="lbl">${label}</label>
      <input type="text" class="inp" data-field="${field}" placeholder="Enter value..." />
    </div>`;
  }).join('');

  document.getElementById('complete-form-fields').innerHTML = fieldsHTML || '<p class="text-sm text-slate-500">This card is already complete.</p>';
  document.getElementById('complete-error').classList.add('hidden');
  openModal('complete-modal');
}

function openModal(id)  { document.getElementById(id).classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { document.getElementById(id).classList.remove('open'); document.body.style.overflow = ''; }
