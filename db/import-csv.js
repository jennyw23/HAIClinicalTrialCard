#!/usr/bin/env node
/**
 * Import Google Sheets export (CSV) into the cards table.
 *
 * Usage:
 *   node db/import-csv.js                         # import db/sheets-export.csv
 *   node db/import-csv.js path/to/file.csv        # import a specific CSV
 *   node db/import-csv.js --dry-run               # map + print, no DB writes
 *   node db/import-csv.js --update                # upsert: update existing titles
 *
 * Requires DATABASE_URL in .env.local (unless --dry-run).
 * Safe default: insert new titles only; skip titles already in the DB.
 * With --update: overwrite matching paper_title rows with Sheet data.
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { neon } = require('@neondatabase/serverless');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const doUpdate = args.includes('--update');
const csvArg = args.find((a) => !a.startsWith('--'));
const csvPath = path.resolve(
  csvArg || path.join(__dirname, 'sheets-export.csv')
);

function clean(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function splitList(v) {
  const s = clean(v);
  if (!s) return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

function parseAuthors(v) {
  // Sheet stores "First Last, First Last, ..." inside one cell.
  return splitList(v);
}

function mapStudyType(methodology) {
  const m = (methodology || '').toLowerCase();
  if (m.includes('field experiment')) return 'field experiment';
  if (m.includes('lab experiment')) return 'lab experiment';
  if (m.includes('randomized controlled') || m.includes('(rct)')) {
    return 'randomized controlled trial';
  }
  if (m.includes('quasi')) return 'quasi-experimental';
  if (m.includes('observational') || m.includes('natural experiment')) {
    return 'observational';
  }
  return methodology ? 'other' : null;
}

function mapAiRole(role) {
  const r = (role || '').toLowerCase().trim();
  if (r.includes('semi')) return 'Semi-autonomous';
  if (r.includes('autonomous') && !r.includes('semi')) return 'Autonomous';
  if (r.includes('assist')) return 'Assistive';
  return clean(role);
}

function mapEffectDirection(dir) {
  const d = (dir || '').trim();
  const lower = d.toLowerCase();
  if (lower === 'positive') return 'Positive';
  if (lower === 'negative') return 'Negative';
  if (lower === 'mixed' || lower === 'heterogeneous') return 'Heterogeneous';
  if (lower.includes('null') || lower.includes('no effect')) return 'Null / No Effect';
  if (lower === 'unclear') return 'Unclear';
  return clean(dir);
}

function mapExpertise(level) {
  return clean(level);
}

function mapTraining(v) {
  const t = (clean(v) || '').toLowerCase();
  if (t === 'yes' || t === 'y') return 'Yes';
  if (t === 'no' || t === 'n') return 'No';
  if (t === 'partial') return 'Partial';
  if (t === 'unclear') return 'Unclear';
  return clean(v);
}

function mapFineTuned(v) {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const t = String(v).toLowerCase();
  if (t === 'yes' || t === 'true') return 'Yes';
  if (t === 'no' || t === 'false') return 'No';
  if (t.includes('not')) return 'Not reported';
  return clean(v);
}

function headerKey(row, ...candidates) {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const found = keys.find((k) => k.trim().toLowerCase() === c.toLowerCase());
    if (found != null && clean(row[found]) != null) return clean(row[found]);
  }
  // Fuzzy: strip punctuation / extra spaces
  for (const c of candidates) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const found = keys.find((k) => norm(k) === norm(c));
    if (found != null && clean(row[found]) != null) return clean(row[found]);
  }
  return null;
}

function rowToCard(row) {
  const paperTitle = headerKey(row, 'Paper Title', 'Paper Title ');
  if (!paperTitle) return null;

  const needsReviewRaw = headerKey(row, 'Needs Review?', 'Needs Review') || 'No';
  const needsReview = /^(y|yes)/i.test(needsReviewRaw.trim());
  const methodologyRaw = headerKey(row, 'Methodology');
  const methodology = splitList(methodologyRaw);
  const sampleRaw = headerKey(row, 'Sample Size (N)', 'Sample Size');
  const sampleSize = sampleRaw != null ? parseInt(String(sampleRaw).replace(/,/g, ''), 10) : null;
  const yearRaw = headerKey(row, 'Year');
  const year = yearRaw != null ? parseInt(yearRaw, 10) : null;
  const sheetId = headerKey(row, 'Paper ID', 'Study ID');
  const access = splitList(headerKey(row, 'Access Method'));
  const taskDomain = splitList(headerKey(row, 'Task Domain'));
  const comparison = splitList(headerKey(row, 'Comparison Conditions'));
  const outcomeMetrics = splitList(headerKey(row, 'Outcome Metrics'));
  const effectDirection = mapEffectDirection(headerKey(row, 'Effect Direction'));
  const mainEffects = headerKey(row, 'Main Effects Summary');
  const mechanisms = headerKey(row, 'Author Proposed Mechanisms', 'Author-Proposed Mechanisms');
  const population = headerKey(
    row,
    'Population',
    'Describe participant population and relevant background. (ex. Entrepreneurs, MBA students, Software developers, High school students)',
    'Describe participant population and relevant background'
  );
  const authors = parseAuthors(headerKey(row, 'Author', 'Authors', 'Authors (comma-separated)'));
  const coder = headerKey(row, 'Coder Name');

  const data = {
    study_id: sheetId,
    coder_name: coder,
    needs_review: needsReview ? 'Yes' : 'No',
    form_timestamp: headerKey(row, 'Timestamp'),
    form_email: headerKey(row, 'Email Address'),
    // Full Google Form row preserved exactly (all CSV columns).
    form_raw: Object.fromEntries(
      Object.entries(row).map(([k, v]) => [String(k).trim(), clean(v)])
    ),
    authors,
    year: Number.isFinite(year) ? year : null,
    paper_url: headerKey(row, 'Paper URL'),
    publication_type: headerKey(row, 'Publication Type'),
    publication_venue: headerKey(
      row,
      'Publication Venue',
      'Publication Venue (ex. HBS Working Paper Nature NBER arXiv)'
    ),
    methodology,
    study_type: methodology.join(', ') || mapStudyType(methodologyRaw),
    randomized: headerKey(row, 'Randomized?'),
    ai_model: {
      provider: headerKey(row, 'Provider'),
      model_name: headerKey(row, 'Model Name'),
      model_type: headerKey(row, 'Model Type'),
      fine_tuned: mapFineTuned(headerKey(row, 'Fine-Tuned?', 'Fine-Tuned')),
      access_method: access,
      key_parameters: headerKey(row, 'Key Parameters'),
      benchmarks_reported: headerKey(row, 'Benchmarks Reported'),
      guardrails_present: headerKey(row, 'Guardrails Present?', 'Guardrails Present'),
      configuration_setup: headerKey(row, 'AI Configuration / Setup', 'Config/Prompting'),
      prompting_or_config: headerKey(row, 'AI Configuration / Setup', 'Config/Prompting'),
      model_not_found: splitList(headerKey(row, 'Not found in Methods? - model', 'Not found in Methods? - model ')),
    },
    human_participants: {
      sample_size: Number.isFinite(sampleSize) ? sampleSize : null,
      population,
      expertise_level: mapExpertise(headerKey(row, 'Expertise Level')),
      ai_familiarity: headerKey(row, 'AI Familiarity'),
      training_provided: mapTraining(headerKey(row, 'Training Provided')),
      training_description: headerKey(row, 'Training / Instructions Description', 'Training / Instructions Description '),
      data_collection_period: headerKey(row, 'Data Collection Period'),
      human_not_found: splitList(headerKey(row, 'Not found in Methods? - human', 'Not found in Methods? - human ')),
    },
    interaction_task: {
      task_domain: taskDomain,
      task_description: headerKey(row, 'Task Description'),
      ai_role: mapAiRole(headerKey(row, 'AI Role')),
      interaction_notes: headerKey(row, 'Interaction Notes'),
      comparison_conditions: comparison,
      experimental_conditions: comparison,
      task_not_found: splitList(headerKey(row, 'Not found in Methods? - task')),
      primary_outcomes: outcomeMetrics,
      main_effects_summary: mainEffects,
      effect_direction: effectDirection,
    },
    outcomes: {
      outcome_metrics: outcomeMetrics,
      effect_size: headerKey(row, 'Effect Size', 'Effect Size '),
      effect_direction: effectDirection,
      outcome_standard_error: headerKey(row, 'Outcome Standard Error'),
      who_benefited: headerKey(row, 'Who Benefited More / Less?'),
      main_effects_summary: mainEffects,
      heterogeneous_effects: headerKey(row, 'Evidence of Heterogeneous Effects?'),
      author_proposed_mechanisms: mechanisms,
      results_not_found: splitList(headerKey(row, 'Not found in Methods? - results')),
      human_characteristics_explain: headerKey(row, 'What human characteristics may explain outcomes?'),
      ai_characteristics_explain: headerKey(row, 'What AI characteristics may explain outcomes?'),
      workflow_features_explain: headerKey(row, 'What workflow/task features may explain outcomes?'),
      noteworthy: headerKey(row, 'Anything noteworthy or theoretically interesting.'),
    },
    in_methods: {
      human: headerKey(row, 'In methods? - Human'),
      metadata: headerKey(row, 'In methods? - Metada', 'In methods? - Metadata'),
      ai: headerKey(row, 'In methods? - AI'),
      task: headerKey(row, 'In methods? - Task'),
      outcome: headerKey(row, 'In methods? - Outcome'),
    },
  };

  return {
    paper_id: sheetId != null ? parseInt(sheetId, 10) : null,
    paper_title: paperTitle,
    status: needsReview ? 'pending' : 'published',
    created_by: coder || headerKey(row, 'Email Address'),
    data,
  };
}

function loadCards() {
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
  });
  const cards = [];
  for (const row of rows) {
    const card = rowToCard(row);
    if (card) cards.push(card);
  }
  return cards;
}

(async () => {
  const cards = loadCards();
  console.log(`Parsed ${cards.length} row(s) from ${csvPath}`);

  if (dryRun) {
    for (const c of cards) {
      console.log(
        `- [${c.status}] ${c.paper_title}\n` +
          `    year=${c.data.year} study_type=${c.data.study_type} ` +
          `N=${c.data.human_participants.sample_size} ` +
          `effect=${c.data.interaction_task.effect_direction} ` +
          `authors=${c.data.authors.length}`
      );
    }
    console.log('Dry run only — no database changes.');
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error(
      'DATABASE_URL not set. Run `npx vercel env pull .env.local` ' +
        'or create .env.local with DATABASE_URL, then re-run.\n' +
        'You can also run with --dry-run to verify mapping without a DB.'
    );
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const c of cards) {
    const createdBy = c.created_by || null;
    if (doUpdate) {
      const result = await sql`
        INSERT INTO cards (paper_title, data, status, created_by)
        VALUES (${c.paper_title}, ${JSON.stringify(c.data)}::jsonb, ${c.status}, ${createdBy})
        ON CONFLICT (paper_title) DO UPDATE SET
          data       = EXCLUDED.data,
          status     = EXCLUDED.status,
          created_by = COALESCE(EXCLUDED.created_by, cards.created_by),
          updated_at = NOW()
        RETURNING (xmax = 0) AS is_insert
      `;
      if (result[0]?.is_insert) inserted++;
      else updated++;
    } else {
      const result = await sql`
        INSERT INTO cards (paper_title, data, status, created_by)
        VALUES (${c.paper_title}, ${JSON.stringify(c.data)}::jsonb, ${c.status}, ${createdBy})
        ON CONFLICT (paper_title) DO NOTHING
        RETURNING paper_id
      `;
      if (result.length) inserted++;
      else skipped++;
    }
  }

  await sql`SELECT setval(pg_get_serial_sequence('cards', 'paper_id'),
                          COALESCE((SELECT MAX(paper_id) FROM cards), 1))`;

  console.log(
    doUpdate
      ? `Import complete. Inserted: ${inserted}, updated: ${updated}.`
      : `Import complete. Inserted: ${inserted}, skipped (already present): ${skipped}.` +
          (skipped
            ? '\nRe-run with --update to overwrite existing titles from the Sheet.'
            : '')
  );
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
