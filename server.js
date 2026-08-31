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

// Schema + enums below are transcribed from the coded columns of
// gitignore/HAI_Studies_Master.csv, the single source of truth for card values
// (the same vocabularies the front end declares in public/js/utils.js). Keep the
// two in step: an enum that drifts here writes non-conforming cards straight
// into the database, where they match no filter and appear as stray design-map
// rows. Field names mirror what db/import-master-csv.js produces.
const EXTRACTION_PROMPT = `Extract information for an AI Clinical Trial Card from this research paper.
Return a single valid JSON object with this exact schema (use null for missing information).

Fields marked ENUM must use one of the listed values EXACTLY as written, including
capitalisation and the em dash (—) where shown. If the paper does not report a
value, use "Not reported" where the enum offers it, otherwise null. Never invent
a new category name; a free-text field is provided wherever nuance is needed.

{
  "study_id": "string or null",
  "paper_title": "string",
  "paper_url": "string or null",
  "doi": "string or null",
  "authors": ["array", "of", "full author names"],
  "year": number_or_null,
  "abstract": "string or null",
  "publication_type": "ENUM: Peer-reviewed journal | Preprint | Working paper | Conference paper",
  "publication_venue": "string or null",
  "data_collection_period": "string or null",
  "study_type": "ENUM: Randomized field experiment | Randomized lab/online experiment | Quasi-experiment | Observational study",
  "randomized": "ENUM: Yes | No",
  "assignment_mechanism": "ENUM: Individual randomization | Cluster randomization | Within-subject crossover | Staggered rollout (DiD) | Observational — no assignment",
  "study_setting": "ENUM: In the field | Laboratory | Online panel task | Simulated professional task | Hybrid / multi-study",
  "unit_of_randomization": "ENUM: Individual | Team or pair | Task or session | Site or cluster | Not randomized",
  "comparison_type": "string describing the arms, e.g. 'Human-only vs Human + AI'",
  "application_sector": "ENUM: Cross-sector / general workforce | Healthcare & clinical | Software & IT | Education & tutoring | Marketing, media & creative | Retail, e-commerce & customer service | Professional services & consulting | Financial services & central banking | Legal | Small enterprise & self-employment | Manufacturing & industry | Research & academia | Public sector & government",
  "location": "country or region, or null",
  "ai_model": {
    "provider": "ENUM: OpenAI | Anthropic | Microsoft | Meta | Alibaba | GitHub | Stability AI | Ant Group | micro1 — or the provider's name verbatim if not listed",
    "model_name": "exact model string as the paper gives it, e.g. 'GPT-4 (gpt-4-0314)'",
    "model_version": "ENUM: Gen 1 — pre-instruction-tuned | Gen 2 — GPT-3.5 class | Gen 3 — GPT-4 class | Gen 4 — reasoning models | Image generation | Mixed generations | Undisclosed",
    "model_developer": "string, comma-separated if several",
    "deployment_vendor": "ENUM: Custom research build | OpenAI first-party (ChatGPT / API) | Third-party vertical product | GitHub Copilot | Microsoft 365 Copilot | Consumer creative tool | Multiple",
    "model_adaptation": "ENUM: Off-the-shelf, default settings | Prompt-engineered | Retrieval-augmented | Fine-tuned | Purpose-built system | Not reported",
    "access_method": ["ENUM subset: Chat Interface | Web App | API | IDE Integration | Embedded Workflow | Mobile App | Custom research interface | Not reported"],
    "model_description": "string or null",
    "key_parameters": "temperature, context length, seed, etc., or 'Not reported'",
    "benchmarks_reported": "string or 'Not reported'",
    "guardrails_present": "ENUM: Yes | No | Not reported",
    "configuration_setup": "system prompt, tutor setup, workflow scaffolding, or null"
  },
  "human_participants": {
    "sample_size": number_or_null,
    "sample_size_unit": "the unit counted, e.g. 'participants', 'developers', 'peer reviews'",
    "population": "string describing who the participants were",
    "occupation": "string or null",
    "domain_expertise": "ENUM: Novice | In training | Practitioner | Expert | Mixed by design",
    "ai_familiarity": "ENUM: Low | Mixed | High | Not Reported",
    "ai_familiarity_measure": "how familiarity was measured, or null",
    "training_provided": "ENUM: Yes | No | Instructions only | Unclear | Not reported",
    "training_description": "string or null",
    "data_collection_period": "string or null"
  },
  "interaction_task": {
    "task_domain": ["ENUM subset: Knowledge Work | Writing | Decision-Making | Healthcare | Education | Software Development | Marketing | Operations | Design | Teamwork & Collaboration | Entrepreneurship | Customer Service | Research | Finance"],
    "task_domain_primary": "ENUM: the single most central value from task_domain",
    "task_description": "string",
    "ai_role": "ENUM: Assistive | Semi-autonomous | Autonomous",
    "automation_level": "ENUM: L1 — On-demand tool | L2 — In-workflow suggestion | L3 — Draft generator | L4 — Delegated with sign-off | Varies by arm",
    "final_output_author": "ENUM: Human | Joint | AI with human approval",
    "interaction_notes": "when/how AI was used, reliance, frequency, or null",
    "comparison_conditions": ["the experimental arms, named as the paper names them"]
  },
  "outcomes": {
    "outcome_metrics": ["ENUM subset: Performance Quality | Productivity | Accuracy | Creativity | Learning Outcomes | Confidence | Trust | Satisfaction | Collaboration Quality | Speed / Time | Revenue / Business Outcomes | Retention | Self-reported Outcomes"],
    "primary_outcome_family": "ENUM: Output quality | Productivity & speed | Accuracy & error | Creativity & novelty | Learning & skill retention | Perceptions & self-reported experience | Wellbeing & affect | Business & labour-market outcomes",
    "primary_outcome": "the specific headline outcome measure, e.g. 'Task completion time'",
    "effect_direction": "ENUM: Positive | Negative | Mixed across primary outcomes | Null — precise | Null — inconclusive | Other. Use 'Null — precise' only when the interval is tight around zero; use 'Null — inconclusive' when the study is underpowered or the interval is wide.",
    "effect_size": "string or null",
    "estimate": number_or_null,
    "estimate_type": "ENUM: smd | pct_change | coef | pp | raw_diff | odds_ratio | group_mean | log_points",
    "units": "string or null",
    "se": number_or_null,
    "sd": number_or_null,
    "ci_low": number_or_null,
    "ci_high": number_or_null,
    "p_value": number_or_null,
    "outcome_standard_error": "string or null",
    "heterogeneous_effects": "ENUM: Yes | No | Not tested / reported",
    "main_moderator": "the moderator driving heterogeneity, or 'Not reported'",
    "who_benefited": "string describing who benefited more/less, or null",
    "main_effects_summary": "string summarizing key findings",
    "author_proposed_mechanisms": "string or null",
    "human_characteristics_explain": "string or null",
    "ai_characteristics_explain": "string or null",
    "workflow_features_explain": "string or null",
    "noteworthy": "string or null"
  }
}

Report the primary/headline estimate in the outcomes block, and take se, ci_low,
ci_high and p_value directly from the paper — do not compute or infer them.

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
        'sample_size', 'sample_size_unit', 'population', 'domain_expertise', 'ai_familiarity',
        'training_provided', 'training_description', 'data_collection_period',
        'ai_provider', 'ai_model_name', 'model_version', 'model_developer',
        'deployment_vendor', 'model_adaptation', 'fine_tuned', 'access_method',
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
          h.sample_size ?? '', esc(h.sample_size_unit), esc(h.population),
          esc(h.domain_expertise), esc(h.ai_familiarity),
          esc(h.training_provided), esc(h.training_description), esc(h.data_collection_period),
          esc(m.provider), esc(m.model_name), esc(m.model_version), esc(m.model_developer),
          esc(m.deployment_vendor), esc(m.model_adaptation), esc(m.fine_tuned),
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
