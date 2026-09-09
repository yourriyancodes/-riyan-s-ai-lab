# RAVEN BRAIN — backend architecture

The knowledge, memory, persistence, provider and agent-orchestration layer behind
`POST /api/raven`. This document is the specification the code follows, and where the
two disagree the code is wrong.

Written against Next.js 16.3.3 / React 19 / TypeScript 5.7.3 (`strict`), with **zero new
runtime dependencies**: no `pg`, no ORM, no vector store, no LLM SDK, no test framework.

---

## 1. What changed

| Before | Now |
| --- | --- |
| `app/api/raven/route.ts` inlined 67 lines, returned 503 (no key) or 501 `PROVIDER_ADAPTER_NOT_IMPLEMENTED` (key present) | Thin route: validate → rate-limit → session → `runBrainTurn()` → serialize. The 501 path no longer exists; a provider adapter is implemented |
| `app/api/health/route.ts` hard-coded `providerAdapterImplemented: false`, `databaseReachable: false` | Every flag is measured: capability resolution, database open, provider probe |
| `lib/agentTools.ts` — client-side keyword matcher with a fake `setTimeout(400)` "thinking" delay | **Deleted.** The brain answers server-side; no simulated latency anywhere |
| Conversation state lived only in the Zustand store, lost on reload | Conversation + durable facts persist (file store by default, Postgres/Supabase when configured) |
| `data/siteConfig.ts` was the only data source, read by React | Same file is now the *corpus*, indexed once and queried by the retrieval engine — one source of truth for UI and backend |
| `RavenState` union in two places | `lib/raven/states.ts` owns it; the union is a superset so the existing compile-time guard in `lib/ravenStore.ts` still holds |

The console, landing page, 3D face, portfolio sections and the portrait are untouched,
apart from two additive lines in `RavenConsole.tsx` (two more names in `WORKING_STATES`).

### 1.1 Follow-up round: what driving the real system found

The spec was re-checked section by section against the running server rather than against
this document, and three defects turned up — all of them in the *classifier*, all of them
reachable by ordinary typing, none of them visible from the unit tests that existed:

1. **A capability question was answered with a pleasantry.** The unmatched-input fallback
   tested `contentTokens <= 2` to decide "small-talk", so *"Do you have access to my
   computer?"* (two content words: access, computer) was classified as small-talk and
   answered `Noted. Ask me something about the portfolio…` — with `verified: true` and
   **zero** citations, i.e. a filler ack stamped as grounded. Now a pleasantry is decided by
   the words themselves, `capability.probe` recognises access/permission/internet/"can you
   see" phrasings, and those questions route to `system_status`, which reports the measured
   capability set (`Provider: none configured…`) with a real citation.
2. **Durable memory was write-only in practice.** *"Please remember that I prefer Rust for
   command-line tools."* stored fine; *"What language do I prefer for CLIs?"* did not match
   `memory.recall`, so the fact sat unreachable and the turn ended in a refusal. The recall
   patterns now cover question-shaped preference and anaphoric conversation references
   ("did I mention…", "what did I just ask you…"), and a test asserts the round trip
   end-to-end: store, ask, answer contains the fact.
