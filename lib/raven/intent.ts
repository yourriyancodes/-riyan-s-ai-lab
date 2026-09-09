/**
 * Deterministic intent classification.
 *
 * Every rule here is a pattern with a weight, so routing is reproducible and testable
 * ("what projects has Riyan built" cannot depend on a model's mood). The classifier
 * also extracts the entities the agents need — which project is being referred to,
 * which page section — because a tool argument is more honest than a guess later.
 */
import type { IntentMatch, RavenIntent } from './types'
import { findProject, projects } from './knowledge/corpus'
import { normalize, tokenize } from './knowledge/search'

type Rule = { intent: RavenIntent; weight: number; patterns: RegExp[]; signals: string[] }

const RULES: Rule[] = [
  {
    intent: 'identity.raven',
    weight: 3,
    // "tell me about yourself" used to land on the section list, because the only rule that
    // matched anything was a substring test that saw "about" and named the #about section.
    patterns: [/\b(who|what) are you\b/, /\byour name\b/, /\bwhat is raven\b/, /\bwho is raven\b/, /\bare you human\b/, /\bare you real\b/, /\bwere you built\b/, /\btell me about (yourself|you)\b/, /\bintroduce yourself\b/],
    signals: ['raven-identity'],
  },
  {
    intent: 'capability.probe',
    weight: 3,
    // Questions about what RAVEN *can reach* are capability probes, not portfolio
    // questions, and they deserve the tool that answers them with measured facts
    // (`system_status` lists the real tool set) instead of a shrug or an invented claim.
    patterns: [
      /\bwhat can you do\b/,
      /\byour capabilities?\b/,
      /\bare you (online|offline|working|up)\b/,
      /\bis (the )?(llm|model|backend|gemini|database|api)\b/,
      /\bdo you have (a )?(key|model|database)\b/,
      /\bwhich model\b/,
      /\bare you using (an )?llm\b/,
      /\bwhat (is your )?status\b/,
      /\bsystem status\b/,
      /\bdo you have (access|permission|the ability|capabilities)\b/,
      /\baccess (to )?(my|the) (computer|machine|laptop|files?|filesystem|disk|screen|camera|microphone|shell|terminal)\b/,
      /\bcan you (see|read|open|run|execute|browse|search|control|access|edit|delete)\b/,
      /\b(browse|search|check|look up|fetch) (the |on |up the )?(internet|web|online|internet's)\b/,
      /\b(internet|network|web) access\b/,
      /\bwhat (tools|permissions|sources|data)( are| do) (you|you do)\b/,
      /\bare you connected to\b/,
    ],
    signals: ['capability-question'],
  },
  {
    intent: 'identity.riyan',
    weight: 3,
    patterns: [/\bwho is riyan\b/, /\btell me about riyan\b/, /\babout riyan\b/, /\bwhat does riyan do\b/, /\bwho is he\b/, /\bhis background\b/, /\bintroduce riyan\b/, /\bwhat is riyan.?s (role|work|focus)\b/,
      // "tell me about your experience" addresses the portfolio's owner without naming them,
      // and used to fall through to the section list because nothing else matched. The second
      // and third patterns are the same request in the second person, phrased as people type it.
      // Deliberately noun-specific: `stack` and `tools` belong to the skills intent, and a
      // greedy "tell me about your…" stole every one of those lookups.
      /\b(your|his|the founder.?s) (experience|background|journey|story|work)\b/, /\bwhat (is|was) (your|his) (background|journey|story)\b/],
    signals: ['riyan-identity'],
  },
  {
    intent: 'portfolio.contact',
    weight: 3,
    patterns: [/\bcontact\b/, /\bhow (can|do) i (reach|contact|email|hire)\b/, /\bemail\b/, /\blinkedin\b/, /\bgithub\b/, /\bwhatsapp\b/, /\binstagram\b/, /\bhire (him|riyan)\b/],
    signals: ['contact'],
  },
  {
    intent: 'portfolio.experiments',
    weight: 2.5,
    patterns: [/\bexperiment(s|ing)?\b/, /\bcurrently (building|exploring|working on|researching)\b/, /\bwhat is (he|riyan) (building|exploring|researching)\b/, /\bprototype\b/, /\bresearch (interests|areas)\b/],
    signals: ['experiments'],
  },
  {
    intent: 'portfolio.skills',
    weight: 2.6,
    patterns: [/\bskills?\b/, /\bfocus\s+(areas|list)\b/, /\btechnolog(y|ies)\b/, /\bstack\b/, /\bprogramming languages?\b/, /\bwhat (does he|can he|do you know)\b/, /\btech\b/, /\btools (he|they) use\b/, /\bproficien(t|cy)\b/],
    signals: ['skills'],
  },
  {
    intent: 'portfolio.sections',
    weight: 2.4,
    patterns: [/\bsection(s)?\b/, /\bwhat (is|is on|does) this (page|site|portfolio) (contain|have)\b/, /\bparts of the (page|site)\b/, /\bnavigation\b/, /\bwhere (is|can i find)\b/],
    signals: ['sections'],
  },
  {
    intent: 'memory.remember',
    weight: 3.2,
    patterns: [/\bremember (that|this)\b/, /\bkeep (in )?mind\b/, /\bnote (that|this)\b/, /\bmemori[sz]e\b/, /\bi want you to remember\b/, /\bdon.?t forget\b/],
    signals: ['remember-command'],
  },
  {
    intent: 'memory.recall',
    weight: 3.2,
    // A recall question is phrased every way except the five patterns this used to have,
    // and every miss was worse than a wrong guess: the memory was stored but unreachable,
    // which is exactly the "memory that does not work" failure the whole layer exists to
    // avoid. Anything asking what *I* prefer/said/want is a recall, term-matched against the
    // session's own facts by `recall_memories`.
    patterns: [
      /\bwhat do you (remember|know about me)\b/,
      /\bdo you remember\b/,
      /\bmy (favorite|favourite|preferred) .*\b/,
      /\bwhat have i told you\b/,
      /\bmy preferences?\b/,
      /\brecall\b/,
      /\bwhat\b[^?!.]{0,48}\b(do|does|did) i (prefer|like|love|use|want|choose)\b/,
      /\bwhich\b[^?!.]{0,48}\b(do|does|did) i (prefer|like|use)\b/,
      // The object of "did I mention" is whatever the user said, so requiring one was a
      // mistake: "did I mention a preferred language?" is the common shape and it missed.
      /\b(do|did) i (ever )?(tell|say|mention|ask)\b/,
      // Referring back to the conversation is a recall question whatever its exact shape —
      // and offline it is answered from durable facts, which is what "remember" means here.
      /\bwhat did i (just )?(ask|say|tell|mention|ask you)\b/,
      /\bearlier\b/, /\bprevious(ly)?\b.*\bi\b/, /\b(just now|a moment ago)\b.*\bi\b/,
      /\bremind me\b/,
      /\bwhat (did|i) (i )?say\b/,
      /\bmy (go-to|default|usual)\b/,
    ],
    signals: ['recall-command'],
  },
  {
    intent: 'action.navigate',
    weight: 2.8,
    patterns: [/\b(scroll|go|jump|navigate|take me)\b.*\b(to|section)\b/, /\bopen the\b/, /\bshow me the\b.*\bsection\b/, /\blet me see the\b/],
    signals: ['navigation'],
  },
  {
    intent: 'compare.evaluate',
    weight: 3.4,
    patterns: [/\bcompare\b/, /\bwhich (of |project|one|system)?\b.*\b(best|strongest|most|closest|richest|deepest|coolest)\b/, /\brank\b/, /\bevaluate\b/, /\bbest demonstrates?\b/, /\bwhich shows?\b/, /\bpros and cons\b/, /\bdifference between\b/],
    signals: ['comparison'],
  },
  {
    intent: 'plan.multistep',
    weight: 3.1,
    patterns: [/\bplan\b/, /\bsteps? to\b/, /\bhelp me (figure out|decide|break down|audit)\b/, /\baudit\b/, /\band then\b/, /\bfirst.*then\b/, /\bbreak (this|it) down\b/, /\broadmap\b/, /\bwhat should i (build|do) (next|first)\b/],
    signals: ['multistep'],
  },
  {
    intent: 'explain.concept',
    weight: 2.2,
    patterns: [/\bexplain\b/, /\bwhat (is|are|does) .*\b(mean|means|work|do)\b/, /\bin simple terms\b/, /\bhow does\b/, /\bwhat is\b/, /\bdefine\b/, /\bwalk me through\b/],
    signals: ['explanation'],
  },
  {
    intent: 'greeting',
    weight: 1.6,
    patterns: [/^\s*(hi|hey|hello|yo|hola|namaste|good (morning|afternoon|evening))\b[\s!.,]*$/i, /^\s*(sup|what.?s up)\b/i],
    signals: ['greeting'],
  },
  {
    intent: 'smalltalk',
    weight: 1.4,
    patterns: [/^\s*(thanks?|thank you|ty|ok(ay)?|nice|cool|great|cool|awesome|bye|goodbye|see ya|lol|hmm+)\b[\s!.,]*$/i],
    signals: ['smalltalk'],
  },
]

// Projects are matched structurally rather than by keyword, so "the sign language
// thing" finds the record and "what projects exist" still lists them.
const PROJECT_QUERY = /\bproject(s)?\b|\bwork(s)?\b|\bbuilt\b|\bportfolio\b|\bsystems?\b|\bapp(s)?\b|\bgames?\b/

export type ClassifyOptions = {
  /** Extra hints from the caller, e.g. a section id the console is focused on. */
  hint?: string
}

function extractProjectReference(text: string): string | null {
  const lower = normalize(text)
  const named = projects.find((project) => lower.includes(normalize(project.name)))
  if (named) return named.name
  const numbered = lower.match(/\b(?:project\s*)?(0?[1-5])\b/)
  if (numbered) {
    const match = findProject(numbered[1])
    if (match) return match.name
  }
  return null
}

const SECTION_IDS = ['hero', 'projects', 'skills', 'about', 'contact'] as const

/**
 * A section reference has to *look like* one. The first version of this function asked
 * `lower.includes(id)`, which is a substring test on ordinary English: "what does Riyan
 * think **about** bulb futures" named the #about section at 0.98 confidence and answered with
 * a list of page sections, and "**skills**" inside "what skills do you lack" would have done
 * the same. A bare word is a reference only when it is anchored (#about) or sitting next to
 * a word that makes it one ("the about section", "scroll to contact").
 *
 * `topic` results are the deliberately weaker class: "tell me about your experience" has no
 * section word in it at all, and used to work, so the mapping stays — but it can no longer
 * outvote a lookup, which is what the weight at the call site is for.
 */
type SectionReference = { id: (typeof SECTION_IDS)[number]; kind: 'explicit' | 'topic' }

const SECTION_ANCHOR = (id: string) =>
  new RegExp(`#${id}\\b|\\b${id}\\b\\s*(?:section|part|anchor|block)|(?:section|anchor|menu\\s+item|part\\s+of\\s+the\\s+(?:page|site))\\b[^?]{0,20}\\b${id}\\b|(?:scroll|jump|navigate|go|open|show|link|jump)\\b[^?]{0,14}\\b${id}\\b`)

function extractSection(text: string): SectionReference | null {
  const lower = normalize(text)
  for (const id of SECTION_IDS) if (SECTION_ANCHOR(id).test(lower)) return { id, kind: 'explicit' }
  if (/\bexperience\b|\bjourney\b/.test(lower)) return { id: 'about', kind: 'topic' }
  if (/\bexperiments\b/.test(lower)) return { id: 'projects', kind: 'topic' }
  return null
}

/* ------------------------------------------------------------------ *
 * Follow-up resolution
 *
 * "Which one uses RAG?" is not an independent question. Answering it
 * requires the answer that came immediately before, and treating the
 * message as if it stood alone — which the classifier, being a pure
 * function of one string, correctly does — throws that away and produces
 * a refusal on a page that has the data. So resolution happens here, in
 * one deterministic step, before the router ever sees the turn.
 *
 * Three rules keep it from becoming a hallucination generator:
 *   • it only runs on *short referential* messages, never on a question
 *     that carries its own subject;
 *   • a referent must have been actually mentioned in the previous
 *     answer — nothing is invented from the corpus at large;
 *   • it resolves to at most one project, by the user's own words first,
 *     an ordinal second, and token overlap last, and abstains when the
 *     evidence is ambiguous.
 * ------------------------------------------------------------------ */

export type RecentTurn = { role: string; content: string }
export type ResolvedReferent = { name: string; how: 'term' | 'ordinal' | 'overlap'; note: string }

const ORDINAL_INDEX: Record<string, number> = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5, seventh: 6, eighth: 7 }
const REFERENTIAL = /\b(which one|which ones|which of them|which of those|the (?:first|second|third|fourth|fifth|last|latter|former)(?: one)?|that one|this one|those (?:two|three)?|it|its|they|them)\b/
/** How far back a follow-up may reach. Bounded, like everything else here. */
const LOOKBACK = 3
/**
 * An ordinal ("the second one") is a pointer into a *list*, so the reach for it is measured in
 * answers rather than rows, and stops at the first answer that named two or more projects. Bounded,
 * because a four-turn-old list is not what a person means by "the second one".
 */
