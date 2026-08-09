#!/usr/bin/env node
// Local-only DB audit tool. Connects directly to Neon and writes a self-contained
// HTML report of every field submitted through the Google Form / submit form —
// nothing here is deployed or served by the website. Open the output file
// directly in a browser (no server needed).
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Did you run `vercel env pull .env.local`?');
  process.exit(1);
}

/** All Google Form / CSV columns for the audit view. */
const DB_TABLE_COLUMNS = [
  'Timestamp',
  'Email Address',
  'Study ID',
  'Coder Name',
  'Needs Review?',
  'Paper Title',
  'Paper URL',
  'Authors (comma-separated)',
  'Year',
  'Publication Type',
  'Publication Venue (ex. HBS Working Paper Nature NBER arXiv)',
  'Methodology',
  'Randomized?',
  'Sample Size (N)',
  'Describe participant population and relevant background. (ex. Entrepreneurs, MBA students, Software developers, High school students)',
  'Expertise Level',
  'AI Familiarity',
  'Training Provided',
  'Training / Instructions Description',
  'Not found in Methods? - human',
  'Provider',
  'Model Name',
  'Model Type',
  'Fine-Tuned?',
  'Access Method',
  'Key Parameters',
  'Benchmarks Reported',
  'Guardrails Present?',
  'AI Configuration / Setup',
  'Not found in Methods? - model',
  'Task Domain',
  'Task Description',
  'AI Role',
  'Interaction Notes',
  'Comparison Conditions',
  'Not found in Methods? - task',
  'Outcome Metrics',
  'Effect Size',
  'Effect Direction',
  'Outcome Standard Error',
  'Main Effects Summary',
  'Evidence of Heterogeneous Effects?',
  'Who Benefited More / Less?',
  'Author-Proposed Mechanisms',
  'Not found in Methods? - results',
  'What human characteristics may explain outcomes?',
  'What AI characteristics may explain outcomes?',
  'What workflow/task features may explain outcomes?',
  'Anything noteworthy or theoretically interesting.',
  'Data Collection Period',
  'In methods? - Human',
  'In methods? - Metada',
  'In methods? - AI',
  'In methods? - Task',
  'In methods? - Outcome',
];

/** Short labels for wide form headers in the table. */
const DB_TABLE_LABELS = {
  'Publication Venue (ex. HBS Working Paper Nature NBER arXiv)': 'Publication Venue',
  'Describe participant population and relevant background. (ex. Entrepreneurs, MBA students, Software developers, High school students)': 'Population',
  'Authors (comma-separated)': 'Authors',
  'Training / Instructions Description': 'Training Description',
  'Not found in Methods? - human': 'Not found (human)',
  'Not found in Methods? - model': 'Not found (model)',
  'Not found in Methods? - task': 'Not found (task)',
  'Not found in Methods? - results': 'Not found (results)',
  'What human characteristics may explain outcomes?': 'Human characteristics',
  'What AI characteristics may explain outcomes?': 'AI characteristics',
  'What workflow/task features may explain outcomes?': 'Workflow features',
  'Anything noteworthy or theoretically interesting.': 'Noteworthy',
  'Evidence of Heterogeneous Effects?': 'Heterogeneous Effects?',
  'Who Benefited More / Less?': 'Who Benefited',
  'Author-Proposed Mechanisms': 'Author Mechanisms',
  'In methods? - Metada': 'In methods? - Metadata',
};

function asList(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.filter(x => x != null && String(x).trim() !== '');
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}

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

/** Fields shown on cards/modal only — clean display subset, needed for dbCellValue fallbacks. */
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

function formRawLookup(raw, col) {
  if (!raw) return null;
  if (raw[col] != null && raw[col] !== '') return raw[col];
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const target = norm(col);
  for (const [k, v] of Object.entries(raw)) {
    if (norm(k) === target && v != null && v !== '') return v;
  }
  for (const [k, v] of Object.entries(raw)) {
    if (String(k).trim() === col && v != null && v !== '') return v;
  }
  return null;
}

