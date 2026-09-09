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
    patterns: [/\b(who|what) are you\b/, /\byour name\b/, /\bwhat is raven\b/, /\bwho is raven\b/, /\bare you human\b/, /\bare you real\b/, /\bwere you built\b/, /\bwhat are you\b/],
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
    patterns: [/\bwho is riyan\b/, /\btell me about riyan\b/, /\babout riyan\b/, /\bwhat does riyan do\b/, /\bwho is he\b/, /\bhis background\b/, /\bintroduce riyan\b/, /\bwhat is riyan.?s (role|work|focus)\b/],
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

function extractSection(text: string): string | null {
  const lower = normalize(text)
  for (const id of SECTION_IDS) if (lower.includes(id)) return id
  if (/\bexperience\b|\bjourney\b/.test(lower)) return 'about'
  if (/\bexperiments\b/.test(lower)) return 'projects'
  return null
}

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
    add('portfolio.sections', 1.2, ['named-section'])
    if (scores.has('action.navigate')) add('action.navigate', 1.6, ['section-target'])
  }

  // A bare project mention with a question word is a lookup, not a list request.
  if (projectReference && /\b(what|tell|explain|about|how|why)\b/.test(lower)) add('portfolio.project', 1, ['interrogative'])

  // Preference statements are worth persisting; classify them as a remember turn so
  // the memory extractor has an obvious home, without losing the knowledge answer.
  if (/\bmy (favorite|favourite|preferred|least favorite)\b/.test(lower)) add('memory.remember', 2.4, ['preference-statement'])
  if (/\bi (am|use|work with|prefer|like|build with|know)\b/.test(lower) && !/\b(who|what)\b/.test(lower)) add('memory.remember', 1.4, ['self-statement'])

  if (options.hint) add('portfolio.sections', 0.5, ['caller-hint'])

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
    return {
      intent: pleasantry ? 'smalltalk' : 'unknown',
      confidence: pleasantry ? 0.5 : 0.05,
      signals: contentTokens ? [`tokens:${contentTokens}`] : ['empty'],
      entities: {},
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
  if (section) entities.section = section
  if (options.hint) entities.hint = options.hint

  return {
    intent,
    confidence: Number(confidence.toFixed(3)),
    signals: [...winning.signals],
    entities,
  }
}
