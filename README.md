# AI-first Telegram Task Bot

This starter implements the AI-first flow:
- `/quick` -> parse -> review -> confidence gate -> confirmation
- `/confirm` -> save task
- Minimal backend logic (schema guardrails, auth, persistence)

## 1) Install

```bash
npm install
```

## 2) Configure

Copy `.env.example` to `.env` and fill values.

Required:
- `TELEGRAM_BOT_TOKEN`
- `OWNER_TELEGRAM_USER_ID`
- `AI_API_BASE_URL`
- `AI_API_KEY`

Optional:
- `DATABASE_URL` (if missing, tasks are stored in memory for demo)

## 3) Database

Run `db/schema.sql` in PostgreSQL.

## 4) Run

```bash
npm run dev
```

## Project layout

- `db/schema.sql`: PostgreSQL schema
- `api/openapi.yaml`: AI service contract (`/v1/parse`, `/v1/review`, `/v1/summarize`)
- `prompts/*.txt`: system prompts for parser/reviewer/summarizer
- `src/ai/*`: AI client and result schema
- `src/bot/createBot.js`: Telegram command flow
- `src/infra/db.js`: persistence (Postgres + memory fallback)

## Next build targets

1. Add whitelist table + admin commands.
2. Add scheduler for daily digest / due reminders.
3. Add `/report daily|weekly|monthly` using `/v1/summarize`.
4. Add AI audit log insertions after each call.
