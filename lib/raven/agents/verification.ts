/**
 * Verification: the step that decides whether RAVEN is allowed to sound confident.
 *
 * This is deliberately *independent* of whoever produced the answer. A model can be
 * asked to be careful and will still occasionally invent a number, so the checks below
 * compare the finished text against the evidence that was actually retrieved: proper
 * nouns that do not exist in the corpus, figures with units that appear in no tool
 * output, and — the important one — past-tense claims of actions ("I saved that",
 * "scrolling now") that no recorded tool run supports.
 *
 * Blocking failures flip `verified` to false and the answer says so out loud; advisory
 * ones stay visible in the trace. Neither kind is ever silently dropped.
 */
import type { Citation, IntentMatch, ProposedAction, RavenMode, ToolRun } from '../types'

export type VerificationCheck = { name: string; ok: boolean; note: string; blocking: boolean }

export type VerificationReport = { verified: boolean; checks: VerificationCheck[] }

export type VerifyInput = {
  answer: string
  mode: RavenMode
  intent: IntentMatch
  citations: Citation[]
  runs: ToolRun[]
  evidenceText: string
  actions: ProposedAction[]
  provider: { id: string; model: string } | null
}

/** Claims of a completed action, mapped to the tool whose run would justify them. */
const ACTION_CLAIMS: { pattern: RegExp; tool: string; claim: string }[] = [
  { pattern: /\b(i\s+(?:have\s+)?(?:saved|stored|noted|remembered|written\s+down|recorded)|it\s+is\s+saved|stored\s+\d+)\b/i, tool: 'remember_fact', claim: 'a memory was written' },
  { pattern: /\b(i\s+(?:have\s+)?forg\s?ot|deleted|removed)\b/i, tool: 'forget_fact', claim: 'a memory was deleted' },
  { pattern: /\b(scroll(?:ing|ed)?\s+to|navigat(?:e|ed)\s+to|i\s+(?:opened|taken\s+you))\b/i, tool: 'request_navigation', claim: 'the page was moved' },
]

