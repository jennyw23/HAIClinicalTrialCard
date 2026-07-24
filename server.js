require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
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
  const {
    paper_id,
    paper_title,
    submitted_at,
    updated_at,
    submitted_by,
    created_by,
    status,
    ...data
  } = body;
  return {
    paper_title,
    created_by: created_by || submitted_by || null,
    status: status || 'published',
    data,
  };
}

const EXTRACTION_PROMPT = `Extract information for an AI Clinical Trial Card from this research paper.
Return a single valid JSON object with this exact schema (use null for missing information).
Match enum values exactly when possible.

{
  "study_id": "string or null",
  "paper_title": "string",
  "paper_url": "string or null",
  "authors": ["array", "of", "full author names"],
  "year": number_or_null,
  "publication_type": "Peer-reviewed journal | Working paper | Conference paper | Preprint | Book chapter | Unknown | null",
  "publication_venue": "string or null",
  "methodology": ["subset of: Field Experiment, Randomized Controlled Trial (RCT), Lab Experiment, Survey Experiment, Observational Study, Natural Experiment, Case Study, Qualitative Study, Mixed Methods, Meta-analysis, Review Paper, Not Reported"],
  "randomized": "Yes | No | Unclear | null",
  "ai_model": {
    "provider": "OpenAI | Anthropic | Google | Microsoft | Meta | Mistral | Open-source | Multiple | Not Reported | string",
    "model_name": "string",
    "model_type": "Chatbot | Tutor | Copilot | Agent | Workflow Assistant | Decision Support System | string | null",
    "fine_tuned": "Yes | No | Not reported | null",
    "access_method": ["subset of: Chat Interface, API, IDE Integration, Embedded Workflow, Web App, Mobile App, Voice Interface, Multimodal, Not Reported"],
    "key_parameters": "string or null",
    "benchmarks_reported": "Yes | No | Partial | Not Reported | null",
    "guardrails_present": "Yes | No | Partial | Not Reported | null",
    "configuration_setup": "string describing guardrails, system prompt, tutor setup, workflow, etc., or null"
  },
  "human_participants": {
    "sample_size": number_or_null,
    "population": "string describing who the participants were",
    "expertise_level": "Low | Low to Moderate | Moderate | Moderate to High | High | Heterogeneous | Not Reported | null",
    "ai_familiarity": "Low | Low to Moderate | Moderate | Moderate to High | High | Heterogeneous | Not Reported | null",
    "training_provided": "Yes | No | Partial | Unclear | null",
    "training_description": "string or null",
    "data_collection_period": "string or null"
  },
  "interaction_task": {
    "task_domain": ["subset of: Software Development, Education, Healthcare, Entrepreneurship, Writing, Knowledge Work, Teamwork & Collaboration, Customer Service, Research, Decision-Making, Design, Marketing, Operations, Finance"],
    "task_description": "string",
    "ai_role": "Assistive | Semi-autonomous | Autonomous | null",
    "interaction_notes": "string on when/how AI was used, reliance, frequency, or null",
    "comparison_conditions": ["subset of: No AI, AI Only, Human + AI, Human-only Teams, Human-AI Teams, AI + Process Overview, Copilot Enabled, Copilot Disabled, plus other condition names as needed"]
  },
  "outcomes": {
    "outcome_metrics": ["subset of: Performance Quality, Productivity, Accuracy, Creativity, Learning Outcomes, Confidence, Trust, Satisfaction, Collaboration Quality, Speed / Time, Revenue / Business Outcomes, Retention, Self-reported Outcomes"],
    "effect_size": "string or null",
    "effect_direction": "Positive | Negative | Null / No Effect | Heterogeneous | Unclear | null",
    "outcome_standard_error": "string or null",
    "who_benefited": "string describing who benefited more/less, or null",
    "main_effects_summary": "string summarizing key findings",
    "heterogeneous_effects": "Yes | No | null",
    "author_proposed_mechanisms": "string or null",
    "human_characteristics_explain": "string or null",
    "ai_characteristics_explain": "string or null",
    "workflow_features_explain": "string or null",
    "noteworthy": "string or null"
  }
}

Return ONLY valid JSON. No markdown, no explanation, no code blocks.`;

