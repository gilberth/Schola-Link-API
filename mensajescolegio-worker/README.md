
# Schola-Link-API (Cloudflare Worker)

Bridge API that exposes SieWeb school portal messages to the Hermes bot. Migrated from Python/FastAPI to Cloudflare Workers with Hono + TypeScript.

## Architecture

- **Hono** — HTTP router/framework
- **Durable Object (`SieWebSession`)** — Manages SieWeb authentication session with strong consistency (token, refreshToken, usucod). Serializes concurrent requests to prevent token refresh races.
- **Workers free tier** compatible

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (installed as dev dependency)
- Cloudflare account

## Setup

```bash
# Install dependencies
pnpm install

# Set secrets (you will be prompted for each value)
pnpm wrangler secret put SIEWEB_SCHOOL  
pnpm wrangler secret put SIEWEB_USER     
pnpm wrangler secret put SIEWEB_PASS    
pnpm wrangler secret put HERMES_API_KEY   
```

## Development

```bash
pnpm dev
```

This starts a local dev server at `http://localhost:8787`. For local dev, create a `.dev.vars` file:

```
SIEWEB_SCHOOL=school
SIEWEB_USER=your_user
SIEWEB_PASS=your_password
HERMES_API_KEY=your_api_key
```

> ⚠️ Do NOT commit `.dev.vars` — it is gitignored.

## Deploy

```bash
pnpm run deploy
```

## API Endpoints

All endpoints require the `X-API-Key` header.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | Server status and configured school/user |
| `GET` | `/mensajes?limit=20&folder_id=1&only_unread=false` | List messages (paginated by segment) |
| `GET` | `/mensajes/:id?folder_id=1` | Message detail with recipients and attachments |
| `GET` | `/mensajes/:id/adjuntos/:attachment_id` | Download attachment binary |
| `POST` | `/mensajes/:id/leer?folder_id=1&original_folder_id=1&read=true` | Mark read/unread |

### Example

```bash
curl -H "X-API-Key: your_key" \
  https://schola-link-api.<your-subdomain>.workers.dev/status
```

## Project Structure

```
src/
├── index.ts          — Hono app, routes, X-API-Key middleware
├── sieweb-session.ts — Durable Object (session state + auth retry logic)
├── sieweb-client.ts  — Stateless fetch helpers, URL builders, response parsers
└── types.ts          — Shared TypeScript interfaces (Env, Mensaje, etc.)
```
