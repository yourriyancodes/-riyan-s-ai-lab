# RAVEN local setup

## Start the portfolio

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Connect the AI provider (Google Gemini, free tier)

1. Create a key at <https://aistudio.google.com/apikey>. No credit card is required.
2. Copy `.env.example` to `.env.local` and set:

   ```bash
   RAVEN_API_KEY=<your key>
   RAVEN_MODEL=gemini-2.5-flash
   ```

   `GEMINI_API_KEY` is accepted as an alias if you already use Google's name.
3. Restart the dev server so Next.js reloads the environment.

`RAVEN_API_KEY`, `RAVEN_MODEL`, `RAVEN_PROVIDER`, `RAVEN_API_BASE_URL` and
`RAVEN_TIMEOUT_MS` are read **only** on the server inside `/api/raven`.
No credential is ever sent to the browser.

### Free-tier eligible models

Verified against the current Gemini pricing page: Flash and Flash-Lite models are
free of charge on the free tier, while `gemini-4-argon` and the Pro models are
paid-only.

| Model | Notes |
| --- | --- |
| `gemini-2.5-flash` | **Default.** General-purpose, 1M context, low latency. |
| `gemini-2.5-flash-lite` | Cheapest/latency-optimised alternative. |
| `gemini-3.8-flash` | Newest Flash; strongest of the free options. |
| `gemini-3.6-flash` | Previous-generation Flash. |
| `gemini-3.1-flash-lite` | Lightweight Flash-Lite. |

Exact requests-per-minute and requests-per-day quotas are per project and are
shown in <https://aistudio.google.com/rate-limit>. If you hit them, the API
returns `429` and RAVEN reports state `WAITING` with a retry hint.

## Backend endpoints

- `GET /api/health` reports which infrastructure variables are configured,
  the resolved provider/model, and the free-tier model catalogue.
- `POST /api/raven` takes `{ "input": string, "history"?: [{ "role": "user" | "raven", "text": string }] }`
  and returns `{ state: "SUCCESS", output, provider, model, sources, toolUsed, usage, trace }`
  or a typed failure such as `{ state: "OFFLINE", code: "RAVEN_OFFLINE" }`.

The route never fabricates an answer. With no key it fails closed with `OFFLINE`,
and the browser falls back to the local knowledge engine.

### Verify a real call

```bash
curl -sS -X POST http://localhost:3000/api/raven \
  -H 'Content-Type: application/json' \
  -d '{"input":"What projects has Riyan built?"}' | head -c 600
```

A working key returns `"state":"SUCCESS"` and real model text. An invalid key
returns `PROVIDER_AUTH_ERROR`; a quota exhaustion returns `WAITING`.

## Runtime pipeline

`POST /api/raven` runs the same stages every time and returns them in `trace`:

1. **UNDERSTANDING** — validate and bound the input and short-term memory.
2. **RESEARCHING** — retrieve grounded context from `data/siteConfig.ts`.
3. **PLANNING** — `lib/raven/policy.ts` authorises only read-only tools.
4. **EXECUTING** — call the provider (`lib/raven/gemini.ts`).
5. **VERIFYING** — `lib/raven/verify.ts` rejects empty, oversized, instruction-leaking
   or credential-shaped output.
6. **SPEAKING** — return the verified text to the console.

Tools that would change state must declare `requiresApproval` and are denied
with `APPROVAL_REQUIRED` until a human approves them. Nothing in the current
build writes to a database or executes commands.

## Tests

```bash
npm test        # 24 unit tests: contract, adapter, pipeline, policy, verification
npm run check   # typecheck
npm run build   # production build (fonts are self-hosted, no network needed)
```

## Later infrastructure

- PostgreSQL: `DATABASE_URL`
- Sessions: `SESSION_SECRET`
- Voice: `VOICE_PROVIDER_KEY`

## Social links

Edit `data/siteConfig.ts`.

- WhatsApp: `https://wa.me/<number>`
- Email: `mailto:you@example.com`
- Instagram: profile URL
- GitHub: profile URL
- LinkedIn: profile URL

Empty values stay disabled rather than becoming fake links.