const ORDINAL_LOOKBACK = 5

/** How many distinct projects an answer named, in the order it named them. */
function mentions(text: string): { name: string; at: number }[] {
  const haystack = normalize(text)
  return projects
    .map((project) => ({ name: project.name, at: haystack.indexOf(normalize(project.name)) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
}

export function resolveProjectReferent(text: string, recent: readonly RecentTurn[]): ResolvedReferent | null {
  const clean = normalize(text)
  if (!clean) return null
  const words = clean.split(' ')
  // A message with a subject of its own is not a follow-up, however many "it"s it contains.
  if (words.length > 14 || !REFERENTIAL.test(clean)) return null
  // The window is counted in things RAVEN *said*, not in table rows: an intervening question and
  // its one-line acknowledgement would otherwise spend two of three slots and put the listing the
  // user is pointing at out of reach (measured across a restart: "And what about the first one?"
  // resolved to the previous answer's single project instead of the listing two turns earlier).
  // `recent` arrives oldest-first from every adapter, so the tail of the array is the recent part.
  const said = recent.filter((turn) => turn.role === 'raven' && turn.content).reverse() // newest first
  if (!said.length) return null
  const ordinal = /\bthe (first|second|third|fourth|fifth|sixth|seventh|eighth)\b|\bthe last\b/.exec(clean)
  // An ordinal can only point at a *list*, so for those the search is for the most recent answer
  // that actually listed two or more projects — up to ORDINAL_LOOKBACK answers back, and no
  // further. If nothing in that reach was a list, the phrase has no referent here and the turn is
  // abstained on rather than matched to whatever project happens to be in the corpus first.
  const listing = ordinal
    ? said
        .slice(0, ORDINAL_LOOKBACK)
        .map((turn) => ({ turn, named: mentions(turn.content).length }))
        .find((entry) => entry.named >= 2)
    : null
  const priorSource = ordinal ? (listing?.turn.content ?? '') : said.slice(0, LOOKBACK).map((turn) => turn.content).join(' ')
  const prior = normalize(priorSource)
  if (!prior) return null

  // Only projects that answer actually named are candidates, ordered by where it said them and not
  // by corpus order: "the first one" means first *in the answer RAVEN just gave*, and taking the
  // corpus's first project instead would be a different sentence wearing the same words.
  // Names are compared normalized, because a reply stores "RAG Knowledge Assistant" and a
  // lowercased needle would never find it otherwise.
  const mentioned = projects
    .map((project) => ({ project, at: prior.indexOf(normalize(project.name)) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.project)
  if (!mentioned.length) return null

  // Positional reference, resolved against the listing it pointed at.
  if (ordinal?.[1]) {
    const chosen = mentioned[ORDINAL_INDEX[ordinal[1]]]
    if (chosen)
      return {
        name: chosen.name,
        how: 'ordinal',
        note: `“${clean}” resolved to “${chosen.name}” (position ${ORDINAL_INDEX[ordinal[1]] + 1} of that ${mentioned.length}-item list)`,
      }
    // Named fewer items than the ordinal asks for: "the fourth one" after a list of two is not a
    // question about this corpus, and guessing the third project would be a fabrication.
    return null
  }
  if (/\bthe last\b/.test(clean)) {
    const chosen = mentioned[mentioned.length - 1]!
    return { name: chosen.name, how: 'ordinal', note: `“${clean}” resolved to the last project in that answer (“${chosen.name}”)` }
  }

  const terms = tokenize(text)
  const asKey = (value: string) => tokenize(value)
  const named = mentioned.find((project) =>
    terms.some((term) => asKey(project.name).includes(term) || asKey(project.technology ?? '').includes(term) || asKey(project.description ?? '').includes(term)),
  )
  if (named) return { name: named.name, how: 'term', note: `“${clean}” resolved to “${named.name}” by the words in the question` }

  // Last resort: score the candidates by overlap with the question, and only accept a single
  // clear winner. Two candidates on the same score is a coin flip, and a coin flip is not a
  // resolution — better to leave the turn as an honest `unknown`.
  const scored = mentioned
    .map((project) => ({ project, hits: terms.filter((term) => asKey(`${project.name} ${project.description ?? ''} ${project.technology ?? ''}`).includes(term)).length }))
    .sort((a, b) => b.hits - a.hits)
  if (scored[0] && scored[0].hits > 0 && (scored[1]?.hits ?? 0) < scored[0].hits) {
    return { name: scored[0].project.name, how: 'overlap', note: `“${clean}” resolved to “${scored[0].project.name}” as the only candidate the question’s words matched` }
  }
  return null
}

/**
 * An exclusion phrase — "something outside the portfolio", "anything not in your records" — asks
 * about the *edge* of this knowledge base, not for the list in the middle of it. Every rule below
 * scores vocabulary, and `portfolio` is in PROJECT_QUERY, so without this guard an honest "I have
 * no record of that" was displaced by a confident project listing (live: "Tell me something outside
 * the portfolio knowledge base." → five projects). Portfolio-shaped intents are dropped here so the
 * turn falls through to `unknown` and is treated the way any unmatched question deserves: retrieval,
 * then a refusal if nothing in this corpus answers it.
 */
const OUTSIDE_SCOPE_REQUEST =
  /\b(outside|beyond|not\s+(?:in|from|on)|other\s+than|besides|excluding)\s+(?:the\s+|your\s+|this\s+)?(?:\w+\s+){0,2}?(portfolio|knowledge\s*base|knowledge|site|corpus|records?|scope|docs?|documentation)\b/i

/**
 * A request about work that does not exist yet — "suggest a CLI architecture for my next project" —
 * is not a question about the records, and answering it with a project listing is a non-sequitur
 * wearing a citation. These are demoted to `unknown` so a configured provider reasons about them
 * (clearly labelled as provider synthesis) and, when none is configured, the turn is refused.
 */
const HYPOTHETICAL_REQUEST =
  /\b(my next|next project|new project|project idea|architecture for|ideas for (?:a|my|the)|what should i build|suggest a|suggest some|recommend a|help me (?:build|plan|design))\b/i

const PORTFOLIO_SHAPED_INTENTS: RavenIntent[] = ['portfolio.projects', 'portfolio.project', 'portfolio.skills', 'portfolio.experiments', 'portfolio.sections']

export function classifyIntent(message: string, options: ClassifyOptions = {}): IntentMatch {
  const text = message.replace(/\s+/g, ' ').trim()
  const lower = text.toLowerCase()
  const tokens = tokenize(text)
  const scores = new Map<RavenIntent, { score: number; signals: Set<string> }>()

  const add = (intent: RavenIntent, amount: number, signals: string[]) => {
    const entry = scores.get(intent) ?? { score: 0, signals: new Set<string>() }
    entry.score += amount
    for (const signal of signals) entry.signals.add(signal)
    scores.set(intent, entry)
  }

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(lower)) {
        add(rule.intent, rule.weight, rule.signals)
        break
      }
    }
  }

  if (PROJECT_QUERY.test(lower)) add('portfolio.projects', 2.2, ['project-vocabulary'])

  const projectReference = extractProjectReference(text)
  if (projectReference) {
    add('portfolio.project', 3.6, ['named-project'])
    if (!scores.has('portfolio.projects')) add('portfolio.projects', 0.6, ['weak-list-signal'])
  }

  const section = extractSection(text)
  if (section) {
    // Explicit references keep the old weight; a topic-only hint is a tiebreaker, not a
    // verdict, so a question that merely contains "about" cannot beat the intent it asks.
    // Only an explicit reference is an intent. A topic hint ("experience" → about) is
    // recorded in `entities` so a composer can use it, but letting it vote turned "does
    // Riyan have experience with Kubernetes operators" into a confident request for the
    // section list — a question about a technology with nothing in this corpus to answer it.
    if (section.kind === 'explicit') {
      add('portfolio.sections', 1.2, ['section:explicit'])
      if (scores.has('action.navigate')) add('action.navigate', 1.6, ['section-target'])
    }
  }

  // A bare project mention with a question word is a lookup, not a list request.
  if (projectReference && /\b(what|tell|explain|about|how|why)\b/.test(lower)) add('portfolio.project', 1, ['interrogative'])

  // Preference statements are worth persisting; classify them as a remember turn so
  // the memory extractor has an obvious home, without losing the knowledge answer.
  if (/\bmy (favorite|favourite|preferred|least favorite)\b/.test(lower)) add('memory.remember', 2.4, ['preference-statement'])
  if (/\bi (am|use|work with|prefer|like|build with|know)\b/.test(lower) && !/\b(who|what)\b/.test(lower)) add('memory.remember', 1.4, ['self-statement'])

  if (options.hint) add('portfolio.sections', 0.5, ['caller-hint'])

  // Two phrases mark a question the records cannot answer. The portfolio-shaped intents they would
  // otherwise have triggered are removed here, and the *reason* travels with the turn: the composer
  // refuses instead of listing near-misses, and the trace shows a suppression rather than a silent
  // no-match. Each entry is `reason:intent`, so nothing about the decision is hidden from the log.
  const suppressed: string[] = []
  for (const [reason, matcher] of [
    ['outside-scope', OUTSIDE_SCOPE_REQUEST],
    ['hypothetical', HYPOTHETICAL_REQUEST],
  ] as const) {
    if (!matcher.test(lower)) continue
    for (const intent of PORTFOLIO_SHAPED_INTENTS) if (scores.delete(intent)) suppressed.push(`${reason}:${intent}`)
  }
  const suppressionReasons = [...new Set(suppressed.map((entry) => entry.slice(0, entry.indexOf(':'))))]

  // Nothing matched. `smalltalk` is a claim about the *words*, not about their count: the
  // previous test here was `contentTokens <= 2`, which silently turned every short question
  // ("access computer", "phone number", "your price") into a pleasantry and answered it with
  // the small-talk acknowledgement — a shrug, on a page whose whole promise is that the
  // answers come from real data. So: only an actual pleasantry is small-talk, and everything
  // else is `unknown`, which routes to a provider when one is configured and to an explicit
  // "not grounded, not invented" refusal when one is not.
  const contentTokens = tokens.length
  if (!scores.size) {
    const pleasantry =
      /^\s*(?:thanks?|thank you|ty|ok(?:ay)?|nice|cool|great|awesome|bye|goodbye|see ya|later|lol|hmm+|yep|yeah|nope|hi|hello|hey|yo|sup|howdy|morning|evening)\b[\s!.,?]*$/i.test(
        lower,
      )
    // The fallback used to return `entities: {}`, which discarded whatever the pass had
    // already learned (a section word, a token count). Nothing here has enough evidence to
    // name an intent, but that is no reason to throw the measurements away — a `unknown`
    // turn still routes to a tool run that can use them.
    return {
      intent: pleasantry ? 'smalltalk' : 'unknown',
      confidence: pleasantry ? 0.5 : 0.05,
      // A suppression is itself a measurement: "I dropped a portfolio intent because you asked for
      // something the records cannot answer" belongs in the trace, not silently inside the classifier.
      signals: [...(suppressed.length ? [`suppress:${suppressed.join(',')}`] : []), ...(contentTokens ? [`tokens:${contentTokens}`] : ['empty'])],
      entities: {
        ...(contentTokens ? { tokens: contentTokens } : {}),
        ...(section ? { section: section.id } : {}),
        ...(suppressionReasons.length ? { unanswerableByCorpus: suppressionReasons.join('+') } : {}),
      },
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
  const [intent, winning] = ranked[0]
  const runnerUp = ranked[1]?.[1].score ?? 0
  const margin = winning.score - runnerUp
  // Confidence is a margin, not a feeling: a contested classification stays low and
  // the router keeps the conservative mode.
  const confidence = Math.max(0.1, Math.min(0.98, winning.score / (winning.score + runnerUp || 1) + (margin > 2 ? 0.25 : 0)))

  const entities: Record<string, string | number> = { tokens: contentTokens }
  if (projectReference) entities.project = projectReference
  if (section) entities.section = section.id
  if (options.hint) entities.hint = options.hint

  return {
    intent,
    confidence: Number(confidence.toFixed(3)),
    signals: [...winning.signals, ...(suppressed.length ? [`suppress:${suppressed.join(',')}`] : [])],
    entities: suppressed.length ? { ...entities, unanswerableByCorpus: suppressionReasons.join('+') } : entities,
  }
}