const PROPER_NOUN = /\b([A-Z][A-Za-z0-9+#.-]{2,24}(?: [A-Z][A-Za-z0-9+#.-]{2,24}){0,3})\b/g
const NUMERIC_CLAIM = /\b(\d+(?:[.,]\d+)?)\s?(%|percent|×|x|k|kb|mb|ms|s\b|fps|years?|million|billion|tok\/s)\b/gi

const ALLOWED_CAPITALS = new Set(
  [
    'Raven', 'Riyan', 'Pasha', 'Gemini', 'Google', 'TypeScript', 'JavaScript', 'React', 'Next', 'Next.js', 'Three', 'Three.js', 'ThreeJS', 'MediaPipe',
    'TensorFlow', 'Python', 'Node', 'Node.js', 'Postgres', 'PostgreSQL', 'Supabase', 'SQLite', 'Ollama', 'LM', 'Studio', 'Rust', 'Go', 'Kotlin', 'Java',
    'C', 'C++', 'Unity', 'WebGL', 'WebGPU', 'GPU', 'CPU', 'API', 'REST', 'HTTP', 'JSON', 'YAML', 'SQL', 'AI', 'ML', 'DL', 'RAG', 'CS', 'UI', 'UX', 'GLM',
    'AR', 'VR', 'MR', 'ID', 'URL', 'GLB', 'GLTF', 'USD', 'INR', 'I', 'The', 'This', 'That', 'It', 'He', 'She', 'They', 'We', 'You', 'Your', 'My', 'His',
    'If', 'In', 'On', 'And', 'But', 'No', 'Yes', 'Not', 'Only', 'Both', 'Some', 'Most', 'All', 'One', 'Two', 'Three', 'Four', 'Five', 'First', 'Second',
    'Since', 'Because', 'However', 'Also', 'Here', 'There', 'When', 'Where', 'What', 'Why', 'How', 'Which', 'Who', 'Whose', 'Ask', 'Say', 'Say', 'Note',
    'Provider', 'Database', 'Knowledge', 'Tools', 'Runtime', 'Sections', 'Focus', 'Stack', 'Architecture', 'Overview', 'Highlights', 'Experiments', 'Skills',
    'Projects', 'Contact', 'Memory', 'Session', 'Store', 'Corpus', 'Glossary', 'Supplied', 'Sources', 'User', 'Raven.',
  ].map((word) => word.replace(/[^A-Za-z0-9+#.]/g, '').toLowerCase()),
)

const knownNames: string[] = []

/** The composer registers the vocabulary it is allowed to use; unknown proper nouns get flagged. */
export function registerVocabulary(names: string[]): void {
  for (const name of names) {
    const cleaned = name.trim()
    if (cleaned && !knownNames.includes(cleaned)) knownNames.push(cleaned)
  }
}

export function vocabularySize(): number {
  return knownNames.length
}

const containsAnyName = (text: string, name: string) => text.toLowerCase().includes(name.toLowerCase())

export function verifyAnswer(input: VerifyInput): VerificationReport {
  const checks: VerificationCheck[] = []
  const answer = input.answer.trim()
  const succeededTools = new Set(input.runs.filter((run) => run.status === 'succeeded').map((run) => run.toolName))
  // A model's own sentence must never corroborate itself: provider-kind citations are
  // excluded below, because the brain cites the answer text for transparency and that
  // text cannot be allowed to become its own evidence.
  const grounding = input.citations.filter((citation) => citation.kind !== 'provider')
  const evidence = `${input.evidenceText}\n${grounding
    .map((citation) => `${citation.label} ${citation.quote ?? ''} ${citation.source}`)
    .join('\n')}`
    .toLowerCase()
    .replace(/\s+/g, ' ')

  checks.push({ name: 'answer-present', ok: answer.length >= 12, note: answer.length ? `${answer.length} chars` : 'no text was produced', blocking: true })

  const needsCitation = input.intent.intent.startsWith('portfolio.') || input.intent.intent === 'identity.riyan' || input.intent.intent === 'identity.raven'
  const hasGrounding = input.citations.length > 0
  checks.push({
    name: 'claims-grounded',
    ok: !needsCitation || hasGrounding,
    note: needsCitation ? (hasGrounding ? `${input.citations.length} citation(s)` : 'portfolio claim with no citation behind it') : 'no citation required for this intent',
    blocking: true,
  })

  // `claims-grounded` above is intent-scoped, which left a hole: an off-topic retrieval
  // listing under an intent like `explain.concept` carried no citation requirement at all, so
  // a paragraph of near-misses shipped with a verified badge. Any turn that presents itself as
  // retrieved knowledge needs something retrieved behind it — and a model cannot supply that
  // evidence with its own sentence, which is why this test reads `grounding`, not `citations`.
  const presentingAsGrounded = input.mode === 'knowledge' || input.mode === 'agentic' || (input.mode === 'genai' && input.provider != null)
  const evidenceCount = grounding.length
  checks.push({
    name: 'grounded-mode-has-evidence',
    ok: !presentingAsGrounded || evidenceCount > 0,
    note: presentingAsGrounded
      ? evidenceCount
        ? `${evidenceCount} non-provider citation(s) behind a ${input.mode} answer`
        : `a ${input.mode} answer with nothing but its own text to stand on`
      : `${input.mode} answer is not presented as grounded knowledge`,
    blocking: true,
  })

  const claims = ACTION_CLAIMS.filter((entry) => entry.pattern.test(answer))
  for (const claim of claims) {
    const supported = succeededTools.has(claim.tool) || input.actions.some((action) => action.tool === claim.tool && action.status === 'executed')
    checks.push({
      name: `action-claim:${claim.tool}`,
      ok: supported,
      note: supported ? `"${claim.claim}" is backed by a succeeded ${claim.tool} run` : `answer says "${claim.claim}" but no succeeded ${claim.tool} run exists`,
      blocking: true,
    })
  }

  // Numbers with units must be traceable to the evidence as standalone values. A match
  // inside "0.9984" does not count: retrieval scores would otherwise justify any figure
  // a model happened to invent. Years and seconds are skipped, the corpus uses them.
  const offenders: string[] = []
  for (const match of answer.matchAll(NUMERIC_CLAIM)) {
    const value = match[1]!
    const unit = match[2]!.toLowerCase()
    if (unit === 's' || unit === 'ms' || unit === 'x' || unit === '×') continue
    const unitPattern = unit === 'percent' ? '%' : unit
    const escapedValue = value.replace(/[.,]/g, (char) => '\\' + char)
    const escapedUnit = unitPattern.replace(/[^a-z0-9]/gi, (char) => '\\' + char)
    // The number has to appear with the same unit in the evidence: "99" inside a
    // retrieval score is not support for "99% accuracy".
    const supported = new RegExp(escapedValue + '\\s?' + escapedUnit, 'i')
    if (!supported.test(evidence)) offenders.push(`${value}${unit}`)
  }
  checks.push({
    name: 'figures-match-evidence',
    ok: offenders.length === 0,
    note: offenders.length ? `not found in evidence: ${offenders.slice(0, 4).join(', ')}` : answer.match(NUMERIC_CLAIM)?.length ? `${answer.match(NUMERIC_CLAIM)!.length} figure(s) traced to evidence` : 'no unit-bearing figures used',
    blocking: true,
  })

  // The classic portfolio hallucination is an invented job history. The claim shape is
  // specific enough to check exactly: a verb, an organization, and a duration or title.
  // A project description that merely says "working with data" is not an employment
  // claim, so it stays out of scope — a check that cries wolf gets ignored.
  const AFFILIATION = /\b(?:work(?:ed|ing)?|intern(?:ed|ing)?|employed)\s+(?:at|for|with|by)\s+([A-Z][A-Za-z0-9.&_-]{2,30})\b([^.]{0,48})/gi
  const inventedAffiliations: string[] = []
  for (const match of answer.matchAll(AFFILIATION)) {
    const org = match[1]!
    const tail = (match[2] ?? '').trim().replace(/[.,;]$/, '')
    const carriesDetail = /\b\d+\s*(?:year|yr|month)s?\b/i.test(tail) || /\bas\s+(?:an?\s+)?[a-z]/i.test(tail)
    if (!carriesDetail) continue
    const claim = `${org} ${tail}`.toLowerCase().replace(/\s+/g, ' ')
    if (evidence.includes(claim) || evidence.includes(org.toLowerCase())) continue
    inventedAffiliations.push(`${org}${tail ? `: ${tail.slice(0, 60)}` : ''}`)
  }
  if (inventedAffiliations.length) {
    checks.push({
      name: 'affiliations-unsupported',
      ok: false,
      note: `claims a role at ${inventedAffiliations.join('; ')} — no retrieved record states it`,
      blocking: true,
    })
  }

  const unknownNames = new Set<string>()
  const loweredAnswer = answer.toLowerCase()
  for (const match of answer.matchAll(PROPER_NOUN)) {
    const candidate = match[1]!.replace(/[.,;:]$/, '')
    if (!candidate || candidate.length < 3) continue
    const normalized = candidate.toLowerCase()
    if (ALLOWED_CAPITALS.has(normalized)) continue
    if (knownNames.some((name) => containsAnyName(candidate, name) || containsAnyName(name, candidate))) continue
    if (evidence.includes(normalized)) continue
    if (loweredAnswer.includes(normalized) && /^[A-Z]/.test(candidate) && candidate.split(' ').length === 1 && candidate.length <= 6) continue
    unknownNames.add(candidate)
  }
  checks.push({
    name: 'proper-nouns-known',
    ok: true,
    note: unknownNames.size ? `unrecognised capitalized terms: ${[...unknownNames].slice(0, 5).join(', ')} (advisory: they may be legitimate)` : 'every capitalized term matched the corpus or the allowlist',
    blocking: false,
  })

  if (input.mode === 'genai') {
    checks.push({
      name: 'provider-attribution',
      ok: Boolean(input.provider),
      note: input.provider ? `generated by ${input.provider.id}/${input.provider.model}` : 'mode claims a provider run that did not happen',
      blocking: true,
    })
  }

  if (input.mode === 'knowledge' && input.provider) {
    checks.push({ name: 'no-unused-provider', ok: false, note: 'a provider result exists but the mode says knowledge', blocking: true })
  }

  const truncatedRuns = input.runs.filter((run) => run.error?.includes('truncated'))
  if (truncatedRuns.length) {
    checks.push({ name: 'tool-output-size', ok: true, note: `${truncatedRuns.length} tool output(s) were truncated before synthesis`, blocking: false })
  }

  const verified = checks.every((check) => check.ok || !check.blocking)
  return { verified, checks }
}

export function summarizeVerification(report: VerificationReport): string {
  const failed = report.checks.filter((check) => !check.ok)
  if (!failed.length) return `${report.checks.length} check(s) passed`
  return `${failed.length} of ${report.checks.length} check(s) failed: ${failed.map((check) => (check.blocking ? '' : 'advisory ') + check.name).join(', ')}`
}
