// ── Submit-a-card form: option mounting, prefill, gather, upload, tabs ─────
function mountCheckGroup(id, name, options) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = options.map(opt =>
    `<label class="check-opt"><input type="checkbox" name="${name}" value="${opt.replace(/"/g, '&quot;')}" /> ${opt}</label>`
  ).join('');
}

function mountRadioGroup(id, name, options) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = options.map(opt =>
    `<label class="radio-opt"><input type="radio" name="${name}" value="${opt.replace(/"/g, '&quot;')}" /> ${opt}</label>`
  ).join('');
}

function getChecks(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
}

function setChecks(name, values) {
  const set = new Set(asList(values).map(v => String(v)));
  document.querySelectorAll(`input[name="${name}"]`).forEach(inp => {
    inp.checked = set.has(inp.value) || [...set].some(v => v.toLowerCase() === inp.value.toLowerCase());
    inp.closest('.check-opt')?.classList.toggle('selected', inp.checked);
  });
}

function mountFormOptions() {
  mountCheckGroup('cg-methodology', 'methodology', FORM_OPTIONS.methodology);
  mountCheckGroup('cg-human-not-found', 'human_not_found', FORM_OPTIONS.human_not_found);
  mountRadioGroup('rg-provider', 'provider', FORM_OPTIONS.provider);
  mountRadioGroup('rg-model-type', 'model_type', FORM_OPTIONS.model_type);
  mountCheckGroup('cg-access', 'access_method', FORM_OPTIONS.access_method);
  mountCheckGroup('cg-model-not-found', 'model_not_found', FORM_OPTIONS.model_not_found);
  mountCheckGroup('cg-task-domain', 'task_domain', FORM_OPTIONS.task_domain);
  mountCheckGroup('cg-comparison', 'comparison_conditions', FORM_OPTIONS.comparison_conditions);
  mountCheckGroup('cg-task-not-found', 'task_not_found', FORM_OPTIONS.task_not_found);
  mountCheckGroup('cg-outcome-metrics', 'outcome_metrics', FORM_OPTIONS.outcome_metrics);
  mountCheckGroup('cg-results-not-found', 'results_not_found', FORM_OPTIONS.results_not_found);
  mountRadioGroup('rg-expertise', 'expertise', EXPERTISE_LEVELS);
  mountRadioGroup('rg-ai-familiarity', 'ai_familiarity', EXPERTISE_LEVELS);

  // Toggle Other text inputs
  document.querySelectorAll('input[name="provider"]').forEach(inp => {
    inp.addEventListener('change', () => {
      document.getElementById('f-provider-other').classList.toggle('hidden', getRadio('provider') !== 'Other');
    });
  });
  document.querySelectorAll('input[name="model_type"]').forEach(inp => {
    inp.addEventListener('change', () => {
      document.getElementById('f-model-type-other').classList.toggle('hidden', getRadio('model_type') !== 'Other');
    });
  });
}

function setRadio(name, value) {
  if (value === null || value === undefined || value === '') {
    document.querySelectorAll(`input[name="${name}"]`).forEach(inp => {
      inp.checked = false;
      inp.closest('.radio-opt')?.classList.remove('selected');
    });
    return;
  }
  // Map legacy boolean / lowercase values
  let v = value;
  if (name === 'finetuned' || name === 'benchmarks') {
    if (v === true || v === 'true') v = name === 'benchmarks' ? 'Yes' : 'Yes';
    if (v === false || v === 'false') v = 'No';
    if (v === null || v === 'null') v = name === 'finetuned' ? 'Not reported' : 'Not Reported';
  }
  if (name === 'airole') v = normalizeRole(v) || v;
  if (name === 'effect') v = normalizeEffect(v) || v;
  if (name === 'randomized' && typeof v === 'string') {
    const up = v.toUpperCase();
    if (up.startsWith('Y')) v = 'Yes';
    else if (up.startsWith('N')) v = 'No';
  }

  const inputs = document.querySelectorAll(`input[name="${name}"]`);
  let matched = false;
  inputs.forEach(inp => {
    const hit = inp.value === String(v) || inp.value.toLowerCase() === String(v).toLowerCase();
    inp.checked = hit;
    inp.closest('.radio-opt')?.classList.toggle('selected', hit);
    if (hit) matched = true;
  });
  if (!matched && name === 'provider' && v) {
    const other = [...inputs].find(i => i.value === 'Other');
    if (other) {
      other.checked = true;
      other.closest('.radio-opt')?.classList.add('selected');
      const otherInp = document.getElementById('f-provider-other');
      if (otherInp) { otherInp.value = String(v); otherInp.classList.remove('hidden'); }
    }
  }
  if (!matched && name === 'model_type' && v) {
    const other = [...inputs].find(i => i.value === 'Other');
    if (other) {
      other.checked = true;
      other.closest('.radio-opt')?.classList.add('selected');
      const otherInp = document.getElementById('f-model-type-other');
      if (otherInp) { otherInp.value = String(v); otherInp.classList.remove('hidden'); }
    }
  }
}

