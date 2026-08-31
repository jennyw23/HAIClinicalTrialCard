// ── Shared state, constants, and card-completeness scoring ─────────────────
let allCards = [];
let activeFilters = { studyTypePrimary: '', effectDirection: '' };
let selectedFile = null;

let filteredCardsCache = [];
let mapState = { x: 'interaction_task.task_domain', y: 'human_participants.domain_expertise', selected: null };
let compareState = { a: null, b: null, highlight: true };

const MAP_DIMENSIONS = [
  { key: 'interaction_task.task_domain', label: 'Task domain', multi: true, order: TASK_DOMAINS, normalize: normalizeTaskDomain },
  { key: 'human_participants.domain_expertise', label: 'Domain expertise', order: DOMAIN_EXPERTISE_LEVELS },
  { key: 'interaction_task.effect_direction', label: 'Effect direction', order: EFFECT_DIRECTIONS, normalize: normalizeEffect },
  // order comes from STUDY_TYPES (utils.js) so the axis can't drift from the data
  { key: 'study_type', label: 'Study type', multi: true, order: STUDY_TYPES, normalize: normalizeStudyType },
  { key: 'study_setting', label: 'Study setting', order: STUDY_SETTINGS },
  { key: 'human_participants.participant_type', label: 'Participant type', order: PARTICIPANT_TYPES },
  { key: 'interaction_task.automation_level', label: 'Automation level', order: AUTOMATION_LEVELS },
  { key: 'outcomes.primary_outcome_family', label: 'Outcome family', order: OUTCOME_FAMILIES },
  { key: 'ai_model.provider', label: 'AI provider' },
  { key: 'ai_model.model_version', label: 'Model generation', order: MODEL_GENERATIONS },
  // Raw model string: 30 values, 83% of them on a single card. Kept for looking
  // up a specific model, but 'Model generation' above is the legible axis.
  { key: 'ai_model.model_name', label: 'AI model (exact)' },
  { key: 'ai_model.fine_tuned', label: 'Fine-tuned', order: ['Yes', 'No'], normalize: normalizeBoolean },
];

const COMPARE_GROUPS = [
  { title: 'Study', color: '#475569', fields: [
    { label: 'Year', path: 'year' },
    { label: 'Study type', path: 'study_type' },
    { label: 'Randomized', path: 'randomized' },
    { label: 'Study setting', path: 'study_setting' },
    { label: 'Comparison type', path: 'comparison_type' },
    { label: 'Application sector', path: 'application_sector' },
    { label: 'Data collection period', path: 'human_participants.data_collection_period' },
  ]},
  { title: 'AI Model', color: '#1e3a5f', fields: [
    { label: 'Provider', path: 'ai_model.provider' },
    { label: 'Model name', path: 'ai_model.model_name' },
    { label: 'Model version', path: 'ai_model.model_version' },
    { label: 'Fine-tuned', path: 'ai_model.fine_tuned' },
    { label: 'Access method', path: 'ai_model.access_method' },
    { label: 'Configuration', path: 'ai_model.prompting_or_config' },
    { label: 'Key parameters', path: 'ai_model.key_parameters' },
    { label: 'Benchmarks reported', path: 'ai_model.benchmarks_reported' },
  ]},
  { title: 'Human Participants', color: '#0891b2', fields: [
    { label: 'Sample size (N)', path: 'human_participants.sample_size' },
    { label: 'Population', path: 'human_participants.population' },
    { label: 'Domain expertise', path: 'human_participants.domain_expertise' },
    { label: 'AI familiarity', path: 'human_participants.ai_familiarity' },
    { label: 'Training provided', path: 'human_participants.training_provided' },
  ]},
  { title: 'Interaction / Task', color: '#059669', fields: [
    { label: 'Task domain', path: 'interaction_task.task_domain' },
    { label: 'Interface', path: 'interaction_task.interface' },
    { label: 'AI role', path: 'interaction_task.ai_role' },
    { label: 'Automation level', path: 'interaction_task.automation_level' },
    { label: 'Task description', path: 'interaction_task.task_description' },
    { label: 'Experimental conditions', path: 'interaction_task.experimental_conditions' },
    { label: 'Primary outcomes', path: 'interaction_task.primary_outcomes' },
    { label: 'Prompting strategy', path: 'interaction_task.prompting_strategy' },
    { label: 'Effect direction', path: 'interaction_task.effect_direction' },
    { label: 'Main effects summary', path: 'interaction_task.main_effects_summary' },
  ]},
];

