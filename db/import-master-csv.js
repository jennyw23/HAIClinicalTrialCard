#!/usr/bin/env node
/**
 * Import the HAI Studies "Master" audit CSV into the cards table.
 *
 * This is a different source format from db/import-csv.js (the Google Form
 * export). The Master CSV is a per-paper audit sheet with three variants of
 * many fields:
 *   - bare column       (e.g. `effect_direction`)   -> the AUDITED / corrected value
 *   - `_handcoded`       (e.g. `effect_direction_handcoded`) -> the original RA-entered
 *                         value, kept for the audit trail (often stale/incorrect —
 *                         see each row's `recoding_note` / `data_quality_flags`)
 *   - `_stdfile`         -> a third cross-reference copy from another file
 *
 * Per project decision: prefer the bare column when one exists. A number of
 * fields (authors, abstract, publication venue, task description, effect-size
 * narrative, mechanisms, main-effects summary, etc.) only ever exist under
 * `_handcoded` — there is no bare duplicate — so those are read from
 * `_handcoded` as a deliberate exception (see HANDCODED_EXCEPTIONS below).
 * Everything else ending in `_handcoded` or `_stdfile` is ignored.
 *
 * Usage:
 *   node db/import-master-csv.js                              # gitignore/HAI_Studies_Master.csv
 *   node db/import-master-csv.js path/to/file.csv
 *   node db/import-master-csv.js --dry-run                    # map + print, no DB writes
 *   node db/import-master-csv.js --update                     # upsert: overwrite existing titles
 *   node db/import-master-csv.js --wipe                       # DELETE all existing cards, then
 *                                                              # insert fresh from this CSV.
 *                                                              # Use this over --update when titles
 *                                                              # may have changed enough that exact
 *                                                              # paper_title matching would miss rows
 *                                                              # (creating duplicates instead of
 *                                                              # updating them).
 *
 * Requires DATABASE_URL in .env.local or .env (unless --dry-run).
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { neon } = require('@neondatabase/serverless');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const doWipe = args.includes('--wipe');
const doUpdate = args.includes('--update') || doWipe;
const csvArg = args.find((a) => !a.startsWith('--'));
const csvPath = path.resolve(
  csvArg || path.join(__dirname, '..', 'gitignore', 'HAI_Studies_Master.csv')
);

// Fields that exist ONLY as `_handcoded` in this sheet (no bare column) —
// kept anyway per project decision, since dropping them would blank
// authors/abstract/etc. on every card.
const HANDCODED_EXCEPTIONS = new Set([
  'abstract_handcoded',
  'authors_handcoded',
  'doi_handcoded',
  'publication_venue_handcoded',
  'data_collection_period_handcoded',
  'comparison_conditions_handcoded',
  'participant_population_handcoded',
  'participant_population_normalized_handcoded',
  'ai_familiarity_handcoded',
  'ai_familiarity_measure_handcoded',
  'task_description_handcoded',
  'model_description_handcoded',
  'key_parameters_handcoded',
  'training_description_handcoded',
  'benchmarks_reported_handcoded',
  'ai_role_handcoded',
  'ai_configuration_handcoded',
  'interaction_notes_handcoded',
  'outcome_metrics_handcoded',
  'effect_size_handcoded',
  'outcome_standard_error_handcoded',
  'who_benefited_handcoded',
  'main_effects_summary_handcoded',
  'author_proposed_mechanisms_handcoded',
  'human_characteristics_handcoded',
  'ai_characteristics_handcoded',
  'workflow_features_handcoded',
  'noteworthy_handcoded',
]);

function clean(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function num(v) {
  const s = clean(v);
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function intOf(v) {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

// Split on a delimiter, trimming a stray leading "and " (author lists like
// "A, B, and C" split into ["A", "B", "and C"] otherwise).
function splitList(v, delimiter = ',') {
  const s = clean(v);
  if (!s) return [];
  return s
    .split(delimiter)
    .map((x) => x.trim().replace(/^and\s+/i, '').replace(/^&\s+/i, ''))
    .filter(Boolean);
}

// Author bylines mix ", " and a bare " and "/" & " before the final name
// (e.g. "A, B, and C" as well as just "A and C" with only two authors) —
// normalize both separators to commas before splitting.
function splitAuthors(v) {
  const s = clean(v);
  if (!s) return [];
  return s
    .replace(/\s*&\s*/g, ', ')
    .replace(/\s+and\s+/gi, ', ')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function get(row, col) {
  if (col.endsWith('_handcoded') && !HANDCODED_EXCEPTIONS.has(col)) {
    throw new Error(`Refusing to read excluded column: ${col}`);
  }
  return clean(row[col]);
}

