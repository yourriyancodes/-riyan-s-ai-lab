# RAVEN brain — backend / GenAI / agentic audit

Audit of the shipped brain against the integration brief, performed against **the running HTTP
system**, not the documentation. Baseline before any change: `npm run check` 428 green, `tsc`
clean, `next build` clean — and the audit still found eleven defects. A suite that passes proves
the assertions it contains, nothing more.

Method: three instances side by side, so every claim is a comparison rather than a reading.

| port | database | provider | purpose |
| --- | --- | --- | --- |
| 3100 | file | none | the fresh-clone default |
| 3101 | sqlite (`node:sqlite`) | none | durability + offline honesty |
| 3102 | sqlite | `scripts/local-provider-stub.mjs` on 3199 | provider transport, end to end |

The endpoint on 3199 is a **test double**: no weights, two canned sentences. It exists so the
provider code path can be exercised over real sockets for $0. Nothing in this repository calls it
intelligence, and `mode=genai`/`provider=openai-compatible` against it is a statement about which
transport answered, not about reasoning having happened.

Reproduce:

```bash
node scripts/local-provider-stub.mjs &                                  # plumbing, not a model
RAVEN_BASE_URL=http://127.0.0.1:3199/v1 RAVEN_API_KEY=x RAVEN_MODEL=stub-1 npm run dev
```

---

## A. Brain orchestration — correct
`runBrainTurn()` is the single orchestrator; the sequence is input → context → intent → route →
retrieval → (actions) → compose → verify → persist → respond, with one `respond()` builder so
refusals, clarifications and answers share one shape. `route.mode` never overrides what actually
delivered: a turn planned agentic and answered deterministically reports the mode that answered and
names the gap in `degraded`.

## B. Intent classification — defect fixed
`02:00` in "Remember that my canary release window is **Thursday 02:00**" was read as *project
number 02*: a `memory.remember` turn answered with the Sign Language Detector card and never
confirmed the write. A bare digit is now a reference only when anchored ("project 3", "card 01",
"#2"), and clock patterns are masked first. `tell me about project 3` / `what does #2 do` still
resolve; a phone number and "item 3 of the plan" no longer select a project.

## C. Context — correct, one gap closed
Recent turns are read per conversation with a bounded window, and the referent resolver now reads
them in the right order (see M). Follow-up resolution widens for ordinals only, so a listing two
answers back is still in reach after an unrelated exchange.

## D. Memory — two defects fixed
1. **Unrelated facts reached substantive prompts.** The importance fallback fired whenever a search
   matched nothing, so "How does Riyan deploy Kubernetes operators?" imported a 0.9-importance
   "prefers Rust" preference. It now fires only when the message has **no content terms at all**
   (the "hi" case it was written for). `assert memories.length === 0` for the unrelated question,
   `> 0` for `hi`.
2. **A retrieved fact could not answer.** With the memory in hand (`retrieved: 1`), the turn still
   returned 502, because every composer reads only the repository's records. There is now a
   memory-anchored branch: the answer quotes the row, names the key, the date and the store, states
   that it is *not* portfolio data, and cites `kind:'memory'` — with the quoted value added to the
   evidence the verifier reads, so `figures-match-evidence` is satisfied by the row rather than
   failing on a number that is genuinely in evidence. Two shared-wordings later: a one-term match is
   accepted only when the question is one term long, so "what is my kubernetes operator **port**?"
   does not get answered by a **port** fact, and nothing crosses sessions.

## E. Knowledge retrieval — correct
Lexical, BM25-family, and labelled that way in code and docs — no "semantic", "embedding" or
"vector similarity" claim anywhere in `lib/raven/**`. Relevance floors live inside the composers:
`explain.concept` requires the term to appear in the record it cites; the generic path requires a
phrase match or two matched terms.