function getRadio(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  if (!el) return null;
  return el.value;
}

function prefillForm(data) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (Array.isArray(val)) el.value = val.join(', ');
    else el.value = val !== null && val !== undefined ? val : '';
  };

  set('f-study-id', data.study_id);
  setRadio('coder_name', data.coder_name);
  setRadio('needs_review', data.needs_review || (data.status === 'pending' ? 'Yes' : data.status === 'published' ? 'No' : null));

  set('f-title', data.paper_title);
  set('f-paper-url', data.paper_url);
  set('f-authors', data.authors);
  set('f-year', data.year);
  set('f-pub-type', data.publication_type);
  set('f-venue', data.publication_venue);

  const methodology = asList(data.methodology);
  if (!methodology.length && data.study_type) setChecks('methodology', asList(data.study_type));
  else setChecks('methodology', methodology);
  set('f-period', data.human_participants?.data_collection_period || data.data_collection_period);
  setRadio('randomized', data.randomized);

  const m = data.ai_model || {};
  setRadio('provider', m.provider);
  set('f-ai-model', m.model_name);
  setRadio('model_type', m.model_type);
  setRadio('finetuned', m.fine_tuned);
  setChecks('access_method', m.access_method);
  set('f-ai-params', m.key_parameters);
  setRadio('benchmarks', m.benchmarks_reported);
  setRadio('guardrails', m.guardrails_present);
  set('f-ai-config', m.configuration_setup || m.prompting_or_config);
  setChecks('model_not_found', m.model_not_found);

  const h = data.human_participants || {};
  set('f-n', h.sample_size);
  set('f-population', h.population);
  setRadio('expertise', h.expertise_level);
  setRadio('ai_familiarity', h.ai_familiarity);
  const trainingKnown = ['Yes', 'No', 'Partial', 'Unclear'];
  if (h.training_provided && trainingKnown.includes(h.training_provided)) {
    setRadio('training_provided', h.training_provided);
  } else if (h.training_provided) {
    set('f-training-desc', h.training_description || h.training_provided);
  }
  if (h.training_description) set('f-training-desc', h.training_description);
  setChecks('human_not_found', h.human_not_found);

  const t = data.interaction_task || {};
  setChecks('task_domain', t.task_domain);
  set('f-task-desc', t.task_description);
  setRadio('airole', t.ai_role);
  set('f-interaction-notes', t.interaction_notes);
  const comps = asList(t.comparison_conditions).length ? asList(t.comparison_conditions) : asList(t.experimental_conditions);
  const knownComps = new Set(FORM_OPTIONS.comparison_conditions);
  const known = comps.filter(c => knownComps.has(c));
  const otherComps = comps.filter(c => !knownComps.has(c) && c !== 'Other');
  setChecks('comparison_conditions', known.length ? known : comps);
  if (otherComps.length) {
    setChecks('comparison_conditions', [...known, 'Other']);
    set('f-comparison-other', otherComps.join(', '));
  }
  setChecks('task_not_found', t.task_not_found);

  const o = data.outcomes || {};
  setChecks('outcome_metrics', o.outcome_metrics || t.primary_outcomes);
  setRadio('effect', o.effect_direction || t.effect_direction);
  set('f-effect-size', o.effect_size);
  set('f-outcome-se', o.outcome_standard_error);
  set('f-who-benefited', o.who_benefited);
  set('f-effects-summary', o.main_effects_summary || t.main_effects_summary);
  setRadio('heterogeneous_effects', o.heterogeneous_effects);
  setChecks('results_not_found', o.results_not_found);
  set('f-mechanisms', o.author_proposed_mechanisms || data.author_proposed_mechanisms);
  set('f-human-explain', o.human_characteristics_explain);
  set('f-ai-explain', o.ai_characteristics_explain);
  set('f-workflow-explain', o.workflow_features_explain);
  set('f-noteworthy', o.noteworthy);
}

