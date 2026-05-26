require('dotenv').config({ path: '.env.local' });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Anthropic } = require('@anthropic-ai/sdk');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const sql = neon(process.env.DATABASE_URL);

// Convert a `cards` row into the flat shape the frontend expects.
function rowToCard(row) {
  return {
    paper_id: row.paper_id,
    paper_title: row.paper_title,
    ...row.data,
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
  };
}

// Split incoming card payload into top-level columns vs JSONB data.
function splitPayload(body) {
  const { paper_id, paper_title, submitted_at, updated_at, ...data } = body;
  return { paper_title, data };
}

const EXTRACTION_PROMPT = `Extract information for an AI Clinical Trial Card from this research paper.
Return a single valid JSON object with this exact schema (use null for missing information):

{
  "paper_title": "string",
  "authors": ["array", "of", "full author names"],
  "year": number_or_null,
  "study_type": "lab experiment | field experiment | randomized controlled trial | observational | quasi-experimental | other",
  "ai_model": {
    "provider": "string (e.g., OpenAI, Google, Anthropic, Meta)",
    "model_name": "string",
    "model_version": "string or null",
    "fine_tuned": true_or_false_or_null,
    "access_method": "string (e.g., API, ChatGPT web interface, VS Code plugin)",
    "prompting_or_config": "string describing prompts/configuration, or null",
    "benchmarks_reported": true_or_false,
    "key_parameters": "string describing temperature, top-p, system prompt, etc., or null"
  },
  "human_participants": {
    "sample_size": number_or_null,
    "population": "string describing who the participants were",
    "expertise_level": "Low | Moderate | High | Heterogeneous",
    "domain_expertise": "string",
    "ai_familiarity": "string",
    "training_provided": "string describing any onboarding or training",
    "data_collection_period": "string or null"
  },
  "interaction_task": {
    "task_domain": "string (e.g., Healthcare, Education, Software development)",
    "task_description": "string",
    "interface": "string describing the UI/interface used",
    "ai_role": "assistive | semi-autonomous | autonomous",
    "experimental_conditions": ["array of condition names"],
    "primary_outcomes": ["array of outcome measure names"],
    "main_effects_summary": "string summarizing the key findings",
    "effect_direction": "positive | negative | mixed | null",
    "prompting_strategy": "string (e.g., Zero-shot, Few-shot, Chain-of-thought) or null"
  }
}

Return ONLY valid JSON. No markdown, no explanation, no code blocks.`;

