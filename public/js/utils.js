// ── Generic helpers, normalization, and formatting utilities ──────────────
function getField(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
}

function asList(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.filter(x => x != null && String(x).trim() !== '');
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}

function cell(v) {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join('; ') : '—';
  return String(v);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeLower(value) {
  const text = normalizeText(value);
  return text ? text.toLowerCase() : null;
}

// Folds an ai_familiarity value onto AI_FAMILIARITY_LEVELS (CSV: ai_familiarity).
// Note this is AI familiarity, not task-domain expertise — domain_expertise uses
// DOMAIN_EXPERTISE_LEVELS and needs no normalization (the CSV values are exact).
function normalizeAiFamiliarity(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === 'mixed' || lower === 'heterogeneous' || lower === 'moderate') return 'Mixed';
  if (lower === 'low') return 'Low';
  if (lower === 'high') return 'High';
  if (lower === 'not reported' || lower === 'unclear' || lower === 'unknown') return 'Not Reported';
  return text;
}

function normalizeTaskDomain(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const key = text.toLowerCase().replace(/\s+/g, ' ');
  const aliases = {
    'software': 'Software Development',
    'software development': 'Software Development',
    'education': 'Education',
    'healthcare': 'Healthcare',
    'entrepreneurship': 'Entrepreneurship',
    'writing': 'Writing',
    'knowledge work': 'Knowledge Work',
    'teamwork & collaboration': 'Teamwork & Collaboration',
    'teamwork and collaboration': 'Teamwork & Collaboration',
    'customer service': 'Customer Service',
    'research': 'Research',
    'decision-making': 'Decision-Making',
    'decision making': 'Decision-Making',
    'design': 'Design',
    'marketing': 'Marketing',
    'operations': 'Operations',
    'finance': 'Finance',
  };
  return aliases[key] || titleCase(text);
}

// ── Controlled vocabularies ─────────────────────────────────────────────────
// Every list here is transcribed from a coded column of the audit sheet
// (gitignore/HAI_Studies_Master.csv), which is the single source of truth for
// card values. Nothing in the UI may invent its own category names: the
// design-map axes, submission-form options and filter chips all derive from
// these constants. When a CSV column gains a value, add it HERE only.
//
// Keep each list in the CSV's own casing — cards store these strings verbatim,
// and the filters compare them with ===, so a casing drift silently matches
// nothing. checkVocabularies() (app.js) warns at load if a card carries a value
// that is missing from one of these lists.

// CSV: study_type_primary
const STUDY_TYPES = [
  'Randomized field experiment',
  'Randomized lab/online experiment',
  'Quasi-experiment',
  'Observational study',
];

// CSV: ai_provider_primary
const AI_PROVIDERS = [
  'OpenAI', 'Anthropic', 'Microsoft', 'Meta', 'Alibaba',
  'GitHub', 'Stability AI', 'Ant Group', 'micro1',
];

// CSV: access_method
const ACCESS_METHODS = [
  'Chat Interface', 'Web App', 'API', 'IDE Integration',
  'Embedded Workflow', 'Mobile App', 'Custom research interface', 'Not reported',
];

// CSV: task_domain_tags (pipe-separated, so a card carries several)
const TASK_DOMAINS = [
  'Knowledge Work', 'Writing', 'Decision-Making', 'Healthcare', 'Education',
  'Software Development', 'Marketing', 'Operations', 'Design',
  'Teamwork & Collaboration', 'Entrepreneurship', 'Customer Service',
  'Research', 'Finance',
];

// CSV: domain_expertise — participants' expertise in the TASK domain.
// Deliberately a different scale from AI_FAMILIARITY_LEVELS below; the two were
// previously mounted from one shared list, which offered neither field's values.
const DOMAIN_EXPERTISE_LEVELS = [
  'Novice', 'In training', 'Practitioner', 'Expert', 'Mixed by design',
];

// CSV: ai_familiarity — how familiar participants were with AI. Ordinal, not
// the same axis as domain expertise.
const AI_FAMILIARITY_LEVELS = ['Low', 'Mixed', 'High', 'Not Reported'];

// CSV: model_generation — ordinal, so the map axis is ordered by capability era
// rather than by frequency. Summarises ai_model_exact (V = 1.00 between them).
const MODEL_GENERATIONS = [
  'Gen 1 — pre-instruction-tuned',
  'Gen 2 — GPT-3.5 class',
  'Gen 3 — GPT-4 class',
  'Gen 4 — reasoning models',
  'Image generation',
  'Mixed generations',
  'Undisclosed',
];

// CSV: automation_level — ordinal L1..L4, how much of the task the AI carried.
const AUTOMATION_LEVELS = [
  'L1 — On-demand tool',
  'L2 — In-workflow suggestion',
  'L3 — Draft generator',
  'L4 — Delegated with sign-off',
  'Varies by arm',
];

// CSV: study_setting — ordered most naturalistic to most controlled.
const STUDY_SETTINGS = [
  'In the field',
  'Simulated professional task',
  'Online panel task',
  'Laboratory',
  'Hybrid / multi-study',
];

// CSV: primary_outcome_family — what the study actually measured.
const OUTCOME_FAMILIES = [
  'Output quality',
  'Productivity & speed',
  'Accuracy & error',
  'Creativity & novelty',
  'Learning & skill retention',
  'Perceptions & self-reported experience',
  'Wellbeing & affect',
  'Business & labour-market outcomes',
];