// Every `_handcoded` column in the row, verbatim, keyed by its original
// column name — a complete audit-trail copy regardless of which fields the
// curated schema above chose to surface (see HANDCODED_EXCEPTIONS' comment).
// effect_direction_handcoded is excluded: it's the stale pre-correction value
// (see effect_direction_stdfile/average_effect_direction_handcoded, already
// removed from the sheet) — the audited `effect_direction` column above is
// the only effect-direction value we keep anywhere in the card.
function rawHandcoded(row) {
  const out = {};
  for (const col of Object.keys(row)) {
    if (col === 'effect_direction_handcoded') continue;
    if (col.toLowerCase().endsWith('_handcoded')) out[col] = clean(row[col]);
  }
  return out;
}

function mapFineTuned(modelAdaptation) {
  const s = (modelAdaptation || '').toLowerCase();
  if (!s || s.includes('not reported')) return null;
  return s === 'fine-tuned' ? 'Yes' : 'No';
}

function rowToCard(row) {
  const paperTitle = get(row, 'title');
  if (!paperTitle) return null;

  const studyId = get(row, 'paper_id');
  const checkFlag = get(row, 'check_flag');
  const needsReview = checkFlag === 'CHECK';

  const effectDirection = get(row, 'effect_direction');
  const mainEffectsSummary = get(row, 'main_effects_summary_handcoded');
  const outcomeMetrics = splitList(get(row, 'outcome_metrics_handcoded'));
  const modelAdaptation = get(row, 'model_adaptation');

  const data = {
    study_id: studyId,
    needs_review: needsReview ? 'Yes' : 'No',
    authors: splitAuthors(get(row, 'authors_handcoded')),
    abstract: get(row, 'abstract_handcoded'),
    year: intOf(get(row, 'year')),
    paper_url: get(row, 'source_url'),
    doi: get(row, 'doi_handcoded'),
    publication_type: get(row, 'publication_type'),
    publication_venue: get(row, 'publication_venue_handcoded'),
    data_collection_period: get(row, 'data_collection_period_handcoded'),
    methodology: [get(row, 'study_type_primary')].filter(Boolean),
    study_type: get(row, 'study_type_primary'),
    randomized: get(row, 'randomized'),
    assignment_mechanism: get(row, 'assignment_mechanism'),
    study_setting: get(row, 'study_setting'),
    unit_of_randomization: get(row, 'unit_of_randomization'),
    comparison_type: get(row, 'comparison_type'),
    location: get(row, 'location_tags'),
    application_sector: get(row, 'application_sector'),

    ai_model: {
      provider: get(row, 'ai_provider_primary'),
      model_name: get(row, 'ai_model_exact'),
      model_version: get(row, 'model_generation'),
      model_developer: get(row, 'model_developer'),
      deployment_vendor: get(row, 'deployment_vendor'),
      model_description: get(row, 'model_description_handcoded'),
      model_adaptation: modelAdaptation,
      fine_tuned: mapFineTuned(modelAdaptation),
      access_method: [get(row, 'access_method')].filter(Boolean),
      key_parameters: get(row, 'key_parameters_handcoded'),
      benchmarks_reported: get(row, 'benchmarks_reported_handcoded'),
      guardrails_present: get(row, 'guardrails_codebook'),
      configuration_setup: get(row, 'ai_configuration_handcoded'),
      prompting_or_config: get(row, 'ai_configuration_handcoded'),
    },

    human_participants: {
      sample_size: intOf(get(row, 'sample_size_n')),
      sample_size_unit: get(row, 'sample_size_unit'),
      population: get(row, 'participant_population_handcoded'),
      population_normalized: get(row, 'participant_population_normalized_handcoded'),
      occupation: get(row, 'occupation_detailed'),
      participant_type: get(row, 'participant_type'),
      domain_expertise: get(row, 'domain_expertise'),
      ai_familiarity: get(row, 'ai_familiarity_handcoded'),
      ai_familiarity_measure: get(row, 'ai_familiarity_measure_handcoded'),
      training_provided: get(row, 'training_provided'),
      training_description: get(row, 'training_description_handcoded'),
      data_collection_period: get(row, 'data_collection_period_handcoded'),
      location: get(row, 'location_tags'),
    },

    interaction_task: {
      task_domain: splitList(get(row, 'task_domain_tags'), '|'),
      task_domain_primary: get(row, 'task_domain_primary'),
      task_description: get(row, 'task_description_handcoded'),
      ai_role: get(row, 'ai_role_handcoded'),
      automation_level: get(row, 'automation_level'),
      final_output_author: get(row, 'final_output_author'),
      interface: get(row, 'access_method'),
      interaction_notes: get(row, 'interaction_notes_handcoded'),
      prompting_strategy: get(row, 'ai_configuration_handcoded'),
      comparison_conditions: splitList(get(row, 'comparison_conditions_handcoded')),
      experimental_conditions: splitList(get(row, 'comparison_conditions_handcoded')),
      primary_outcomes: outcomeMetrics,
      main_effects_summary: mainEffectsSummary,
      effect_direction: effectDirection,
    },

    outcomes: {
      outcome_metrics: outcomeMetrics,
      primary_outcome_family: get(row, 'primary_outcome_family'),
      primary_outcome: get(row, 'primary_outcome'),
      effect_size: get(row, 'effect_size_handcoded'),
      effect_direction: effectDirection,
      estimate: num(get(row, 'estimate')),
      estimate_type: get(row, 'estimate_type'),
      units: get(row, 'units'),
      se: num(get(row, 'se')),
      sd: num(get(row, 'sd')),
      ci_low: num(get(row, 'ci_low')),
      ci_high: num(get(row, 'ci_high')),
      p_value: num(get(row, 'p_value')),
      estimate_status: get(row, 'estimate_status'),
      n_estimates: intOf(get(row, 'n_estimates')),
      outcome_standard_error: get(row, 'outcome_standard_error_handcoded'),
      who_benefited: get(row, 'who_benefited_handcoded'),
      main_effects_summary: mainEffectsSummary,
      heterogeneous_effects: get(row, 'heterogeneous_effects'),
      main_moderator: get(row, 'main_moderator'),
      author_proposed_mechanisms: get(row, 'author_proposed_mechanisms_handcoded'),
      human_characteristics_explain: get(row, 'human_characteristics_handcoded'),
      ai_characteristics_explain: get(row, 'ai_characteristics_handcoded'),
      workflow_features_explain: get(row, 'workflow_features_handcoded'),
      noteworthy: get(row, 'noteworthy_handcoded'),
    },

    audit: {
      check_flag: checkFlag,
      audit_status: get(row, 'audit_status'),
      source_access: get(row, 'source_access'),
      recoding_note: get(row, 'recoding_note'),
      data_quality_flags: get(row, 'data_quality_flags'),
      estimate_id_primary: get(row, 'estimate_id_primary'),
    },

    // Every `_handcoded` column from the sheet, verbatim — including the ones
    // already folded into the curated fields above (e.g. authors_handcoded,
    // effect_size_handcoded), plus every one that isn't (e.g. sample_size_handcoded,
    // provider_handcoded, fine_tuned_handcoded, task_domain_handcoded, ...). This is
    // the full audit-trail copy: nothing from the sheet's "_handcoded" side is lost,
    // even where the curated schema above prefers a different (bare/derived) value.
    handcoded: rawHandcoded(row),
  };

  return {
    study_id: studyId,
    paper_title: paperTitle,
    status: needsReview ? 'pending' : 'published',
    created_by: null,
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
        `- [${c.status}] #${c.study_id} ${c.paper_title}\n` +
          `    year=${c.data.year} study_type=${c.data.study_type} ` +
          `N=${c.data.human_participants.sample_size} ` +
          `provider=${c.data.ai_model.provider} model=${c.data.ai_model.model_name} ` +
          `effect=${c.data.outcomes.effect_direction} ` +
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

  let orphaned = [];
  if (doWipe) {
    const before = await sql`SELECT COUNT(*)::int AS n FROM cards`;
    await sql`DELETE FROM cards`; // cascades to card_edits via FK
    await sql`SELECT setval(pg_get_serial_sequence('cards', 'paper_id'), 1, false)`;
    console.log(`Wiped ${before[0].n} existing card(s) from the database.`);
  } else {
    // Report existing DB titles that don't appear in this CSV (not deleted —
    // just surfaced so you know they're now orphaned from the new source).
    const existing = await sql`SELECT paper_title FROM cards`;
    const newTitles = new Set(cards.map((c) => c.paper_title));
    orphaned = existing.filter((r) => !newTitles.has(r.paper_title));
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const c of cards) {
    if (doUpdate) {
      const result = await sql`
        INSERT INTO cards (paper_title, data, status, created_by)
        VALUES (${c.paper_title}, ${JSON.stringify(c.data)}::jsonb, ${c.status}, ${c.created_by})
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
        INSERT INTO cards (paper_title, data, status, created_by)
        VALUES (${c.paper_title}, ${JSON.stringify(c.data)}::jsonb, ${c.status}, ${c.created_by})
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
          (skipped ? '\nRe-run with --update to overwrite existing titles from the CSV.' : '')
  );

  if (orphaned.length) {
    console.log(
      `\n${orphaned.length} existing card(s) in the database were NOT in this CSV (left untouched):`
    );
    orphaned.forEach((r) => console.log(`  - ${r.paper_title}`));
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