3. **`/api/raven` had no concurrency or integrity coverage** (spec §22 item 14). Three
   checks now run simultaneous turns and assert the properties that matter: each turn cites
   its own retrieval (the two knowledge turns' citation sets must be disjoint), each trace
   stays ordered inside its own turn, four simultaneous writes to one conversation all
   reach history as exactly four user/reply pairs with no lost row, and a repeated question
   goes through retrieval again — which is what proves nothing is cached behind the "it
   retrieved that" claim.

Two things were **not** changed, deliberately. `no_grounding` still answers HTTP 502: it is
a refusal *with* a body the console already handles, and turning a refusal into 200 would
make the rate limiter and the real 502s indistinguishable in logs. And offline recall stays
fact-based: there is no deterministic summariser over verbatim conversation history, so
`context.recent` is sent to a provider when one exists and is not paraphrased when none
does. Saying "I recall you asked about X" from a two-line history read would be theatre.

`RavenConsole` now renders the two fields the route was already returning and nothing was
showing: `sources` (up to four citation labels with locators) and a collapsed
"what ran · N phases" trace built from `metadata.trace`. Both are absent, not empty, when
the server returned nothing for them. The visual layer stayed byte-identical —
The frozen set is verifiable rather than asserted: the only files that changed in this
round are `components/RavenConsole.tsx`, `lib/ravenStore.ts`, `lib/raven/intent.ts`,
`scripts/check-brain.mjs` and this document — `lib/ravenMachine.ts`, `lib/ravenStudio.ts`,
`components/Raven3D.tsx`, `app/globals.css`, the portrait module and `lib/ravenVoice.ts`
are byte-identical to the commit that closed the visual work.

### 1.2 This round: the database, the near-miss bluff, and the response contract

Four things changed, and three of them were found by testing behaviour instead of reading
code. Live GenAI was audited first and is **still not available in this sandbox** — no
`RAVEN_API_KEY`, nothing listening on 11434/1234, no `ollama`/`llama-server`/`vllm` binary —
so the provider layer keeps its configured-but-unproven status and nothing here claims
otherwise (see §7 and §13).

1. **A fifth database driver, still with no dependency.** `lib/raven/db/sqlite.ts` implements
   all 13 adapter methods over `node:sqlite`, with DDL *derived* from `db/schema.ts`. It is
   opt-in (`RAVEN_SQLITE_PATH`), the file store stays the default, and the schema-parity test
   exists because a translated schema is exactly the kind of thing that rots silently. Two
   ordinary bugs surfaced while wiring it: `RAVEN_DB_DRIVER=postgres-rest` was silently
   dropped by the config parser, and `'[]'::jsonb` became `'[]'::TEXT` because the cast
   rewrite ran after the type rewrite.
2. **The near-miss bluff in `explain.concept` is closed.** When the local glossary had no
   entry, the composer listed whichever records the lexical searcher scored highest and said
   *"the portfolio data does mention it"* — for *"How does Riyan configure Kubernetes
   operators for quantum annealers?"*, quoting the site tagline. `verified` was `true`
   because the verifier only demands evidence for `portfolio.*` intents. Now a hit must
   contain the term to be presented as a mention, and the new
   `grounded-mode-has-evidence` check refuses to certify a grounded-mode answer that has
   nothing but its own text.
3. **The classifier stopped reading English as an anchor.** `extractSection()` used
   `lower.includes(id)`, so the preposition in *"what does Riyan think **about** bulb
   futures"* named the `#about` section at 0.98 confidence and answered with a section list.
   Section references now have to look like references (`#about`, "the about section",
   "scroll to contact"); `experience`/`journey` still map to a section but as an *entity*,
   never as a vote; `identity.riyan` gained the second-person phrasings it was missing; and
   `identity.raven` now recognises "tell me about yourself", which previously produced a
   section listing too.
4. **A refusal cites nothing.** The ungrounded-answer path attached the four records
   retrieval had just *rejected*, so a shrug arrived wearing four SOURCES chips — evidence
   for no claim. `citations` is empty on that path now; `tools` still shows what ran,
   because that part happened.

### 1.3 Final round: grounding enforcement, provider truth, and conversational context

Eighteen review items; five of them turned out to be real defects, and each is now asserted
somewhere in `npm run check`:

1. **An ungrounded answer used to be reported as an answer.** The `explain.concept` near-miss path
   (glossary empty, search returned records that did not contain the term) returned its
   "nothing mentions it" text with `mode:'knowledge'`, HTTP 200, `verified:true` and four
   citations — a refusal wearing the receipts of the evidence it had just rejected. `KnowledgeAnswer`
   now carries `ungrounded?: boolean`, and `brain.ts` turns any such answer into the refusal it
   describes: `mode:'offline'`, `state:'OFFLINE'`, `success:false` (HTTP 502), `citations:[]`,
   `verified:false`, `degraded:{from:'knowledge',because:'the composer found nothing grounded to say'}`.
   The near-miss opening line is kept, because it is the specific truth of that question.
2. **`providerReachable` meant "the endpoint answered HTTP", and that is not what a reader takes
   from it.** A wrong key produces 401 from a perfectly reachable endpoint. `probe()` now returns
   `{ reachable, detail, authorized? }` — `authorized:false` on 401/403, `undefined` when the probe
   could not judge (no provider, connection failure) — published by `/api/health` as
   `providerAuthorized` plus `provider.probed.{reachable,authorized,detail}`. `READY` requires
   `authorized === true`, so a configured-but-refused key reports `PARTIALLY_READY` and says so:
   *"The provider endpoint answered but rejected the credentials (401/403)."* The flag lives on the
   measured health block, not in `describeCapabilities()`, which stays a pure description of config.
3. **The breaker only ever constrained the router.** An agentic turn handed its provider straight to
   the reasoning agent, so an endpoint that had already failed twice was dialled again on every
   plan: measured 1.5 s of retries per turn, and **76 s** for one turn when the endpoint hung rather
   than answered (25 s timeout × 3 attempts). Two changes: the breaker moved to `lib/raven/breaker.ts`
   so `system_status` can report it without importing the brain, and while it is open the brain hands
   the agent `heldByBreaker(provider)` — a handle that fails on contact with
   `not attempted: N consecutive failure(s), retrying after Xs of cooldown` instead of making the
   user wait. `requestJson` also stopped retrying timeouts (a 500 still uses the retry budget:
   "a timeout costs one attempt; a 5xx may use the retry budget").
   `RAVEN_AGENT_STEP_TIMEOUT_MS` and `RAVEN_AGENT_TURN_TIMEOUT_MS` were documented in `.env.example`
   and read by nothing — a budget nobody enforces is worse than no budget, because it is believed.
   The step ceiling now clamps every tool at registration (a tool cannot opt out by declaring a
   longer number of its own) and the turn ceiling races the agent loop: on overrun the agent is
   abandoned, the turn answers from what retrieval had already returned, the mode becomes whatever
   actually delivered (`knowledge`, or `offline` when nothing did), and `degraded` names the budget.
4. **Follow-up questions had no referent resolution.** "Which one uses RAG?" after a listing scored
   `unknown 0.05` and was refused, because the classifier only reads the current message.
   `resolveProjectReferent(text, recent)` in `intent.ts` now runs when — and only when — the intent
   is `unknown` or confidence is below 0.35: candidates are the projects *that RAVEN's own recent
   answers named* (bounded: 3 answers for pronouns, up to 5 for an ordinal), an ordinal is resolved
   by position **in that listing**, a term match beats a fuzzy one, and a tie or an out-of-range
   ordinal abstains. When it resolves, the intent is re-classified, `entities.project` is overridden,
   a `anaphora` phase event enters the trace, and the retrieval plan runs against the resolved
   subject. It never overrides a question that has its own subject.
5. **Two question shapes were answered by the wrong thing.** "Tell me something *outside* the
   portfolio" was answered with the project list (vocabulary scoring sees `portfolio`), and "suggest
   a CLI architecture for my *next* project" was answered with the same list. `classifyIntent` now
   drops portfolio-shaped intents for both, records the reason (`suppress:outside-scope:…` in the
   signals, `entities.unanswerableByCorpus`), and the composer returns nothing for those turns — so
   with no provider they are refused, and with one they route to `genai` and are labelled as
   synthesis. The corpus is not allowed to answer a question about what is not in it.
6. **Refusals now name the mode.** Every no-grounding refusal ends with `ungroundedNotice(config)`:
   which offline/local mode is active, that no provider is configured, and what this brain can
   actually answer. "Model offline" in a README is not enough when a user is staring at one shrug.
7. **The state machine could claim a state it had not earned.** `VERIFYING` is entered only when a
   turn actually has runs or citations to check; otherwise the same work is recorded as a plain
   `verification` phase event. `actions-outcome` was a `ProposedAction[]` the client had to
   interpret — it is now a trace event reporting `succeeded/total`, failures, awaiting-approval,
   stored and expired counts, measured after `runActions`.
8. Two claims were checked and found already true, so nothing changed for them: memory is selected by
   relevance and bounded (`loadContext` scores against the question's terms, falls back to top-importance
   only on zero matches, and both provider paths receive `context.memories`); and the console renders
   only measured state — no simulated telemetry, and the vision path degrades to a labelled "vision
   unavailable" panel with metadata (never frames) leaving the browser.

---

---

## 2. Layer map

```
                 ┌──────────────────────────────────────────────────────────┐
  browser ──────►│ app/api/raven/route.ts      parse · validate · rate limit│
                 │                │                        lib/raven/session │
                 │                ▼                                          │
                 │        lib/raven/brain.ts   ◄── the only orchestrator      │
                 │                │                                           │
   CONTEXT ◄─────┼── memory/service.ts  ── db/ (postgres · postgres-rest ·   │
                 │                          sqlite · file · memory)           │
   INTENT  ◄─────┼── intent.ts             → 19 intents, rule-weighted       │
   ROUTER  ◄─────┼── router.ts             → knowledge | genai | agentic |   │
                 │                            offline                        │
   AGENTS  ◄─────┼── agents/research.ts    → plans tool calls                │
                 │   agents/knowledge.ts   → composes from tool outputs      │
                 │   agents/action.ts      → the only writer                 │
                 │   agents/reasoning.ts   → agentic loop + synthesis        │
   TOOLS   ◄─────┼── tools/registry.ts + tools/index.ts  (16 tools)          │
   PROVIDER◄─────┼── providers/{gemini,openai,http,prompt}.ts                │
   VERIFY  ◄─────┼── agents/verification.ts → blocks ungrounded claims       │
   MEMORY  ◄─────┼── memory/extract.ts       → what is worth keeping         │
   RESPONSE◄─────┼── states.ts (transition table) + metadata.trace            │
                 └──────────────────────────────────────────────────────────┘
```

Layer rules, enforced by imports rather than by comment:

- `types.ts` imports nothing. Everything may import it.
- Only `providers/*` touches the network. `knowledge/*`, `tools/*`, `intent.ts`,
  `router.ts`, `memory/extract.ts`, `agents/verification.ts` are pure — which is why the
  test suites need neither a key nor a server.
- Agents never read `siteConfig` directly. They ask for **tool outputs**, so every
  sentence maps to a recorded `tool_run`.
- `db/index.ts` is the only place that decides *where* state lives.

---

## 3. State machine (`lib/raven/states.ts`)

States, exactly as specified: `IDLE LISTENING THINKING REASONING EXECUTING VERIFYING
SPEAKING VISION OFFLINE ERROR`, plus `UNDERSTANDING PLANNING RESEARCHING WAITING SUCCESS
WARNING` which the site already used. `THINKING` (provider round-trip) and `VISION`
(camera-driven turn) are new names for things that genuinely happen; every other brain
phase maps onto a state the UI already renders.

A `TRANSITIONS` table decides what may follow what, and `transition(from, to)` returns
`{ state, refused? }` instead of throwing:

- `IDLE → SPEAKING` is illegal, so a reply cannot be emitted without having gone through
  retrieval/verification. It degrades (routed through `REASONING`, or `WARNING`) and the
  refusal is written into `metadata.trace`.
- `VERIFYING` is only reachable from `RESEARCHING / REASONING / EXECUTING / THINKING` —
  "I verified that" requires something to have been done first.
- Every state reaches `IDLE` within three moves (asserted in `check-brain.mjs`), so a
  turn cannot strand the console in a working state.

The turn's `metadata.trace` is one `PhaseEvent` per phase with **measured** durations:

```json
{ "state": "RESEARCHING", "phase": "retrieval", "atMs": 12, "ms": 3,
  "note": "intent portfolio.projects, 16 tools available" }
```

---

## 4. Database layer (`lib/raven/db/`)

`DatabaseAdapter` (`lib/raven/types.ts`) is the whole contract — 13 methods:
conversation upsert/read, message append/read, memory remember/recall/search/expire,
agent-run start/finish, tool-run record, plus `status()` and `ensureSchema()`.

Five drivers implement it (the last two are not installed by default and neither is required):

| Driver | Transport | Requires | Used when |
| --- | --- | --- | --- |
| `postgres` | `pg` pool, dynamic runtime import | `DATABASE_URL` **and** `npm i pg` | a connection string exists and `pg` resolves |
| `postgres-rest` | `fetch` → Supabase PostgREST | `SUPABASE_URL` + `SUPABASE_DB_KEY` | Supabase is configured; no dependency, serverless-safe |
| `sqlite` | `node:sqlite` (`DatabaseSync`), WAL, one file | Node 22.5+ **and** `RAVEN_SQLITE_PATH` | opted in — transactions and foreign keys, still zero dependencies |
| `file` | JSON files, atomic temp+rename, serialized write queue | writable `RAVEN_DATA_DIR` | **default on a fresh clone** — real persistence, zero setup |
| `memory` | in-process Maps | nothing | tests, or when disk is unavailable |

Resolution (`db/index.ts`) tries candidates in order, records every rejection in
`handle.notes`, and **cannot throw**. `getDatabase()` never returns null, so nothing above
it needs a null-check to stay alive; `metadata.database.detail` carries the reason for a
downgrade, e.g. `file store unavailable: EACCES …; degraded from: postgres: the "pg"
package is not installed (…)`.

The SQLite driver is the one to reach for when the JSON store stops being enough and a
database server is still more than a hobby project should carry. Two things about it are
deliberate:

* **The DDL is not a second schema.** `db/schema.ts` holds the Postgres statements and
  `sqliteDialect()` translates them (`timestamptz`→`TEXT`, `jsonb`→`TEXT`, `now()`→
  `CURRENT_TIMESTAMP`, `boolean`→`INTEGER`, casts stripped). A test asserts that every
  translated table and index comes out with the same columns, so the two engines cannot
  drift apart quietly.
* **Foreign keys are enforced.** `PRAGMA foreign_keys = ON` means a message whose
  conversation was never written is *rejected* rather than stored as an orphan that nobody
  lists. That is a real behavioural difference from the `file` and `memory` drivers, which
  accept it; `appendMessage` re-throws with `message <id> was not stored: conversation <id>
  does not exist`, so a caller learns the reason instead of losing rows in silence.

It stays opt-in because `node:sqlite` is still marked experimental: a fresh clone must not
depend on a module that could change under it. When it is unavailable or the path is
unusable, `resolveDatabase()` records `sqlite: …` in `notes` and continues on `file`.

### Schema

`db/schema.sql` is generated from `lib/raven/db/schema.ts` (`npm run schema`; CI runs
`npm run schema:check`, which fails on drift). Five tables:

```
raven_conversations  id · session_id · title · created_at · updated_at
raven_messages       id · conversation_id→ · role(user|raven|system) · content
                     · mode · state · created_at
raven_memories       id · session_id · key · value · importance · source
                     · UNIQUE (session_id, key)          ← upsert target
raven_agent_runs     id · conversation_id · goal · mode · status · steps(jsonb)
                     · tools_used(jsonb) · verified · result · started_at · completed_at
raven_tool_runs      id · agent_run_id · conversation_id · tool_name · input(jsonb)
                     · output(jsonb) · status · error · ms · created_at
```

These are not decorative. A turn writes one `raven_agent_runs` row (`status:
running → verified|partial|failed`, with the real step list and tool names) and one
`raven_tool_runs` row per tool call including its input, output, status, error text and
duration. `response.metadata.agentRunId` is the id of the row that was written, so an
answer can be looked up afterwards.

Safety properties asserted by tests: all user input reaches Postgres as `$n` parameters
(never interpolated — a `'); DROP TABLE …` string appears only in the bound values), and
REST writes go through JSON bodies, never URL concatenation.

Nothing secret is ever stored: no API keys, no raw provider payloads beyond the answer
text, no tokens.

---

## 5. Memory model (`lib/raven/memory/`)

**Short term** — the last `RAVEN_MAX_HISTORY` (default 40) messages of this
`conversationId`, read before answering and re-read after every turn. Gives "what did I
just ask?" and lets the provider see prior turns. Persisted whether or not a model is
configured.

**Long term** — durable facts per `sessionId`, `key → value` with an importance score.

Extraction is a policy, not a transcript (`memory/extract.ts`):

| Rule | Example | Importance |
| --- | --- | --- |
| explicit remember | "remember that my favourite language is TypeScript" | 0.90 |
| profile name / role | "call me Ri", "I am a student at …" | 0.85 / 0.70 |
| stated preference | "my favorite framework is React" | 0.80 |
| toolchain declaration | "I mostly work with Next.js" | 0.65 |
| current goal | "I want to build an offline-first app" | 0.60 |
| explicit forget | "forget my favorite framework" | → `expire` |

One write per explicit request: "remember that my favourite language is TypeScript" produces a single
`preference.favourite_language` row, not a note *and* a preference — the explicit rule owns
the turn. Favourite-shaped facts are keyed as `preference.*` whether the user said
"remember" or not, which is what lets a later recall find them.

Rejected, with the reason kept in the trace: questions (`?`), small talk, anything under
12 characters, values under 2 characters after cleanup, duplicate keys, and anything
below the **0.45 importance floor**. Maximum 3 writes per turn; the file store caps
`memories` at 1000 rows and `messages` at 5000. Retrieval for a turn = terms from the
question matched against key+value, falling back to the top-importance facts when nothing
matches, so "hi" still knows who you told it you are.

Session identity (`lib/raven/session.ts`): signed HttpOnly cookie when `SESSION_SECRET`
exists (HMAC-SHA256, constant-time compare), otherwise the client's id from
`localStorage` (validated `/^[A-Za-z0-9_-]{6,64}$/`). Memory is scoped to that id, which
is why two visitors on one deployment cannot read each other's facts. `GET /api/health`
reports whether the secret is set — never its value.

---

## 6. Knowledge engine (`lib/raven/knowledge/`)

`corpus.ts` builds 24+ `KnowledgeDocument`s at module load from `data/siteConfig.ts` +
`data/ravenKnowledge.ts`: profile, skills, experiments, journey, contact, sections, one
per project (card + architecture + stack + highlights), RAVEN's self-description, the
architecture layers, and the CS glossary. Each carries a `citation` pointing at the file
and field it came from.

`search.ts` is a BM25-family scorer, chosen over embeddings on purpose — deterministic,
inspectable, no cache to drift, no model to bill:

1. lowercase, strip punctuation/apostrophes, split;
2. drop stopwords (deliberately **not** `riyan`, `pasha`, `raven` — those are the subject
   of the questions);
3. light stem (`ies→y`, `-es`, `-s`, `-ing`, `-ed`, guarded by length);
4. per token: `idf = ln(1 + (N − df + 0.5) / (df + 0.5))`, `tf = 1 + ln(count)`, field
   weights **title 3 · keywords 2 · body 1**; a corpus-unique token adds
   `idf × 1.6 × coverage`;
5. exact normalized phrase contained in the document adds a flat 4;
6. multiply by `0.55 + 0.45 × coverage`, divide by `1 + ln(1 + len/60)`;
7. drop anything under `minScore` (0.6; the generic composer demands 1.8 *and* ≥2
   matched tokens), sort by score then id for total determinism.

Step 7 is what makes "which cricket world cup final did he watch?" answer *nothing*
instead of quoting the verification-gate glossary entry because it contains the word
"final". A missing answer is a feature of a grounded system.

`scripts/check-brain.mjs` holds the corpus to the page: every skill node name in
`components/NeuralGraph.tsx`, every overview string in
`components/ProjectDetailModal.tsx` and every focus entry in `app/page.tsx` must be
retrievable. Those three files are do-not-touch for the brain, so duplication is
accepted and *divergence is a failing test*.

---

## 7. Provider abstraction (`lib/raven/providers/`)

```ts
type ModelProvider = {
  id: string; label: string
  probe(): Promise<{ reachable: boolean; detail: string }>
  generate(request: ProviderRequest): Promise<ProviderResult>
}
```

Two implementations over plain `fetch` (`http.ts` shared): **Gemini** (`generativelanguage
.googleapis.com/v1beta/models/{model}:generateContent`, key in the `x-goog-api-key`
header so it cannot leak into a URL log) and **any OpenAI-compatible**
`/chat/completions` — which is also the ₹0 path: Ollama or LM Studio on localhost needs
no key at all and is accepted keyless.

`ProviderResult` is a tagged union. Failure codes: `no_provider · rate_limited · timeout ·
network · bad_response · unavailable · refused · too_long`, each with the provider's own
message and `retryAfterMs` when the response had `Retry-After`. Only transient statuses
(408/425/429/5xx) are retried, exponentially, `RAVEN_MAX_RETRIES` ≤ 3.

Prompt contract (`prompt.ts`): the persona's rules are the honesty rules — facts only from
SUPPLIED SOURCES, "not in the portfolio" instead of invention, no claim to have run or
saved anything the execution record does not show. Context is assembled newest-first
inside `RAVEN_CONTEXT_CHAR_BUDGET`, and when material is dropped the prompt says so
explicitly (`…N further source(s) trimmed for context budget…`).

A model's output is **evidence-shaped, not authoritative**: it is composed, then handed to
the same verifier as everything else.

**Availability is three separate facts**, because collapsing them lies to the reader:

| published as | true when | false / null when |
| --- | --- | --- |
| `providerConfigured` | a key resolves from the environment | nothing set |
| `providerReachable` | the endpoint answered HTTP at all | connection refused, DNS failure, timeout |
| `providerAuthorized` | the endpoint answered *us* (served model list) | `false` on 401/403; `null` when unmeasurable (no provider, no connection) |

`/api/health` is the only place that probes, and only on `PUT`/first read — never on
`GET /api/raven`, so answering a question cannot pay for a health check. `READY` requires
`providerAuthorized === true`: a present-but-refused key is `PARTIALLY_READY` with the reason
in `note`. The flags live on the measured block, not in `describeCapabilities()`, which
remains a static description of configuration and must stay that way.

**The breaker** (`lib/raven/breaker.ts`, in-process, no network) opens after
`FAILURE_THRESHOLD = 2` consecutive failures and holds for `OPEN_MS = 60_000`; the first
success closes it. While it is open: the router stops preferring `genai`, the agentic and
synthesis paths receive `heldByBreaker(provider)` — a handle that returns a structured
`unavailable` failure with `not attempted: … retrying after Xs of cooldown` instead of
dialling out — `system_status` reports `failing`/`consecutiveFailures`, and
`x-raven-breaker: open` is on the response. Every one of those is a measurement of the same
state, read from the module that owns it rather than duplicated.

**Retries are asymmetric on purpose**: `requestJson` spends the `RAVEN_MAX_RETRIES` budget on
transport errors and retryable statuses (408/425/429/5xx, `Retry-After` wins over backoff), but a
`timeout` returns immediately. Retrying an endpoint that is already not answering tripled the wait
for one turn — `RAVEN_TIMEOUT_MS` is what a user should be able to reason about as the ceiling.

`RAVEN_API_KEY` never enters the serializable config object — `ravenConfig()` reports
`apiKeyPresent` and only `ravenApiKey()` returns the value, to the one caller that needs
it. Asserted in the tests ("a configured key is never echoed by health or the brain").

---

## 8. Tool system (`lib/raven/tools/`)

`ToolRegistry` is registration, not convention. `TOOL_SPECS` (16 tools):

| Tool | Permission | Notes |
| --- | --- | --- |
| `search_knowledge` | read | corpus query; `limit` 1–10, optional `tag` |
| `list_projects`, `get_project` | read | `get_project` accepts name, slug or `03` |
| `get_skills`, `get_profile`, `get_raven` | read | portfolio identity + capability records |
| `get_contact` | read | returns `published:false` rather than a guessed handle |
| `get_experiments`, `get_sections`, `lookup_concept` | read | page data + glossary |
| `system_status` | compute | live capabilities; no network call |
| `estimate_token_cost` | compute | `tokens ≈ ceil(chars/4)`, labelled an estimate, with `pricingAsOf` |
| `recall_memories` | read | session-scoped, returns the driver it read from |
| `remember_fact`, `forget_fact` | action | run when the user's own words asked for it |
| `request_navigation` | action · **requiresApproval** | proposed, never performed server-side |

Guarantees, all in the registry so no tool can skip them: schema validation (unknown
parameter → `rejected`; `limit: 99` → `rejected`; blank string → `rejected`; enum
violation → `rejected`), per-tool timeout (`Promise.race`, status `timeout`), output cap
with an explicit `truncated:true` marker + note instead of a silent cut, handler
exceptions converted to `status:'failed'`, approval gating (`status:'skipped'` plus a
reason when unapproved), and one `ToolRun` audit row per call with real `ms`.

Actions are the honest boundary: `request_navigation` returns
`{ executed: false, proposed: true, approved }` — the server cannot scroll a browser, so
it proposes and `ravenStore.ts` performs the scroll and reports what it found.

---

## 9. Orchestration

`routeTurn()` maps intent × availability onto a mode:

- knowledge intents (identity, projects, skills, contact, experiments, sections,
  capability probe, memory) → `knowledge`
- `explain.concept` / `unknown` → `genai` when a provider is usable, else `knowledge` if
  the corpus can answer, else `offline`
- `compare.evaluate` / `plan.multistep` → `agentic` (a provider is used *inside* the loop
  for phrasing when available; the plan itself never depends on one)
- `request.context.allowedModes` restricts all of the above (the console's kill switch)

The agentic loop is `observe → plan → act → observe → synthesize → verify`. The planner is
a table of gap rules: it only requests tools that exist and have not already run, so a
turn is bounded by `RAVEN_AGENT_MAX_STEPS` (6) without asking a model how many steps feel
right. Synthesis is either the provider (JSON `{"answer": …}`, fences and prose wrappers
tolerated by the extractor) or `composeDeterministically`, which ranks by the same
lexical score and *says it did*: "Ranked by how directly each portfolio record matches
your own words — a lexical measure, not a quality judgement."

Without a key or a database, `mode` is `knowledge` or `agentic` and the answer is still
cited, still verified, still logged.

---

## 10. Verification (`agents/verification.ts`)

Independent of whoever produced the text. Blocking checks set `verified`:

- `answer-present` — non-trivial text.
- `claims-grounded` — a `portfolio.*` or identity claim needs ≥1 citation.
- `grounded-mode-has-evidence` — a `knowledge`/`agentic` turn (or a `genai` one that had a
  real provider behind it) must have ≥1 **non-provider** citation. `claims-grounded` is
  intent-scoped, which left a hole: an off-topic retrieval listing under a different intent
  carried no citation requirement at all and shipped with a verified badge.
- `action-claim:<tool>` — if the answer says it saved/forgot/scrolled something, a
  **succeeded run of that tool** must exist in this turn. This is the rule that makes
  "it never claims an action it did not perform" mechanically true, and it applies to
  model output exactly as it applies to ours.
- `figures-match-evidence` — every `N%`, `N×`, `N ms`, `N years` must appear with that
  unit in the evidence. Provider-kind citations are excluded from evidence, so a model
  cannot corroborate itself.
- `affiliations-unsupported` — "worked at <Org> for 5 years" / "as a <role>" is rejected
  unless the retrieved records state it. Narrow on purpose: an invented job history is
  the most damaging hallucination on a portfolio site, and a check that fires on
  "working with data" would be ignored by everyone.
- `provider-attribution` — `mode:'genai'` without a real provider result is a failure.

Advisory (reported, non-blocking): `proper-nouns-known`, `tool-output-size`.

On a blocking failure the brain prefers a locally composed answer, records
`degradedFrom`/`degradedBecause`, and if no grounded alternative exists it keeps the text
but appends `I could not fully verify that … treat it as unconfirmed` and ships
`verified:false`. A quieter lie is not an option.

---

## 11. HTTP surface

`POST /api/raven` — body `{ message, conversationId?, sessionId?, inputType?, context? }`
(`input` accepted as a legacy alias for `message`). `context` accepts `allowedModes`,
`approvedActions`, `visionContext`, all validated. Errors: `400 invalid_json`,
`422 empty_input`, `413 too_long`/`body_too_large`, `429 rate_limited` (+`retry-after`).
Brain-level failures return the same response shape with `success:false`, `mode:'offline'`
and `state:'OFFLINE'|'ERROR'` — a client never has to branch on shape before rendering.

Every response, refusal included, carries the canonical set at the top level:

```
reply · mode · state · verified · provider · citations · trace · tools · memory · degraded · error?
```

`reply` is an alias of `response`, not a second string: they are always identical, and the
older name stays because the console and the typed client already read it. `provider` is
`'none'` or the id that actually answered — the *structured* provider record, `null` when
nothing was configured, remains at `metadata.provider`, which is why the two look different
and are not redundant. `trace` is `metadata.trace` verbatim (hoisted, not copied from a
second source). `tools` is the list of tools that really ran, so an empty array means the
turn executed nothing. `degraded` is `null` unless the router planned more than it delivered,
in which case it names the mode it came down from and why.

Real response for `which project best demonstrates retrieval?` on a machine with no key
and no database (trimmed):

```json
{
  "success": true,
  "mode": "agentic",
  "state": "SPEAKING",
  "conversationId": "conv-demo",
  "verified": true,
  "response": "Assembled from the retrieved records; no model was involved. Ranked by how directly each portfolio record matches your own words — a lexical measure, not a quality judgement.\n- 1. RAG Knowledge Assistant …",
  "citations": [
    { "kind": "siteConfig", "source": "siteConfig.projects", "label": "Portfolio project list" },
    { "kind": "siteConfig", "source": "NeuralGraph.skillNodes", "label": "Skill graph nodes" }
  ],
  "metadata": {
    "intent": "compare.evaluate", "intentConfidence": 0.607,
    "route": { "mode": "agentic", "usedProvider": false, "usedTools": true,
               "reasons": ["intent compare.evaluate (confidence 0.61)", "no provider credentials resolved"],
               "degradedFrom": "genai",
               "degradedBecause": "no provider configured; synthesized from the same evidence locally" },
    "steps": 6, "toolsUsed": ["list_projects", "get_skills", "get_project"],
    "agentRunId": "run-…", "provider": null,
    "database": { "driver": "memory", "reachable": true },
    "latencyMs": 16
  }
}
```

Headers: `x-raven-mode`, `x-raven-state`, `x-raven-latency-ms`, `x-raven-breaker`,
`retry-after`, and `set-cookie` only when a session was minted.
`GET /api/raven` documents the accepted body; `GET /api/health` reports measured
capabilities (`probe=0` skips the provider probe), including the tool table and the
driver it fell back to. No streaming endpoint exists — replies are single JSON bodies.

---

### 11.1 One log line per turn (`lib/raven/log.ts`)

The route writes exactly one line per request that reaches the brain, and one per refusal —
built from measured values, not from a second source of truth:

```
raven.turn session=rA2MFQrQ conv=lEeTwkrO via=text status=200 intent=plan.multistep conf=0.98
  mode=agentic state=SPEAKING verified=true steps=4
  tools=list_projects+get_skills+search_knowledge toolruns=succeeded:3
  provider=none breaker=closed db=file mem=+0/-2 chars=42 ctx=873 degraded=genai ms=48
raven.reject reason=empty_input status=422 ms=0
```

Three rules, each asserted in `check-backend.mjs`:

- **No user text, ever.** The message never reaches stdout — the test sends a canary
  ("passport number …") and asserts the substring is absent. Session and conversation ids
  are hashed to 8-character tokens, so lines from one conversation can be correlated without
  the log identifying anyone. Text belongs in the conversation store, where the user can see
  and delete it, not in whatever aggregates a server's stdout.
- **The log cannot drift from the wire.** The test compares the logged `mode`, `state`,
  `verified` and `status` against the response body the client actually received, and fails
  if any differ. A log that disagrees with the response is worse than no log, because it is
  believed more.
- **Severity follows the outcome.** `status >= 400` goes to `console.warn`, including a turn
  that answered politely but ungroundedly. Nobody had to decide to be honest about it.

`RAVEN_LOG=0` silences it; the backend suite sets that so its output stays readable.

### 11.2 Proving the provider path with no provider

`mode:'genai'` is not something to take on faith, and it does not need a paid endpoint to be
tested. A ~30-line OpenAI-compatible server on `127.0.0.1` that answers `/v1/models` and
`/v1/chat/completions` — and can be told to return 401, 500, or nothing at all by the text
of the prompt it receives — is enough to drive the real code path:

```bash
node /tmp/genai-stub.mjs &                       # a stub that speaks the wire format
RAVEN_BASE_URL=http://127.0.0.1:3199/v1 RAVEN_API_KEY=local-test-key \
  RAVEN_MODEL=stub-1 RAVEN_MAX_RETRIES=0 npm run dev
```

Measured against it, on a running server:

| Situation | Response |
| --- | --- |
| stub answers | `mode:genai`, `provider:openai-compatible`, `verified:true`, 4 citations |
| stub returns 500 | `mode:knowledge`, `provider:none`, `degraded.because` names the 500 and the upstream text |
| second failure | `x-raven-breaker: open` — later turns skip the endpoint and answer locally (~40 ms instead of ~1.5 s) |
| stub never answers | the client's own timeout ends the turn at `RAVEN_TIMEOUT_MS`, then the same degrade |
| key is rejected (401) | degraded locally with the reason visible; the breaker opens on the first one, because a bad key does not fix itself |

The key appears in none of it: not the body, not the headers, not `raven.turn` (`grep -c` of
the key in the server log returned 0). And the labels stay true in both directions — this
demonstrates that the *plumbing* is real, which is not the same claim as "a model answered
you": with no provider configured every turn says `provider: 'none'`, which is what every
probe in this repository has actually recorded.

## 12. Testing locally

No model, no database, no network needed:

```bash
npm run check            # typecheck + schema drift + assets + speech + face + brain + backend
npm run check:brain      # 91 checks: states, intents, retrieval, tools, memory, drivers
                         #   (including the SQLite one and its schema-parity proof), honesty,
                         #   degradation, canonical response contract, deterministic voice
                         #   selection, concurrency, referent resolution, and the intent shapes
                         #   the browser types
npm run check:backend    # 35 checks: Gemini + OpenAI-compatible transports against a real
                         #   local HTTP server, Supabase REST over real HTTP, both routes,
                         #   the one-line-per-turn log, and a rejection's field set
npm run typecheck
npm run schema           # regenerate db/schema.sql after editing schema.ts
```

`check-brain.mjs` deliberately includes the hostile cases: a stub provider that claims
"worked at Google for 5 years … 99% accuracy" must be rejected and replaced (and the
invented text must not survive in the reply); a rate-limited provider must degrade with
the reason visible; a provider that throws must not 500; a file store must survive a
simulated process restart; `DATABASE_URL` pointing at a dead socket must fall back with a
written reason; and every state in every trace must be a legal transition.

Under the hood the suites run TypeScript directly
(`node --experimental-strip-types --import ./scripts/lib/tsr.mjs`); `scripts/lib/`
contains ~40 lines of resolver hooks so Node accepts `@/` and extensionless imports. That
is the whole test infrastructure — no Jest, no Vitest, nothing to install.

---

## 13. Deliberately not implemented

- **Vision detection.** `context.visionContext` is client-reported data, passed through
  and labelled as such; when asked about it, RAVEN quotes what the page reported and
  states that no vision model ran. No camera analysis happens server-side.
- **Embedding/vector retrieval.** See §6 for why lexical is the right floor here.
- **`pg` as a dependency.** The Postgres path is fully implemented and unit-asserted
  against a mock client plus SQL text checks, but it has not been exercised against a live
  server in this sandbox (no Postgres available, and installing one would be a paid
  service). `npm i pg` is the single step needed.
- **Owner auth, admin UI, rate-limit store shared across instances, queues, background
  jobs.** Rate limiting is per-process and documented as such.
- **Streaming.** Single JSON reply; the console animates its own working state and then
  adopts the server's real end state.
- **Storing raw provider traffic.** Only the answer text is persisted.

## 14. Cost

| Path | Cost |
| --- | --- |
| Knowledge + agentic answers, memory, tools, verification | ₹0, no account |
| Local GenAI (`RAVEN_PROVIDER=openai`, `RAVEN_BASE_URL=http://127.0.0.1:11434/v1`) | ₹0 per query, needs a machine that can run a model |
| Gemini Developer API (`gemini-2.5-flash`) | free tier exists; the `estimate_token_cost` tool prints its own heuristic and its price basis |
| Supabase free Postgres | ₹0 to start, no new dependency (REST driver) |
