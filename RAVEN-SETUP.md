# RAVEN local setup

## Start the portfolio

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

## Backend endpoints

- `GET /api/health` reports which infrastructure variables are configured.
- `POST /api/raven` validates input and fails closed when no real AI provider is connected.

The current code deliberately does not fabricate an AI response.

## Later infrastructure

- PostgreSQL: `DATABASE_URL`
- AI provider: `RAVEN_API_KEY` + `RAVEN_MODEL`
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
