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

function normalizeExpertise(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === 'mixed' || lower === 'heterogeneous') return 'Heterogeneous';
  if (lower === 'low') return 'Low';
  if (lower === 'moderate') return 'Moderate';
  if (lower === 'high') return 'High';
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
    'other': 'Other',
  };
  return aliases[key] || titleCase(text);
}

function normalizeStudyType(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const key = text.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const aliases = {
    'rct': 'Randomized Controlled Trial (RCT)',
    'randomized controlled trial': 'Randomized Controlled Trial (RCT)',
    'randomized controlled trial (rct)': 'Randomized Controlled Trial (RCT)',
    'field experiment': 'Field Experiment',
    'lab experiment': 'Lab Experiment',
    'laboratory experiment': 'Lab Experiment',
    'survey experiment': 'Survey Experiment',
    'quasi experimental': 'Quasi-Experimental',
    'observational': 'Observational Study',
    'observational study': 'Observational Study',
    'natural experiment': 'Natural Experiment',
    'case study': 'Case Study',
    'qualitative study': 'Qualitative Study',
    'mixed methods': 'Mixed Methods',
    'meta analysis': 'Meta-Analysis',
    'review paper': 'Review Paper',
    'not reported': 'Not Reported',
    'other': 'Other',
  };
  return aliases[key] || titleCase(text);
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
  if (path === 'study_type' || path === 'interaction_task.ai_role') return titleCase(value);
  return String(value);
}

function normalizeEffect(dir) {
  if (dir == null || dir === '') return '';
  const d = String(dir).toLowerCase().trim();
  // The audited effect_direction column uses full descriptive phrases per
  // study (e.g. "Mixed across primary outcomes", "Null — inconclusive"), not
  // a fixed short vocabulary — match by substring, not exact equality, or
  // most rows silently fail to bucket into any of the five filter chips.
  if (d === 'positive') return 'Positive';
  if (d === 'negative') return 'Negative';
  if (d.includes('heterogeneous') || d.includes('mixed')) return 'Heterogeneous';
  if (d.includes('null') || d.includes('no effect')) return 'Null / No Effect';
  if (d === 'unclear' || d === 'unknown' || d === 'other') return 'Unclear';
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
