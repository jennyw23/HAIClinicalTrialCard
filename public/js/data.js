// ── Shared state, constants, and card-completeness scoring ─────────────────
let allCards = [];
let activeFilters = { effect: '', role: '', expertise: '', domain: '', study: '' };
let selectedFile = null;
let completingCardId = null;

let filteredCardsCache = [];
let mapState = { x: 'interaction_task.task_domain', y: 'human_participants.expertise_level', selected: null };
let compareState = { a: null, b: null, highlight: true };

const MAP_DIMENSIONS = [
  { key: 'interaction_task.task_domain', label: 'Task domain', multi: true, normalize: normalizeTaskDomain },
  { key: 'human_participants.expertise_level', label: 'Participant expertise', order: ['Low', 'Moderate', 'High', 'Heterogeneous'], normalize: normalizeExpertise },
  { key: 'interaction_task.ai_role', label: 'AI role', order: ['assistive', 'semi-autonomous', 'autonomous'], normalize: normalizeLower },
  { key: 'interaction_task.effect_direction', label: 'Effect direction', order: ['positive', 'mixed', 'negative'], normalize: normalizeLower },
  { key: 'study_type', label: 'Study type', multi: true, order: ['Lab Experiment', 'Field Experiment', 'Randomized Controlled Trial (RCT)', 'Quasi-Experimental', 'Observational Study', 'Other'], normalize: normalizeStudyType },
  { key: 'ai_model.provider', label: 'AI provider' },
  { key: 'ai_model.model_name', label: 'AI model' },
  { key: 'ai_model.fine_tuned', label: 'Fine-tuned', order: ['Yes', 'No'], normalize: normalizeBoolean },
];

const COMPARE_GROUPS = [
  { title: 'Study', color: '#475569', fields: [
    { label: 'Year', path: 'year' },
    { label: 'Study type', path: 'study_type' },
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
    { label: 'Expertise level', path: 'human_participants.expertise_level' },
    { label: 'Domain expertise', path: 'human_participants.domain_expertise' },
    { label: 'AI familiarity', path: 'human_participants.ai_familiarity' },
    { label: 'Training provided', path: 'human_participants.training_provided' },
    { label: 'Data collection period', path: 'human_participants.data_collection_period' },
  ]},
  { title: 'Interaction / Task', color: '#059669', fields: [
    { label: 'Task domain', path: 'interaction_task.task_domain' },
    { label: 'Interface', path: 'interaction_task.interface' },
    { label: 'AI role', path: 'interaction_task.ai_role' },
    { label: 'Task description', path: 'interaction_task.task_description' },
    { label: 'Experimental conditions', path: 'interaction_task.experimental_conditions' },
    { label: 'Primary outcomes', path: 'interaction_task.primary_outcomes' },
    { label: 'Prompting strategy', path: 'interaction_task.prompting_strategy' },
    { label: 'Effect direction', path: 'interaction_task.effect_direction' },
    { label: 'Main effects summary', path: 'interaction_task.main_effects_summary' },
  ]},
];

const NEAR_TWIN_FIELDS = [
  'study_type',
  'ai_model.provider', 'ai_model.model_name', 'ai_model.model_version',
  'ai_model.fine_tuned', 'ai_model.access_method',
  'human_participants.population', 'human_participants.expertise_level',
  'human_participants.domain_expertise', 'human_participants.ai_familiarity',
  'human_participants.training_provided',
  'interaction_task.task_domain', 'interaction_task.interface', 'interaction_task.ai_role',
  'interaction_task.experimental_conditions', 'interaction_task.primary_outcomes',
  'interaction_task.prompting_strategy',
];

// ── Form option lists (mounted into empty containers) ────────────────────────
const EXPERTISE_LEVELS = ['Low', 'Low to Moderate', 'Moderate', 'Moderate to High', 'High', 'Heterogeneous', 'Not Reported'];

const FORM_OPTIONS = {
  methodology: [
    'Field Experiment', 'Randomized Controlled Trial (RCT)', 'Lab Experiment', 'Survey Experiment',
    'Observational Study', 'Natural Experiment', 'Case Study', 'Qualitative Study', 'Mixed Methods',
    'Meta-analysis', 'Review Paper', 'Not Reported',
  ],
  human_not_found: ['Sample Size', 'Population', 'Expertise Level', 'Domain Expertise', 'AI Familiarity', 'Training Provided'],
  provider: ['OpenAI', 'Anthropic', 'Google', 'Microsoft', 'Meta', 'Mistral', 'Open-source', 'Multiple', 'Not Reported', 'Other'],
  model_type: ['Chatbot', 'Tutor', 'Copilot', 'Agent', 'Workflow Assistant', 'Decision Support System', 'Other'],
  access_method: [
    'Chat Interface', 'API', 'IDE Integration', 'Embedded Workflow', 'Web App', 'Mobile App',
    'Voice Interface', 'Multimodal', 'Not Reported',
  ],
  model_not_found: ['Provider', 'Model Name', 'Fine-Tuned', 'Access Method', 'Key Parameters', 'Benchmarks Reported', 'Config/Prompting'],
  task_domain: [
    'Software Development', 'Education', 'Healthcare', 'Entrepreneurship', 'Writing', 'Knowledge Work',
    'Teamwork & Collaboration', 'Customer Service', 'Research', 'Decision-Making', 'Design', 'Marketing',
    'Operations', 'Finance',
  ],
  comparison_conditions: [
    'No AI', 'AI Only', 'Human + AI', 'Human-only Teams', 'Human-AI Teams',
    'AI + Process Overview', 'Copilot Enabled', 'Copilot Disabled', 'Other',
  ],
  task_not_found: ['Task Domain', 'Task Description', 'AI Role', 'Interaction', 'Comparison Conditions'],
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

// ── Key fields for completeness check ───────────────────────────────────────
const COMPLETENESS_FIELDS = [
  { path: 'study_id',                            label: 'Study ID' },
  { path: 'paper_title',                         label: 'Paper title' },
  { path: 'authors',                             label: 'Authors' },
  { path: 'year',                                label: 'Year' },
  { path: 'methodology',                         label: 'Methodology' },
  { path: 'ai_model.provider',                   label: 'AI provider' },
  { path: 'ai_model.model_name',                 label: 'AI model name' },
  { path: 'ai_model.access_method',              label: 'Access method' },
  { path: 'human_participants.sample_size',      label: 'Sample size' },
  { path: 'human_participants.population',       label: 'Population' },
  { path: 'human_participants.expertise_level',  label: 'Expertise level' },
  { path: 'human_participants.ai_familiarity',   label: 'AI familiarity' },
  { path: 'interaction_task.task_domain',        label: 'Task domain' },
  { path: 'interaction_task.ai_role',            label: 'AI role' },
  { path: 'outcomes.main_effects_summary',       label: 'Effects summary' },
  { path: 'outcomes.effect_direction',           label: 'Effect direction' },
];

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

function getCompleteness(card) {
  const missing = [];
  let filled = 0;
  for (const f of COMPLETENESS_FIELDS) {
    let val = getField(card, f.path);
    if ((val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) && f.path.startsWith('outcomes.')) {
      val = outcomeOf(card, f.path.slice('outcomes.'.length));
    }
    if ((val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) && f.path === 'methodology') {
      val = card.study_type || null;
    }
    const ok = val !== null && val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0);
    if (ok) filled++;
    else missing.push(f.label);
  }
  return { score: Math.round((filled / COMPLETENESS_FIELDS.length) * 100), missing };
}
