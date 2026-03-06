const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

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

const CARDS_FILE = path.join(__dirname, 'cards.json');

function loadCards() {
  try {
    const raw = fs.readFileSync(CARDS_FILE, 'utf8');
    const cards = JSON.parse(raw);
    // Deduplicate by paper_title
    const seen = new Set();
    return cards.filter(c => {
      if (seen.has(c.paper_title)) return false;
      seen.add(c.paper_title);
      return true;
    });
  } catch {
    return [];
  }
}

function saveCards(cards) {
  fs.writeFileSync(CARDS_FILE, JSON.stringify(cards, null, 2));
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

// ── GET all cards ────────────────────────────────────────────────────────────
app.get('/api/cards', (req, res) => {
  res.json(loadCards());
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
app.post('/api/cards', (req, res) => {
  try {
    const cards = loadCards();
    const maxId = Math.max(0, ...cards.map(c => c.paper_id || 0));
    const newCard = {
      paper_id: maxId + 1,
      submitted_at: new Date().toISOString(),
      ...req.body,
    };
    cards.push(newCard);
    saveCards(cards);
    res.status(201).json(newCard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH update existing card (for completing missing fields) ───────────────
app.patch('/api/cards/:id', (req, res) => {
  try {
    const cards = loadCards();
    const idx = cards.findIndex(c => c.paper_id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Card not found' });

    const existing = cards[idx];
    const updates = req.body;
    cards[idx] = {
      ...existing,
      ...updates,
      ai_model: { ...existing.ai_model, ...updates.ai_model },
      human_participants: { ...existing.human_participants, ...updates.human_participants },
      interaction_task: { ...existing.interaction_task, ...updates.interaction_task },
      updated_at: new Date().toISOString(),
    };

    // Remove top-level duplicates if nested was updated
    saveCards(cards);
    res.json(cards[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET export cards as JSON or CSV ─────────────────────────────────────────
app.get('/api/export', (req, res) => {
  try {
    const cards = loadCards();
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

      const rows = cards.map(c => [
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

      const csv = [headers.join(','), ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="ai_clinical_trial_cards.csv"');
      return res.send(csv);
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="ai_clinical_trial_cards.json"');
    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\nAI Clinical Trial Cards running at http://localhost:${PORT}\n`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('Warning: ANTHROPIC_API_KEY not set — PDF/text parsing will not work\n');
  }
});
