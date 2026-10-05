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