const NEAR_TWIN_FIELDS = [
  'study_type', 'randomized', 'study_setting', 'comparison_type', 'application_sector',
  'ai_model.provider', 'ai_model.model_name', 'ai_model.model_version',
  'ai_model.fine_tuned', 'ai_model.access_method',
  'human_participants.population',
  'human_participants.domain_expertise', 'human_participants.ai_familiarity',
  'human_participants.training_provided',
  'interaction_task.task_domain', 'interaction_task.interface', 'interaction_task.ai_role',
  'interaction_task.automation_level',
  'interaction_task.experimental_conditions', 'interaction_task.primary_outcomes',
  'interaction_task.prompting_strategy',
];

// ── Form option lists (mounted into empty containers) ────────────────────────
// Task-domain expertise and AI familiarity are different scales and now come
// from their own CSV-derived lists (utils.js). They previously shared one
// invented Low/Moderate/High list that matched neither CSV column.

const FORM_OPTIONS = {
  // Same canonical list the map and filters use — forms.js writes the checked
  // values straight into study_type, so offering the old labels here was what
  // let retired vocabulary back into the database.
  methodology: [...STUDY_TYPES, 'Not reported'],
  human_not_found: ['Sample Size', 'Population', 'Expertise Level', 'Domain Expertise', 'AI Familiarity', 'Training Provided'],
  // 'Other' reveals the f-provider-other free-text input, so a provider the
  // corpus hasn't seen yet can still be coded without inventing a fixed option.
  provider: [...AI_PROVIDERS, 'Not reported', 'Other'],
  // NOTE: model_type has no column in HAI_Studies_Master.csv, so the master
  // import never populates it and all current cards leave it empty. The list
  // below is legacy vocabulary from the retired Google-Form import
  // (db/import-csv.js 'Model Type'). Left in place rather than deleted because
  // removing the form field is a product decision, but it is NOT CSV-backed —
  // the CSV codes this territory as model_adaptation / deployment_vendor instead.
  model_type: ['Chatbot', 'Tutor', 'Copilot', 'Agent', 'Workflow Assistant', 'Decision Support System', 'Other'],
  access_method: ACCESS_METHODS,
  model_not_found: ['Provider', 'Model Name', 'Fine-Tuned', 'Access Method', 'Key Parameters', 'Benchmarks Reported', 'Config/Prompting'],
  task_domain: TASK_DOMAINS,
  // The CSV's comparison_conditions column is free text (papers name their own
  // arms), so this list is a set of common suggestions rather than a controlled
  // vocabulary — it is not validated against the sheet.
  comparison_conditions: [
    'No AI', 'AI Only', 'Human + AI', 'Human-only Teams', 'Human-AI Teams',
    'Copilot Enabled', 'Copilot Disabled', 'Other',
  ],
  task_not_found: ['Task Domain', 'Task Description', 'AI Role', 'Interaction', 'Comparison Conditions'],
  // CSV-backed: every value below appears in outcome_metrics_handcoded, which is
  // a comma-joined list drawn from exactly this vocabulary.
  outcome_metrics: [
    'Performance Quality', 'Productivity', 'Accuracy', 'Creativity', 'Learning Outcomes', 'Confidence',
    'Trust', 'Satisfaction', 'Collaboration Quality', 'Speed / Time', 'Revenue / Business Outcomes',
    'Retention', 'Self-reported Outcomes',
  ],
  results_not_found: [
    'Outcome Metrics', 'Effect Size', 'Effect Direction', 'Who Benefited', 'Main Effects Summary',
    'Heterogeneous Effects', 'Mechanisms',
  ],
};

function outcomeOf(card, key) {
  const o = card?.outcomes?.[key];
  if (o !== null && o !== undefined && o !== '' && !(Array.isArray(o) && o.length === 0)) return o;
  const t = card?.interaction_task || {};
  if (key === 'outcome_metrics') return t.primary_outcomes ?? null;
  if (key === 'effect_direction') return t.effect_direction ?? null;
  if (key === 'main_effects_summary') return t.main_effects_summary ?? null;
  if (key === 'author_proposed_mechanisms') return card?.author_proposed_mechanisms ?? null;
  return t[key] ?? null;
}
