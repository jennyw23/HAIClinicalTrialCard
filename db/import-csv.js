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
  // Prefer the most specific field/lab label when Methodology lists several.
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
  if (r.includes('semi')) return 'semi-autonomous';
  if (r.includes('autonomous') && !r.includes('semi')) return 'autonomous';
  if (r.includes('assist')) return 'assistive';
  return clean(role);
}

function mapEffectDirection(dir) {
  const d = (dir || '').toLowerCase().trim();
  if (d === 'positive') return 'positive';
  if (d === 'negative') return 'negative';
  if (d === 'mixed' || d === 'heterogeneous') return 'mixed';
  return clean(dir);
}

function mapExpertise(level) {
  const e = clean(level);
  if (!e) return null;
  const known = ['Low', 'Moderate', 'High', 'Heterogeneous'];
  const hit = known.find((k) => k.toLowerCase() === e.toLowerCase());
  return hit || e;
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

  const needsReview = (headerKey(row, 'Needs Review?', 'Needs Review') || '')
    .toUpperCase()
    .startsWith('Y');
  const methodology = headerKey(row, 'Methodology');
  const sampleRaw = headerKey(row, 'Sample Size (N)', 'Sample Size');
  const sampleSize = sampleRaw != null ? parseInt(String(sampleRaw).replace(/,/g, ''), 10) : null;
  const yearRaw = headerKey(row, 'Year');
  const year = yearRaw != null ? parseInt(yearRaw, 10) : null;

  const data = {
    authors: parseAuthors(headerKey(row, 'Author', 'Authors')),
    year: Number.isFinite(year) ? year : null,
    study_type: mapStudyType(methodology),
    publication_type: headerKey(row, 'Publication Type'),
    methodology: methodology,
    randomized: headerKey(row, 'Randomized?'),
    author_proposed_mechanisms: headerKey(row, 'Author Proposed Mechanisms'),
    ai_model: {
      provider: headerKey(row, 'Provider'),
      model_name: headerKey(row, 'Model Name'),
      model_version: null,
      fine_tuned: null,
      access_method: headerKey(row, 'Access Method'),
      prompting_or_config: null,
      benchmarks_reported: null,
      key_parameters: null,
      model_type: headerKey(row, 'Model Type'),
    },
    human_participants: {
      sample_size: Number.isFinite(sampleSize) ? sampleSize : null,
      population: headerKey(row, 'Population'),
      expertise_level: mapExpertise(headerKey(row, 'Expertise Level')),
      domain_expertise: null,
      ai_familiarity: headerKey(row, 'AI Familiarity'),
      training_provided: headerKey(row, 'Training Provided'),
      data_collection_period: headerKey(row, 'Data Collection Period'),
    },
    interaction_task: {
      task_domain: headerKey(row, 'Task Domain'),
      task_description: null,
      interface: headerKey(row, 'Access Method'),
      ai_role: mapAiRole(headerKey(row, 'AI Role')),
      experimental_conditions: splitList(headerKey(row, 'Comparison Conditions')),
      primary_outcomes: splitList(headerKey(row, 'Outcome Metrics')),
      main_effects_summary: headerKey(row, 'Main Effects Summary'),
      effect_direction: mapEffectDirection(headerKey(row, 'Effect Direction')),
      prompting_strategy: null,
    },
  };

  // Prefer a dedicated interface if Access Method looks like channels;
  // keep access_method as-is for AI access, and also set interface from it
  // when no better field exists (Sheet has no separate Interface column).

  const sheetId = headerKey(row, 'Paper ID');
  return {
    paper_id: sheetId != null ? parseInt(sheetId, 10) : null,
    paper_title: paperTitle,
    status: needsReview ? 'pending' : 'published',
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
    if (doUpdate) {
      const result = await sql`
        INSERT INTO cards (paper_title, data, status)
        VALUES (${c.paper_title}, ${JSON.stringify(c.data)}::jsonb, ${c.status})
        ON CONFLICT (paper_title) DO UPDATE SET
          data       = EXCLUDED.data,
          status     = EXCLUDED.status,
          updated_at = NOW()
        RETURNING (xmax = 0) AS is_insert
      `;
      if (result[0]?.is_insert) inserted++;
      else updated++;
    } else {
      const result = await sql`
        INSERT INTO cards (paper_title, data, status)
        VALUES (${c.paper_title}, ${JSON.stringify(c.data)}::jsonb, ${c.status})
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