/** Structured fallbacks when form_raw is missing (e.g. website-submitted cards). */
function dbCellValue(card, col) {
  const rawVal = formRawLookup(card.form_raw, col);
  if (rawVal != null && rawVal !== '') return rawVal;

  const d = mainDbFields(card);
  const map = {
    'Timestamp': card.form_timestamp || card.submitted_at,
    'Email Address': card.form_email,
    'Study ID': card.study_id || d.paper_id,
    'Coder Name': card.coder_name || card.submitted_by,
    'Needs Review?': d.needs_review,
    'Paper Title': card.paper_title,
    'Paper URL': card.paper_url,
    'Authors (comma-separated)': d.authors,
    'Year': card.year,
    'Publication Type': card.publication_type,
    'Publication Venue (ex. HBS Working Paper Nature NBER arXiv)': card.publication_venue,
    'Methodology': d.methodology,
    'Randomized?': card.randomized,
    'Sample Size (N)': d.sample_size,
    'Describe participant population and relevant background. (ex. Entrepreneurs, MBA students, Software developers, High school students)': d.population,
    'Expertise Level': d.expertise_level,
    'AI Familiarity': d.ai_familiarity,
    'Training Provided': d.training_provided,
    'Training / Instructions Description': card.human_participants?.training_description,
    'Not found in Methods? - human': card.human_participants?.human_not_found,
    'Provider': d.provider,
    'Model Name': d.model_name,
    'Model Type': d.model_type,
    'Fine-Tuned?': card.ai_model?.fine_tuned,
    'Access Method': d.access_method,
    'Key Parameters': card.ai_model?.key_parameters,
    'Benchmarks Reported': card.ai_model?.benchmarks_reported,
    'Guardrails Present?': card.ai_model?.guardrails_present,
    'AI Configuration / Setup': card.ai_model?.configuration_setup || card.ai_model?.prompting_or_config,
    'Not found in Methods? - model': card.ai_model?.model_not_found,
    'Task Domain': d.task_domain,
    'Task Description': card.interaction_task?.task_description,
    'AI Role': d.ai_role,
    'Interaction Notes': card.interaction_task?.interaction_notes,
    'Comparison Conditions': d.comparison_conditions,
    'Not found in Methods? - task': card.interaction_task?.task_not_found,
    'Outcome Metrics': d.outcome_metrics,
    'Effect Size': card.outcomes?.effect_size,
    'Effect Direction': d.effect_direction,
    'Outcome Standard Error': card.outcomes?.outcome_standard_error,
    'Main Effects Summary': d.main_effects_summary,
    'Evidence of Heterogeneous Effects?': card.outcomes?.heterogeneous_effects,
    'Who Benefited More / Less?': card.outcomes?.who_benefited,
    'Author-Proposed Mechanisms': d.author_proposed_mechanisms,
    'Not found in Methods? - results': card.outcomes?.results_not_found,
    'What human characteristics may explain outcomes?': card.outcomes?.human_characteristics_explain,
    'What AI characteristics may explain outcomes?': card.outcomes?.ai_characteristics_explain,
    'What workflow/task features may explain outcomes?': card.outcomes?.workflow_features_explain,
    'Anything noteworthy or theoretically interesting.': card.outcomes?.noteworthy,
    'Data Collection Period': d.data_collection_period,
    'In methods? - Human': card.in_methods?.human,
    'In methods? - Metada': card.in_methods?.metadata,
    'In methods? - AI': card.in_methods?.ai,
    'In methods? - Task': card.in_methods?.task,
    'In methods? - Outcome': card.in_methods?.outcome,
  };
  return map[col] ?? null;
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

function rowToCard(row) {
  return {
    paper_id: row.paper_id,
    paper_title: row.paper_title,
    status: row.status,
    created_by: row.created_by,
    ...row.data,
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
  };
}

function buildHtml(cards) {
  const thead = DB_TABLE_COLUMNS.map(col => {
    const label = DB_TABLE_LABELS[col] || col;
    return `<th title="${escHtml(col)}">${escHtml(label)}</th>`;
  }).join('');

  const tbody = cards.length
    ? cards.map(c => {
        const cells = DB_TABLE_COLUMNS.map(col => {
          const text = cell(dbCellValue(c, col));
          return `<td title="${escHtml(text)}">${escHtml(text)}</td>`;
        }).join('');
        return `<tr><td class="status status-${escHtml(c.status || 'published')}">${escHtml(c.status || 'published')}</td>${cells}</tr>`;
      }).join('')
    : `<tr><td colspan="${DB_TABLE_COLUMNS.length + 1}" class="empty">No records in the database.</td></tr>`;

  const generatedAt = new Date().toLocaleString();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Neon DB Audit — HAI Clinical Trial Cards</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, Inter, sans-serif; background: #f8fafc; color: #1e293b; }
  header { padding: 1rem 1.5rem; background: #1e3a5f; color: white; }
  header h1 { margin: 0 0 0.25rem; font-size: 1.1rem; }
  header p { margin: 0; font-size: 0.8rem; color: #bfdbfe; }
  .wrap { overflow: auto; max-height: calc(100vh - 70px); }
  table { border-collapse: separate; border-spacing: 0; font-size: 0.72rem; min-width: 100%; white-space: nowrap; }
  th, td { border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; padding: 0.4rem 0.55rem; text-align: left; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
  th { position: sticky; top: 0; background: #f1f5f9; color: #475569; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; font-size: 0.62rem; z-index: 1; }
  td.status { font-weight: 700; text-transform: capitalize; }
  td.status-published { color: #059669; }
  td.status-pending { color: #d97706; }
  tr:hover td { background: #f0f7ff; }
  td.empty { text-align: center; color: #94a3b8; padding: 3rem; }
</style>
</head>
<body>
<header>
  <h1>Neon DB Audit — HAI Clinical Trial Cards</h1>
  <p>${cards.length} row${cards.length === 1 ? '' : 's'} · ${DB_TABLE_COLUMNS.length} columns · generated ${escHtml(generatedAt)} · run <code>npm run db:audit</code> to refresh</p>
</header>
<div class="wrap">
  <table>
    <thead><tr><th>Status</th>${thead}</tr></thead>
    <tbody>${tbody}</tbody>
  </table>
</div>
</body>
</html>`;
}

(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`SELECT * FROM cards ORDER BY paper_id`;
  const cards = rows.map(rowToCard);
  const outPath = path.join(__dirname, '..', 'db-audit.html');
  fs.writeFileSync(outPath, buildHtml(cards));
  console.log(`Wrote ${cards.length} row(s) to ${outPath}`);
  console.log(`Open it directly in a browser: file://${outPath}`);
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
