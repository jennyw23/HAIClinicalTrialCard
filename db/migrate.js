#!/usr/bin/env node
// Apply schema.sql to the Neon database referenced by DATABASE_URL.
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Did you run `vercel env pull .env.local`?');
  process.exit(1);
}

(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const ddl = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
    .replace(/--[^\n]*/g, '');  // strip line comments before splitting

  const statements = ddl
    .split(';')
    .map(s => s.trim())
    .filter(s => s);

  for (const stmt of statements) {
    await sql.query(stmt);
  }
  console.log(`Applied ${statements.length} statement(s).`);
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