## F. GenAI provider — correct, one addition
Vendor-agnostic resolution (`RAVEN_PROVIDER`/`RAVEN_BASE_URL`/`RAVEN_MODEL`), OpenAI-compatible and
Gemini adapters, no vendor hard-coded in the brain. `provider` reports only a request that
succeeded; a fallback sets `metadata.provider = null`. Added: **local endpoint detection**
(`detectLocalProvider`) reported by health as `localModel {probed, reachable, authorized, detail,
baseUrl, selected, hint}` — on this machine `{"probed":true,"reachable":false,"authorized":null,
"detail":"nothing is listening on http://127.0.0.1:11434/v1 (network)","selected":false}`.
Detection never routes; `selected` is only true when it is also the configured provider.

## G. Agentic execution — defect fixed
`PLAN → EXECUTE → OBSERVE → REASON → VERIFY → SYNTHESIZE` with a per-turn step ceiling and dedupe by
already-run tools. Two fixes: a design question about **this** portfolio ("Design a realistic
architecture for adding authentication to Riyan's portfolio") was refused offline because no record
describes unbuilt work — it now routes agentic, retrieves the records that constrain the answer, and
composes deterministically when no provider is authorized (`mode=agentic provider=none
degraded=genai verified=true cite=4` measured). And the synthesis step was missing from the trace of
agentic turns; `synthesis` now appears with what happened (provider used / refused / absent / on
cooldown).

## H. Tool execution — gap closed
Each of the 16 tools declares name, description, input schema, permission, approval requirement and
timeout; **`deterministic` was missing** and is now required at registration (a tool that writes or
reads a mutable store declares `false`; `request_navigation` does, because its outcome depends on
approval state). Runs persist with input, output, status and duration; `metadata.toolRuns` carries
the rows, and step records now carry positional `id`s with `runId` links to the run behind them.

## I. Verification — defect fixed
Blocking checks: `answer-present`, `claims-grounded`, `grounded-mode-has-evidence`,
`figures-match-evidence`, `provider-attribution`, `no-unused-provider`, `affiliations-unsupported`;
advisory: `proper-nouns-known`, `tool-output-size`. The bug: the "could not fully verify" disclaimer
was appended to **greetings** ("hi" → *"…This answers come straight from the portfolio data… I could
not fully verify that (grounded-mode-has-evidence), so treat it as unconfirmed"*), which is a
contradiction about provenance plus a leaked internal check id. The disclaimer now requires claims on
the table (runs, citations or evidence), the ids moved to the trace, and the withheld decision is
itself recorded as `verification-disclaimer`.

## J. Database persistence — correct
`node:sqlite` only, WAL + `PRAGMA foreign_keys = ON`, parameterized everywhere, transactions for
multi-row turns, five indexes, oldest-first `recentMessages` contract asserted for three adapters,
schema parity with the Postgres DDL asserted column by column, concurrent turns all 200, restart
durability for all five tables including the JSON run rows. No silent engine switch: fallbacks are
reported in `database.degradedFrom` and in the turn's `persistence` trace event.

## K. Error handling — correct
Every failure path returns the canonical shape. A throwing tool is a failed run; a throwing provider
degrades; a throwing memory write is reported as a failure and nothing is claimed. Verified again:
no refusal leaks a stack frame or an internal path.

## L. Rate limiting — correct
Per-session, in-process window. Measured live at `RAVEN_RATE_MAX=2`: `200, 200, 429, 429` with
`retry-after: 60` and the full canonical body on the rejected turns.

## M. Provider breaker — correct
`lib/raven/breaker.ts`, threshold 2, 60 s hold, first success closes it. While open the agent gets a
handle that fails on contact instead of dialling out — measured 1560 ms → 1527 ms → **14 ms** with
the answer still `verified=true cite=7`, and `x-raven-breaker: open`. Follow-up resolution
defects fixed here: "it" now attaches to the **last** answer before the window widens (so "What
technologies does it use?" returns that project's own stack: *"RAG Knowledge Assistant declares:
Python, LangChain / LlamaIndex, Vector Databases, RAG, FastAPI"*, naming which list it read);
a follow-up that points at nothing resolvable **asks which one**, listing the actual candidates,
instead of letting a provider answer a question nobody asked; and a comparison naming two positions
binds both ("Compare the first and third projects") or abstains when one is out of range — half a
comparison is a different question. Words past "eighth" and numeric forms ("the 3rd") resolve too.

## N. Security — correct
The only filesystem surface is `fileStore`, whose directory comes from config and whose filenames
come from a fixed map — no request-controlled path, so no traversal. No `child_process`, no exec, no
shell tool, no URL fetching driven by request input (so no SSRF from a message). Tool inputs are
validated against declared parameters with a 400-character string cap and output caps; `action`
tools are approval-gated; `drop_database` does not exist and is asserted non-executable. Keys never
enter the serializable config, are absent from health bodies, and are absent from logs.

## O. Observability — correct, one addition
One measured line per turn (intent, confidence, mode, state, verified, steps, tools, tool-run
statuses, provider, breaker, db driver, memory +/−, input chars, context chars, degraded, error,
ms) and one per rejection — and never the user's words, the prompt, the response or a secret
(asserted). Added: `x-raven-session-source` / `x-raven-conversation-source` headers, because a
rejected client id is silently replaced, and silent replacement is indistinguishable from amnesia.

## P. API contracts — correct, one floor relaxed
Stable top-level set on every response including errors; `400 invalid_json`, `422 empty_input`,
`413 too_long`, `429 rate_limited`, `502` for nothing-grounded, `500` as a well-formed body. The
conversation-id validation floor was **6 characters**, so `p13` became a new conversation each turn
and the follow-up lost its history — measured, and the cause of a false "referent broken" report
during this audit. Floor is now 3 for both ids, with a test that a short id is honoured and that a
replacement is visible in the response rather than inferred.

## Q. Concurrent turns — correct
Six simultaneous turns: 66 ms total, all 200, all `verified=true`, six distinct answers — no shared
buffers, no borrowed evidence between sessions.

## R. State transitions — correct
`states.ts` owns legality; the UI learns states from the response's trace, once per change, with no
client-side simulation. `VERIFYING` is entered only when there are runs or citations to check;
`LISTENING → THINKING/REASONING → EXECUTING → VERIFYING → SPEAKING → IDLE` for an agentic turn,
`… RESEARCHING → VERIFYING → SPEAKING` for an offline factual one, `… → OFFLINE` for a refusal —
each measured from the trace of a live turn.

---

## Live results (final build)

| path | measured |
| --- | --- |
| **A — local knowledge, provider configured** | `200 mode=knowledge provider=none verified=true cite=1–2 tools=1–2`, 9–16 ms; byte-identical to the no-provider instance; **zero** provider requests (endpoint log: 16 calls across ~60 turns, all of them PATH B/C-shaped) |
| **B — agentic, no provider** | `200 mode=agentic provider=none verified=true cite=4–7 tools=1–3 degraded=genai`, 18–19 ms |
| **B — agentic, provider authorized** | `200 mode=agentic provider=openai-compatible verified=true cite=6–8 steps=5–6`, 18–47 ms |
| **C — grounded synthesis** | `mode=agentic provider=openai-compatible verified=true cite=8`, trace `input>persistence>context>intent>route>retrieval>synthesis>verification>verification-report>compose-response`, "5 check(s) passed", 4,733-byte grounded prompt carrying the stored preference (`sawMemory=true`) |
| breaker | 1560 ms → 1527 ms → **14 ms** skipped, `x-raven-breaker: open`, answer intact |
| refused key | `PARTIALLY_READY`, `authorized=false`, note names 401/403, turn still answered from tools, key absent from body/health/log |
| rate limit | `200, 200, 429, 429`, `retry-after: 60`, canonical shape |
| restart | memory answers, referent and ordinal resolve from pre-restart listings, all from SQLite |
| concurrency | 6 turns, 66 ms, 6/6 distinct and verified |
| health | `breaker{state:'closed',failures:0,cooldownMs:0,threshold:2}`, `localModel{probed:true,reachable:false,selected:false}`, 16/16 tools with `deterministic`, no credential echo |

`npm run check` **442 green** (13 assets · 70 speech · 92 voice · 89 framing · 38 machine · 100 brain
· 40 backend), `tsc --noEmit` clean, `next build` clean.

## Status

```
LOCAL KNOWLEDGE: FUNCTIONAL, VERIFIED LIVE
DATABASE:        FUNCTIONAL (file · sqlite verified; postgres/postgres-rest code-complete, unexercised)
AGENTIC ENGINE:  FUNCTIONAL, VERIFIED LIVE (tools → evidence → compose, budgets enforced)
MEMORY:          FUNCTIONAL, VERIFIED LIVE (relevance-gated, isolated, survives restart)
VERIFICATION:    FUNCTIONAL, VERIFIED LIVE (7 blocking checks, grounding not topicality)
GENAI PLUMBING:  READY — one env var from live (RAVEN_API_KEY / RAVEN_BASE_URL)
LIVE GENAI:      NOT AVAILABLE on this machine (no key; 127.0.0.1:11434 refused; no ollama binary)
```

## Remaining limitations

- **Grounding is verified; topicality is not.** A provider that answers beside the question can still
  pass: the stub's canned CLI paragraph, returned for an authentication-design question, is quoted
  from cited records and so is `verified=true`. A keyword "relevance" gate would false-positive on
  legitimate paraphrase and read as a hallucination detector; it was considered and not built. What
  was built is the rule that removes the worst case — an unresolvable follow-up is never handed to a
  model at all.
- Retrieval is lexical. Multi-hop questions lean on the planner's tool list, not on search quality.
- Postgres and Supabase REST are parity-tested at the SQL level only; nothing here ran them.
- No owner authentication: memories are session-scoped by cookie/header, which is isolation from
  other visitors, not protection for the owner's own data.
- Voice and rendering are outside this pass. `speechSynthesis` cannot run in this sandbox, and the
  frozen 3D layer was verified by suite + code inspection only — no GPU, no headless browser.
- Rate limiting and the breaker are per-process; two workers mean two counters.

---

# Phase 2 — the intelligence core, measured before it was touched

The brief said optimise, and the honest first move was to find out what there is to optimise. Nothing
in the engine was slow, which changed what this round was for.

## P2.0 The measurements

120 live turns on the committed build (5 rounds × the 12 phrasings the Phase-2 brief itself used),
three instances sharing nothing but code — file store, SQLite store, and SQLite plus a local
OpenAI-compatible endpoint:

| Measure | Result |
| --- | --- |
| turn latency | **p50 6 ms · p95 18 ms · max 104 ms** (the max is a conversation's cold first turn) |
| per-phase means | input 1 · persistence 1–2 · context 1 · intent 1 · route 0 · retrieval 2–4 · synthesis 1 · verification 1–7 ms |
| `classifyIntent` | 0.040 ms (400 iterations, in-process, warm) |
| `searchKnowledge` | 0.033 ms |
| `searchKnowledge` + `rankProjects` | 0.016 ms |
| `registry.execute` (one tool, real handler) | 0.015–0.022 ms |
| `verifyAnswer` | 0.005 ms |

So: a whole local turn costs about the same as one network round trip to any provider. The
engine has no bottleneck to remove; it has **wasted work to avoid**. Everything below is avoidance.

## P2.1 Request lifecycle — no change was justified

The trace already spends 1–7 ms per phase and the sum equals the turn. What was wrong was not timing
but *sequence*: a turn could spend a provider call on a sentence it already had (P2.3).

## P2.2 Routing — one gap: memory could not preempt

Rules 4 A–E held under testing except CASE B: "memory ⇒ no model unless synthesis is needed" was true
of the *knowledge* route and false of the *genai* route, where a retrieved memory was pasted into a
prompt and then paid for anyway. Now `memoryMatch()` runs before any engine and answers directly
when two content words agree (one, for a one-word question).

Measured on the same question, same session, same build, with a local endpoint live:
**13 ms + 1 provider call → 7 ms + 0 calls**, `mode=knowledge`, `provider=none`, `verified=true`.
The inverse is pinned too: an irrelevant stored fact must *not* suppress a synthesis call.

A second routing gap surfaced the same way — by driving it, not reading it. "Analyse the retrieval
pipeline in this project and recommend what to improve first" scored `portfolio.projects` at 0.98
*because it contains a project word*, and was answered with the project listing: honest, cited, and
not the question that was asked. `intent.ts` now has an evaluative rule — an evaluative verb
(`analyse / review / assess / recommend / improve / weakest / bottleneck …`) together with a body of
work (`portfolio / project / pipeline / stack / retrieval …`) — weighted above both the listing and a
named-project lookup, choosing `plan.multistep` when the question asks what to change and
`compare.evaluate` when it asks for a verdict. It defers to the existing scope rules, so a plan for a
project that does not exist yet stays the refusal it was (that deferral is asserted by name). Measured
afterwards: `mode=agentic`, real runs, citations, `verified=true`, with the model used when one is
configured and a stated deterministic scaffold when it is not.

## P2.3 Memory — record completeness without a migration

`MemoryRecord` now carries `kind` (preference / fact / reference / correction / note), derived at the
read boundary in every driver's row mapper and named at the write, so no table needed a column for a
label that is recomputable from the key and value it already stores. A file row with the field deleted
still reads back with the right kind — asserted on the bytes on disk, not on a mock. The importance
fallback, the relevance floor, and the session-scope rule are unchanged from Phase 1.

## P2.4 Retrieval — verified as already fine, and left alone

`knowledgeIndex()` is memoized with a `resetKnowledgeIndex()` seam for tests; `documentsByTag` filters
34 documents (0.03 ms); `system_status` uses `peekDatabaseHandle()`; `inspectDatabase` reuses
`getDatabase()`. A WeakMap cache for the index — the obvious-looking optimisation — would memoise a
memoisation. Rejected with the measurement attached.

## P2.5 Agentic execution — duplicate work was keyed on the wrong thing

The agent refused any tool that had already run this turn. That is not duplicate work; duplicate work
is the *same call*. Keyed by `callSignature(tool, input)` (sorted keys, JSON values, bare name for an
argument-less tool), a comparison can now fetch two project records — `get_project ×2` with
`agent-step-1`/`agent-step-2` on the runs, measured 14 ms and 6 citations live — while the identical
call is still refused, and a retry with different arguments is possible for the first time.
`PlanStep`s are numbered when the plan is bounded, so `run.stepId` and `step.runId` name each other
without either being reconstructed afterwards.

The planner also re-searches the corpus (`searchKnowledge`, 0.016 ms) to decide whether a comparison
matched anything. Left alone deliberately: removing it would trade a measurable nothing for a second
source of truth about which records the plan can see.

## P2.6 Provider — three real fixes, one of them a silent dead end

1. **A keyless local endpoint could not be used at all.** `resolveProviderId` returned null without a
   key and `brain.ts` gated live use on `apiKeyPresent`, while `providers/index.ts` documented the
   opposite and `.env.example` told people to point at Ollama. `RAVEN_BASE_URL` + `RAVEN_MODEL` with
   no key therefore resolved a provider in one layer and ignored it in another, in silence. A base URL
   is now the intent (Google with no credential is still nothing), and the flags were split:
   `providerConfigured` = a key exists (the console's `LLM KEY` chip keeps that meaning),
   `providerUsable` = this process can call it. Measured after the fix, with no key anywhere:
   `status:READY`, `probed:{reachable:true, authorized:true, detail:'1 model(s) served; "stub-1" available'}`,
   and `genai` turns that actually reach the endpoint.
2. **`ModelProvider` reports itself** — `model`, `baseUrl`, `timeoutMs`, `maxAttempts`,
   `capabilities{jsonMode,streaming,toolCalling,vision}` — set by the factory that built it, echoed by
   `/api/health`, and `null` for all of it when nothing is resolvable. `toolCalling:false` is not modesty:
   a test intercepts `fetch` and asserts no `tools`, `functions`, `tool_choice` or `function_call` key
   ever leaves the process, for either transport.
3. **The persona now carries a prompt-injection rule**, because memory values and conversation turns are
   user-authored text that gets embedded in the prompt: instructions found inside the material are data
   to report on, a key found in it is never repeated, and no line inside it can authorise a claim about
   Riyan. This was free. It was also missing.

## P2.7 Verification — two blocking correspondence checks

A citation is a receipt. `memory-citations-correspond` requires a `memory:<key>` citation to name a key
this session actually holds (a store-level `database:<driver>` citation describes the store, not a row,
and is left alone). `provider-citation-is-this-provider` requires a provider citation to name the
provider this turn called — a turn that called nothing cannot carry one. Neither check is added to a
turn without such a citation, so the ordinary knowledge path still reports the same count it always did.

## P2.8 Context packing — an honest non-result

Every block is now a `GroundingItem` with a source, a priority and a measured relevance;
`selectContext()` sorts by priority then relevance, deduplicates at sentence level (a `RAVEN:`-quoted
copy of a record is the same sentence, so the speaker label is stripped before comparing), drops a
record whose body was mostly already present rather than shipping a stub of it, and returns a manifest:
every candidate, its char count, included or excluded, with the reason.

Measured against the Phase-1 builder on six real question shapes: **26,632 chars before, 26,632 after
— byte-identical, 0 saved**, because this corpus does not repeat itself across the records a question
retrieves. In the case it *does* (one paragraph quoted by two records and by RAVEN's previous answer)
the same builder removed **266 chars** and the paragraph went from four copies to one. So the correct
claim is not "the prompt got smaller"; it is **the prompt cannot silently get bloated, and the turn can
now show its work** (`metadata.provider.context`, e.g. `{chars:1472, kept:5, dropped:1, dedupedChars:202}`
measured live). On the local corpus the whole selection costs under 0.05 ms.

## P2.9 Failure and degradation — nothing to change

The breaker still acts at the provider handoff (so an agentic turn skips the model too), the three
probe facts are still separate, the agentic budgets still race the plan, and a failed turn still
degrades genai → knowledge → agentic → offline with no key, path or stack frame in any message. No
measurement suggested a change, so none was made.

## P2.10 Measured and rejected

Recorded so the next pass does not repeat the search: WeakMap index cache (already memoised); caching
`documentsByTag` (34-element filter, 0.03 ms); caching `system_status`'s DB inspect (already reuses
the handle); dropping the planner's extra search (0.016 ms); micro-tuning `tokenize`/`normalize`
(nanoseconds per call, called a handful of times per turn); a `step_id` column on `raven_tool_runs`
(a table nothing reads back — the field ships on the run record instead); Postgres `tsvector` or any
vector store (needs a service this budget forbids, and the lexical path answers at 6 ms).

## Phase-2 status

```
LOCAL KNOWLEDGE   FUNCTIONAL   34 records, cited, verified, no model involved
DATABASE          FUNCTIONAL   file + sqlite live; postgres/rest parity-tested at SQL text level
MEMORY            FUNCTIONAL   durable, session-scoped, relevance-selected, kind-derived,
                               and now able to answer before a model is asked
VERIFICATION      FUNCTIONAL   9 checks, 2 of them new correspondence rules, all server-side
AGENTIC           FUNCTIONAL   real registry execution, per-call dedupe, step↔run ids, budgets
GENAI             PLUMBING READY, NOT CONFIGURED — one env var away; keyless local endpoints now work
LIVE GENAI        NOT AVAILABLE (no credential, no outbound allowlist for a paid endpoint)
STREAMING         NOT IMPLEMENTED — Phase 3; the seam is written down in RAVEN-BRAIN.md §7
VISION            NOT IMPLEMENTED — client-reported only
```

Counts after this round: `npm run check` **456 green** (13 + 70 + 92 + 89 + 38 + 107 + 47), `tsc`
clean, `next build` clean. Twelve checks were added this round; **none was weakened or removed**, and
the new behaviours were each proved non-vacuous by deleting the mechanism and watching the test fail
(memory skip, sentence dedupe, relevance-ordered selection, signature dedupe, the evaluative routing
rule).