// ── GET all published cards ──────────────────────────────────────────────────
app.get('/api/cards', async (req, res) => {
  try {
    const rows = await sql`
      SELECT paper_id, paper_title, data, submitted_at, updated_at
      FROM cards
      WHERE status = 'published'
      ORDER BY paper_id
    `;
    res.json(rows.map(rowToCard));
  } catch (err) {
    console.error('GET /api/cards:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST parse PDF or text file ──────────────────────────────────────────────
app.post('/api/parse', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const isPDF = req.file.mimetype === 'application/pdf';
    const base64 = req.file.buffer.toString('base64');

    let content;
    if (isPDF) {
      content = [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        },
        { type: 'text', text: EXTRACTION_PROMPT },
      ];
    } else {
      const text = req.file.buffer.toString('utf8');
      content = `${EXTRACTION_PROMPT}\n\nPaper text:\n${text.substring(0, 60000)}`;
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    });

    const raw = response.content[0].text.trim()
      .replace(/^```json\n?/, '').replace(/\n?```$/, '');
    res.json(JSON.parse(raw));
  } catch (err) {
    console.error('Parse error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST parse LaTeX / plain text ────────────────────────────────────────────
app.post('/api/parse-text', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `${EXTRACTION_PROMPT}\n\nPaper text:\n${text.substring(0, 60000)}`,
      }],
    });

    const raw = response.content[0].text.trim()
      .replace(/^```json\n?/, '').replace(/\n?```$/, '');
    res.json(JSON.parse(raw));
  } catch (err) {
    console.error('Parse text error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST add new card ────────────────────────────────────────────────────────
app.post('/api/cards', async (req, res) => {
  try {
    const { paper_title, data } = splitPayload(req.body);
    if (!paper_title) return res.status(400).json({ error: 'paper_title is required' });

    const rows = await sql`
      INSERT INTO cards (paper_title, data)
      VALUES (${paper_title}, ${JSON.stringify(data)}::jsonb)
      RETURNING paper_id, paper_title, data, submitted_at, updated_at
    `;
    res.status(201).json(rowToCard(rows[0]));
  } catch (err) {
    if (err.message && err.message.includes('duplicate key')) {
      return res.status(409).json({ error: 'A card with this title already exists' });
    }
    console.error('POST /api/cards:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH update existing card (for completing missing fields) ───────────────
app.patch('/api/cards/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await sql`SELECT * FROM cards WHERE paper_id = ${id}`;
    if (!existing.length) return res.status(404).json({ error: 'Card not found' });

    const row = existing[0];
    const updates = req.body;
    const newData = {
      ...row.data,
      ...updates,
      ai_model:           { ...(row.data.ai_model || {}),           ...(updates.ai_model || {}) },
      human_participants: { ...(row.data.human_participants || {}), ...(updates.human_participants || {}) },
      interaction_task:   { ...(row.data.interaction_task || {}),   ...(updates.interaction_task || {}) },
    };
    // Keep paper_title and lifecycle columns out of the JSONB blob.
    delete newData.paper_id;
    delete newData.paper_title;
    delete newData.submitted_at;
    delete newData.updated_at;

    const newTitle = updates.paper_title || row.paper_title;

    const [updateRows] = await sql.transaction([
      sql`UPDATE cards
            SET paper_title = ${newTitle},
                data        = ${JSON.stringify(newData)}::jsonb,
                updated_at  = NOW()
          WHERE paper_id = ${id}
          RETURNING paper_id, paper_title, data, submitted_at, updated_at`,
      sql`INSERT INTO card_edits (paper_id, changes)
          VALUES (${id}, ${JSON.stringify(updates)}::jsonb)`,
    ]);

    res.json(rowToCard(updateRows[0]));
  } catch (err) {
    console.error('PATCH /api/cards/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET export cards as JSON or CSV ─────────────────────────────────────────
app.get('/api/export', async (req, res) => {
  try {
    const rows = await sql`
      SELECT paper_id, paper_title, data, submitted_at, updated_at
      FROM cards
      WHERE status = 'published'
      ORDER BY paper_id
    `;
    const cards = rows.map(rowToCard);
    const format = req.query.format || 'json';

    if (format === 'csv') {
      const headers = [
        'paper_id', 'paper_title', 'authors', 'year', 'study_type',
        'ai_provider', 'ai_model_name', 'ai_version', 'fine_tuned', 'access_method',
        'prompting_config', 'benchmarks_reported', 'key_parameters',
        'sample_size', 'population', 'expertise_level', 'domain_expertise',
        'ai_familiarity', 'training_provided', 'data_collection_period',
        'task_domain', 'task_description', 'interface', 'ai_role',
        'experimental_conditions', 'primary_outcomes',
        'main_effects_summary', 'effect_direction', 'prompting_strategy',
        'submitted_at', 'updated_at',
      ];

      const esc = v => {
        if (v === null || v === undefined) return '';
        const s = Array.isArray(v) ? v.join('; ') : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      };

      const csvRows = cards.map(c => [
        c.paper_id,
        esc(c.paper_title), esc(c.authors), c.year || '', esc(c.study_type),
        esc(c.ai_model?.provider), esc(c.ai_model?.model_name),
        esc(c.ai_model?.model_version), c.ai_model?.fine_tuned ?? '',
        esc(c.ai_model?.access_method), esc(c.ai_model?.prompting_or_config),
        c.ai_model?.benchmarks_reported ?? '', esc(c.ai_model?.key_parameters),
        c.human_participants?.sample_size ?? '',
        esc(c.human_participants?.population), esc(c.human_participants?.expertise_level),
        esc(c.human_participants?.domain_expertise), esc(c.human_participants?.ai_familiarity),
        esc(c.human_participants?.training_provided), esc(c.human_participants?.data_collection_period),
        esc(c.interaction_task?.task_domain), esc(c.interaction_task?.task_description),
        esc(c.interaction_task?.interface), esc(c.interaction_task?.ai_role),
        esc(c.interaction_task?.experimental_conditions), esc(c.interaction_task?.primary_outcomes),
        esc(c.interaction_task?.main_effects_summary), esc(c.interaction_task?.effect_direction),
        esc(c.interaction_task?.prompting_strategy),
        esc(c.submitted_at), esc(c.updated_at),
      ].join(','));

      const csv = [headers.join(','), ...csvRows].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="ai_clinical_trial_cards.csv"');
      return res.send(csv);
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="ai_clinical_trial_cards.json"');
    res.json(cards);
  } catch (err) {
    console.error('GET /api/export:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\nAI Clinical Trial Cards running at http://localhost:${PORT}\n`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('Warning: ANTHROPIC_API_KEY not set — PDF/text parsing will not work');
  }
  if (!process.env.DATABASE_URL) {
    console.warn('Warning: DATABASE_URL not set — database operations will fail');
  }
});
