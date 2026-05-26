#!/usr/bin/env node
// One-time import of cards.json into Postgres.
// Safe to re-run: uses ON CONFLICT (paper_title) DO NOTHING.
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set.');
  process.exit(1);
}

(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const raw = fs.readFileSync(path.join(__dirname, '..', 'cards.json'), 'utf8');
  const cards = JSON.parse(raw);

  let inserted = 0, skipped = 0;
  for (const c of cards) {
    const { paper_id, paper_title, submitted_at, updated_at, ...rest } = c;
    if (!paper_title) { skipped++; continue; }

    const result = await sql`
      INSERT INTO cards (paper_id, paper_title, data, status, submitted_at, updated_at)
      VALUES (
        ${paper_id},
        ${paper_title},
        ${JSON.stringify(rest)}::jsonb,
        'published',
        ${submitted_at || new Date().toISOString()},
        ${updated_at || null}
      )
      ON CONFLICT (paper_title) DO NOTHING
      RETURNING paper_id
    `;
    if (result.length) inserted++; else skipped++;
  }

  // Bump the serial sequence past the highest seeded ID so future inserts don't collide.
  await sql`SELECT setval(pg_get_serial_sequence('cards', 'paper_id'),
                          COALESCE((SELECT MAX(paper_id) FROM cards), 1))`;

  console.log(`Seed complete. Inserted: ${inserted}, skipped (already present): ${skipped}.`);
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