// CSV: participant_type — who the participants were (distinct from
// DOMAIN_EXPERTISE_LEVELS, which is how expert they were).
// NOTE: db/import-master-csv.js must map this column for the dimension to have
// data; cards imported before that mapping was added carry no participant_type.
const PARTICIPANT_TYPES = [
  'Professional',
  'Student / trainee',
  'Mixed student/professional',
  'General population',
  'Patient',
  'Mixed patient/professional',
  'Other / not reported',
];

// CSV: training_provided
const TRAINING_PROVIDED = ['Yes', 'No', 'Instructions only', 'Unclear', 'Not reported'];

// CSV: effect_direction. The sheet distinguishes a PRECISE null (a tight
// interval around zero — a real finding) from an INCONCLUSIVE one (underpowered,
// absence of evidence). Collapsing them into a single "Null / No Effect" bucket
// discards that, so both are kept as separate values here.
const EFFECT_DIRECTIONS = [
  'Positive',
  'Negative',
  'Mixed across primary outcomes',
  'Null — precise',
  'Null — inconclusive',
  'Other',
];

function normalizeStudyType(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const key = text.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Canonical values map to themselves; the rest are legacy labels from the
  // pre-audit vocabulary, still folded in so older cards land in the right bucket
  // instead of falling through to titleCase() and inventing a new axis value.
  const aliases = {
    // current vocabulary
    'randomized field experiment': 'Randomized field experiment',
    'randomized lab/online experiment': 'Randomized lab/online experiment',
    'quasi experiment': 'Quasi-experiment',
    'observational study': 'Observational study',
    // legacy vocabulary -> current
    'field experiment': 'Randomized field experiment',
    'rct': 'Randomized field experiment',
    'randomized controlled trial': 'Randomized field experiment',
    'randomized controlled trial (rct)': 'Randomized field experiment',
    'lab experiment': 'Randomized lab/online experiment',
    'laboratory experiment': 'Randomized lab/online experiment',
    'randomized lab experiment': 'Randomized lab/online experiment',
    'online experiment': 'Randomized lab/online experiment',
    'survey experiment': 'Randomized lab/online experiment',
    'quasi experimental': 'Quasi-experiment',
    'natural experiment': 'Quasi-experiment',
    'observational': 'Observational study',
    // a submitter may genuinely not be able to tell; keep it as one value
    'not reported': 'Not reported',
    'unclear': 'Not reported',
    'unknown': 'Not reported',
  };
  // Unrecognized types are surfaced verbatim rather than titleCased: a value that
  // reaches here is a vocabulary gap worth seeing as-is, not one worth reformatting.
  return aliases[key] || text;
}

function normalizeBoolean(value) {
  if (value === true || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'yes') return 'Yes';
  if (value === false || String(value).toLowerCase() === 'false' || String(value).toLowerCase() === 'no') return 'No';
  return null;
}

function titleCase(value) {
  return String(value).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function isMissingValue(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function normalizeComparisonValue(value) {
  if (isMissingValue(value)) return null;
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim().toLowerCase()).filter(Boolean).sort().join('|');
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

function comparisonValuesEqual(a, b) {
  return normalizeComparisonValue(a) === normalizeComparisonValue(b);
}

function displayComparisonValue(value, path) {
  if (isMissingValue(value)) return '—';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (path === 'human_participants.sample_size' && Number.isFinite(Number(value))) return Number(value).toLocaleString();
  if (path === 'interaction_task.effect_direction') return normalizeEffect(value) || titleCase(value);
  if (path === 'study_type') return normalizeStudyType(value) || titleCase(value);
  if (path === 'interaction_task.ai_role') return titleCase(value);
  return String(value);
}

function normalizeEffect(dir) {
  if (dir == null || dir === '') return '';
  const d = String(dir).toLowerCase().trim().replace(/\s+/g, ' ');
  // Returns a value from EFFECT_DIRECTIONS (the CSV effect_direction vocabulary).
  // Exact CSV values first, then legacy/short labels folded onto them.
  if (d === 'positive') return 'Positive';
  if (d === 'negative') return 'Negative';
  if (d === 'mixed across primary outcomes') return 'Mixed across primary outcomes';
  if (d === 'other') return 'Other';
  // em dash, en dash or hyphen, depending on where the string has been through
  if (/^null\s*[—–-]\s*precise$/.test(d)) return 'Null — precise';
  if (/^null\s*[—–-]\s*inconclusive$/.test(d)) return 'Null — inconclusive';
  // legacy short labels
  if (d.includes('heterogeneous') || d.includes('mixed')) return 'Mixed across primary outcomes';
  if (d.includes('precise')) return 'Null — precise';
  // an unqualified "null"/"no effect" cannot be resolved to precise vs
  // inconclusive, so it takes the weaker of the two rather than claiming precision
  if (d.includes('null') || d.includes('no effect')) return 'Null — inconclusive';
  if (d === 'unclear' || d === 'unknown') return 'Other';
  return String(dir);
}

function normalizeRole(role) {
  if (!role) return '';
  const r = String(role).toLowerCase().trim();
  if (r.includes('semi')) return 'Semi-autonomous';
  if (r === 'autonomous') return 'Autonomous';
  if (r.includes('assist')) return 'Assistive';
  return String(role);
}

function mapValueKey(value) {
  return String(value).trim().toLowerCase();
}

function splitMapValues(value) {
  if (value === null || value === undefined || value === '') return [];
  const values = Array.isArray(value) ? value : String(value).split(/[,;|\n]+/);
  return values.map(normalizeText).filter(Boolean);
}