function gatherFormData() {
  const txt = (id) => document.getElementById(id)?.value.trim() || null;
  const num = (id) => { const v = document.getElementById(id)?.value; return v ? parseInt(v, 10) : null; };
  const arr = (id) => {
    const v = document.getElementById(id)?.value.trim();
    return v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
  };

  const methodology = getChecks('methodology');
  const providerRadio = getRadio('provider');
  const provider = providerRadio === 'Other' ? (txt('f-provider-other') || 'Other') : providerRadio;
  const modelTypeRadio = getRadio('model_type');
  const model_type = modelTypeRadio === 'Other' ? (txt('f-model-type-other') || 'Other') : modelTypeRadio;

  let comparison = getChecks('comparison_conditions');
  const otherCond = txt('f-comparison-other');
  if (otherCond) {
    comparison = comparison.filter(c => c !== 'Other');
    comparison.push(otherCond);
  }

  const outcome_metrics = getChecks('outcome_metrics');
  const effect_direction = getRadio('effect');
  const main_effects_summary = txt('f-effects-summary');
  const coder = getRadio('coder_name');
  const needs_review = getRadio('needs_review') || 'No';

  return {
    study_id: txt('f-study-id'),
    coder_name: coder,
    needs_review,
    status: needs_review === 'Yes' ? 'pending' : 'published',
    submitted_by: coder || null,
    paper_title: txt('f-title'),
    paper_url: txt('f-paper-url'),
    authors: arr('f-authors'),
    year: num('f-year'),
    publication_type: txt('f-pub-type'),
    publication_venue: txt('f-venue'),
    methodology,
    study_type: methodology.join(', ') || null,
    randomized: getRadio('randomized'),
    ai_model: {
      provider,
      model_name: txt('f-ai-model'),
      model_type,
      fine_tuned: getRadio('finetuned'),
      access_method: getChecks('access_method'),
      key_parameters: txt('f-ai-params'),
      benchmarks_reported: getRadio('benchmarks'),
      guardrails_present: getRadio('guardrails'),
      configuration_setup: txt('f-ai-config'),
      prompting_or_config: txt('f-ai-config'),
      model_not_found: getChecks('model_not_found'),
    },
    human_participants: {
      sample_size: num('f-n'),
      population: txt('f-population'),
      expertise_level: getRadio('expertise'),
      ai_familiarity: getRadio('ai_familiarity'),
      training_provided: getRadio('training_provided'),
      training_description: txt('f-training-desc'),
      data_collection_period: txt('f-period'),
      human_not_found: getChecks('human_not_found'),
    },
    interaction_task: {
      task_domain: getChecks('task_domain'),
      task_description: txt('f-task-desc'),
      ai_role: getRadio('airole'),
      interaction_notes: txt('f-interaction-notes'),
      comparison_conditions: comparison,
      experimental_conditions: comparison,
      task_not_found: getChecks('task_not_found'),
      primary_outcomes: outcome_metrics,
      main_effects_summary,
      effect_direction,
    },
    outcomes: {
      outcome_metrics,
      effect_size: txt('f-effect-size'),
      effect_direction,
      outcome_standard_error: txt('f-outcome-se'),
      who_benefited: txt('f-who-benefited'),
      main_effects_summary,
      heterogeneous_effects: getRadio('heterogeneous_effects'),
      results_not_found: getChecks('results_not_found'),
      author_proposed_mechanisms: txt('f-mechanisms'),
      human_characteristics_explain: txt('f-human-explain'),
      ai_characteristics_explain: txt('f-ai-explain'),
      workflow_features_explain: txt('f-workflow-explain'),
      noteworthy: txt('f-noteworthy'),
    },
  };
}

function resetForm() {
  ['f-study-id','f-title','f-paper-url','f-authors','f-year','f-pub-type','f-venue','f-period',
   'f-n','f-population','f-training-desc','f-provider-other','f-ai-model','f-model-type-other',
   'f-ai-params','f-ai-config','f-task-desc','f-interaction-notes','f-comparison-other',
   'f-effect-size','f-outcome-se','f-who-benefited','f-effects-summary','f-mechanisms',
   'f-human-explain','f-ai-explain','f-workflow-explain','f-noteworthy'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.querySelectorAll('#card-form-wrap input[type="checkbox"]').forEach(inp => {
    inp.checked = false;
    inp.closest('.check-opt')?.classList.remove('selected');
  });
  document.querySelectorAll('#card-form-wrap input[type="radio"]').forEach(inp => {
    inp.checked = false;
    inp.closest('.radio-opt')?.classList.remove('selected');
  });
  const nr = document.querySelector('input[name="needs_review"][value="No"]');
  if (nr) { nr.checked = true; nr.closest('.radio-opt')?.classList.add('selected'); }
  document.getElementById('f-provider-other')?.classList.add('hidden');
  document.getElementById('f-model-type-other')?.classList.add('hidden');
  document.getElementById('parse-success-banner').classList.add('hidden');
  document.getElementById('form-error').classList.add('hidden');
}

function showFormError(msg) {
  const el = document.getElementById('form-error');
  el.textContent = msg; el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function handleFileSelect(file) {
  if (!file) return;
  selectedFile = file;
  const nameEl = document.getElementById('file-name');
  nameEl.textContent = file.name; nameEl.classList.remove('hidden');
  document.getElementById('parse-btn').disabled = false;
  document.getElementById('parse-error').classList.add('hidden');
}

function handleDragOver(e) { e.preventDefault(); document.getElementById('drop-zone').classList.add('drag-over'); }
function handleDragLeave()  { document.getElementById('drop-zone').classList.remove('drag-over'); }
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelect(file);
}

function showParseLoading(show) {
  ['panel-pdf','panel-text','panel-manual'].forEach(id => document.getElementById(id).classList.toggle('hidden', show));
  document.getElementById('parse-loading').classList.toggle('hidden', !show);
}

function switchTab(tab) {
  ['pdf','text','manual'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`panel-${t}`).classList.toggle('hidden', t !== tab);
  });
}
