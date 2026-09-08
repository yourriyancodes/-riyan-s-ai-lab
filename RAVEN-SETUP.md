# RAVEN local setup

## Start the portfolio

```bash
pnpm install        # or: npm install
pnpm dev            # or: npm run dev
```

Open http://localhost:3000. The console works immediately — no key, no database, no
second process to start. `RAVEN-BRAIN.md` is the architecture document.

## Backend endpoints

- `POST /api/raven` — one turn of the brain. Always answers with the same response shape,
  success and failure alike; `mode` says what generated the text
  (`knowledge · genai · agentic · offline`).
- `GET /api/raven` — what body the endpoint accepts.
- `GET /api/health` — measured capabilities: provider, driver actually opened, corpus
  counts, tool table. `?probe=0` skips the provider reachability probe.

Nothing is reported as available unless it was just checked. With no configuration the
console says "deterministic knowledge engine", not "LLM backend online".

## Turn things on (all optional)

**Local GenAI, ₹0** — Ollama (or LM Studio) on the same machine:

```bash
ollama pull llama3.1
```

```ini
# .env.local
RAVEN_PROVIDER=openai
RAVEN_BASE_URL=http://127.0.0.1:11434/v1
RAVEN_MODEL=llama3.1
```

**Google Gemini (Developer API)** — `.env.example` documents every key:

```ini
RAVEN_API_KEY=<your key>
RAVEN_MODEL=gemini-2.5-flash
```

**Persistent memory on Postgres** — Supabase's REST transport needs no dependency:

1. apply `db/schema.sql` in the Supabase SQL editor;
2. set `SUPABASE_URL` and `SUPABASE_DB_KEY`.

For a normal connection string, `npm install pg` and set `DATABASE_URL`. Until `pg` is
installed the brain says so in `metadata.database.detail` and uses its file store.

**No database at all** — the default. Conversations and durable facts are written to
`.raven-data/*.json` (git-ignored) and survive restarts. `RAVEN_ALLOW_FILE_STORE=0`
forces the in-process store, and the console is then told persistence is ephemeral.

**Force a driver** (for testing or a constrained host): `RAVEN_DB_DRIVER=postgres |
postgres-rest | file | memory`.

## Verify

```bash
npm run check        # typecheck, schema drift, assets, speech, face, brain, backend
npm run check:brain  # 58 brain checks — no model or database required
npm run check:backend
```

## Talking to it

```bash
curl -s localhost:3000/api/raven -H 'content-type: application/json' \
  -d '{"message":"what projects has riyan built?"}'

curl -s localhost:3000/api/health | head -30
```

Try these, in this order, to see the honesty model work:

| Ask | Expect |
| --- | --- |
| `who are you?` | `mode:knowledge`, cited to `data/siteConfig.ts` |
| `what is Riyan's email?` | refuses: no contact link is published |
| `which project best demonstrates retrieval?` | `mode:agentic`, ranked lexically and says so |
| `remember that my favourite language is TypeScript` then reload, then `what do you remember?` | the fact comes back from disk |
| `scroll to the projects section` | action `proposed`, performed by the browser |
| `which cricket match did he watch in 2019?` | `mode:offline` — nothing is invented |

## Social links

Edit `data/siteConfig.ts` → `socialLinks`. Until a real `https://` or `mailto:` value is
there, `get_contact` reports `published:false` and RAVEN says the portfolio has not
published a contact channel, rather than guessing one. The knowledge corpus is rebuilt
from the same file, so the page and the brain cannot drift apart.
