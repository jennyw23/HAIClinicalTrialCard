// ── Reusable "?" tooltip component ──────────────────────────────────────────
// To add a tooltip anywhere on the site: add data-tooltip="some-key" to any
// element, then add a matching entry to TOOLTIP_CONTENT below. mountTooltips()
// (called once on DOMContentLoaded) finds every such element and appends the
// icon — no other wiring needed.
const TOOLTIP_CONTENT = {
  'filter-effect': 'Whether the study found the AI helped (Positive), hurt (Negative), had no measurable impact (Null), or had mixed impact across subgroups (Heterogeneous).',
  'filter-role': 'How much control the AI had: Assistive (human decides), Semi-autonomous (AI recommends, human approves), or Autonomous (AI acts independently).',
  'filter-expertise': 'The reported skill/experience level of the human participants in the study, from novice to expert.',
  'filter-domain-study': 'Filter by the task area studied (e.g. Healthcare, Software Development) and by the study design (e.g. RCT, Lab Experiment).',
  'map-rows': 'Pick the card field plotted down the left side of the grid below.',
  'map-columns': 'Pick the card field plotted across the top of the grid below.',
  'compare-near-twin': 'Auto-selects the study most similar to Study A across design fields (model, participants, task) — useful for isolating what one design choice changed.',
  'compare-highlight': 'When on, fields where Study A and Study B match are faded and only the differences are highlighted.',
  'form-ai-role': 'How much control the AI had in the task: Assistive (human decides), Semi-autonomous (AI recommends), or Autonomous (AI acts independently).',
  'form-access-method': 'How participants interacted with the AI system (e.g. chat interface, API, embedded in an existing tool).',
  'form-model-type': 'The functional category of the AI system used in the study (e.g. chatbot, copilot, autonomous agent).',
  'form-benchmarks': 'Whether the paper reports the AI model’s performance on standard benchmarks (e.g. accuracy on a held-out test set).',
  'form-guardrails': 'Whether the study describes safety constraints, content filters, or other guardrails placed on the AI’s behavior.',
  'form-heterogeneous-effects': 'Whether the paper reports the AI’s effect varying meaningfully across subgroups of participants (e.g. novices vs. experts).',
  'form-comparison-conditions': 'The condition(s) the AI-assisted group was compared against (e.g. no-AI control, human-only teams).',
};

function mountTooltips() {
  document.querySelectorAll('[data-tooltip]').forEach(el => {
    const key = el.getAttribute('data-tooltip');
    const text = TOOLTIP_CONTENT[key];
    if (!text || el.querySelector('.tip')) return;
    const icon = document.createElement('span');
    icon.className = 'tip';
    icon.setAttribute('data-tip-text', text);
    icon.setAttribute('tabindex', '0');
    icon.setAttribute('role', 'note');
    icon.setAttribute('aria-label', text);
    icon.textContent = '?';
    el.appendChild(icon);
  });
}