// ── GET all published cards ──────────────────────────────────────────────────
app.get('/api/cards', async (req, res) => {
  try {
    const rows = await sql`
      SELECT paper_id, paper_title, data, submitted_at, updated_at
      FROM cards
      WHERE status IN ('published', 'pending')
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
    const { paper_title, data, created_by, status } = splitPayload(req.body);
    if (!paper_title) return res.status(400).json({ error: 'paper_title is required' });

    const rows = await sql`
      INSERT INTO cards (paper_title, data, created_by, status)
      VALUES (
        ${paper_title},
        ${JSON.stringify(data)}::jsonb,
        ${created_by},
        ${status}
      )
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
      outcomes:           { ...(row.data.outcomes || {}),           ...(updates.outcomes || {}) },
    };
    // Keep paper_title and lifecycle columns out of the JSONB blob.
    delete newData.paper_id;
    delete newData.paper_title;
    delete newData.submitted_at;
    delete newData.updated_at;
    delete newData.created_by;
    delete newData.status;
    delete newData.submitted_by;

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
      WHERE status IN ('published', 'pending')
      ORDER BY paper_id
    `;
    const cards = rows.map(rowToCard);
    const format = req.query.format || 'json';

    if (format === 'csv') {
      const headers = [
        'study_id', 'paper_id', 'paper_title', 'paper_url', 'authors', 'year',
        'publication_type', 'publication_venue', 'methodology', 'randomized',
        'sample_size', 'population', 'expertise_level', 'ai_familiarity',
        'training_provided', 'training_description', 'data_collection_period',
        'ai_provider', 'ai_model_name', 'model_type', 'fine_tuned', 'access_method',
        'key_parameters', 'benchmarks_reported', 'guardrails_present', 'configuration_setup',
        'task_domain', 'task_description', 'ai_role', 'interaction_notes', 'comparison_conditions',
        'outcome_metrics', 'effect_size', 'effect_direction', 'outcome_standard_error',
        'who_benefited', 'main_effects_summary', 'heterogeneous_effects',
        'author_proposed_mechanisms', 'human_characteristics_explain',
        'ai_characteristics_explain', 'workflow_features_explain', 'noteworthy',
        'needs_review', 'coder_name', 'submitted_at', 'updated_at',
      ];

      const esc = v => {
        if (v === null || v === undefined) return '';
        const s = Array.isArray(v) ? v.join('; ') : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      };

      const csvRows = cards.map(c => {
        const o = c.outcomes || {};
        const t = c.interaction_task || {};
        const h = c.human_participants || {};
        const m = c.ai_model || {};
        return [
          esc(c.study_id), c.paper_id, esc(c.paper_title), esc(c.paper_url),
          esc(c.authors), c.year || '', esc(c.publication_type), esc(c.publication_venue),
          esc(c.methodology), esc(c.randomized),
          h.sample_size ?? '', esc(h.population), esc(h.expertise_level), esc(h.ai_familiarity),
          esc(h.training_provided), esc(h.training_description), esc(h.data_collection_period),
          esc(m.provider), esc(m.model_name), esc(m.model_type), esc(m.fine_tuned),
          esc(m.access_method), esc(m.key_parameters), esc(m.benchmarks_reported),
          esc(m.guardrails_present), esc(m.configuration_setup || m.prompting_or_config),
          esc(t.task_domain), esc(t.task_description), esc(t.ai_role), esc(t.interaction_notes),
          esc(t.comparison_conditions || t.experimental_conditions),
          esc(o.outcome_metrics || t.primary_outcomes), esc(o.effect_size),
          esc(o.effect_direction || t.effect_direction), esc(o.outcome_standard_error),
          esc(o.who_benefited), esc(o.main_effects_summary || t.main_effects_summary),
          esc(o.heterogeneous_effects),
          esc(o.author_proposed_mechanisms || c.author_proposed_mechanisms),
          esc(o.human_characteristics_explain), esc(o.ai_characteristics_explain),
          esc(o.workflow_features_explain), esc(o.noteworthy),
          esc(c.needs_review), esc(c.coder_name),
          esc(c.submitted_at), esc(c.updated_at),
        ].join(',');
      });

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
