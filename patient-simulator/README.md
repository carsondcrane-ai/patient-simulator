# AI Patient Simulator

A web application that lets students practice clinical interviews with AI-powered patient personas. Built on Cloudflare Workers with Google Gemini, D1 for chat log storage, and optional Vectorize for RAG.

## Architecture

```
Student ──▶ Hono Worker (API + static assets)
              │
              ├─▶ D1 ──── users, sessions, chat logs
              ├─▶ Gemini ─ streaming patient responses (SSE)
              └─▶ Vectorize (optional) ─ RAG context from indexed material
```

| Component | Technology |
|---|---|
| Backend | Hono on Cloudflare Workers |
| AI Model | Google Gemini (direct API, streaming via SSE) |
| Database | Cloudflare D1 (SQLite) |
| Vector DB | Cloudflare Vectorize (optional, for RAG) |
| Embeddings | Workers AI `@cf/baai/bge-base-en-v1.5` |
| Auth | Session-based (PBKDF2 hashing, HTTP-only cookies) |

## Prerequisites

1. **Node.js** 18+ and npm
2. **Cloudflare account** (free tier works)
3. **Google Gemini API key** — get one at [Google AI Studio](https://aistudio.google.com/apikey)

## Setup

### 1. Install dependencies

```bash
cd patient-simulator
npm install
```

### 2. Create the D1 database

```bash
npx wrangler d1 create patient-simulator-db
```

Copy the `database_id` from the output and paste it into `wrangler.jsonc`:

```jsonc
"d1_databases": [{
  "binding": "DB",
  "database_name": "patient-simulator-db",
  "database_id": "PASTE_YOUR_ID_HERE"
}]
```

### 3. Run the database migration

```bash
# For local development:
npx wrangler d1 execute patient-simulator-db --local --file=./schema.sql

# For production:
npx wrangler d1 execute patient-simulator-db --file=./schema.sql
```

### 4. (Optional) Create the Vectorize index

If you want RAG with indexed reference material:

```bash
npx wrangler vectorize create patient-indexed-material --dimensions=768 --metric=cosine
```

If you skip this, remove the `vectorize` block from `wrangler.jsonc`. The app will work without it — RAG context is simply omitted.

### 5. Set secrets

```bash
npx wrangler secret put GEMINI_API_KEY
# Paste your Google Gemini API key

npx wrangler secret put SESSION_SECRET
# Paste a random string (e.g. generate one with: openssl rand -hex 32)
```

### 6. (Optional) Set the Gemini model

By default the app uses `gemini-2.0-flash`. To use a different model:

```bash
npx wrangler secret put GEMINI_MODEL
# e.g. gemini-2.0-flash, gemini-2.0-pro, gemini-1.5-flash
```

Or add it as a var in `wrangler.jsonc`:

```jsonc
"vars": { "GEMINI_MODEL": "gemini-2.0-flash" }
```

## Running locally

```bash
npm run dev
```

Open `http://localhost:8787` in your browser. You'll see the login page — register a student account to start chatting.

## Deploying

```bash
npm run deploy
```

Your app will be live at `https://patient-simulator.<your-subdomain>.workers.dev`.

## How it works

### Student flow
1. Student registers/logs in at the home page
2. Clicks "New Session" and picks a patient scenario
3. Chats with the AI patient — responses stream in real-time
4. All messages are stored in D1

### Instructor flow
1. Register with the "Instructor" role
2. View all student interactions on the Logs page
3. Click any session to see the full conversation
4. (Optional) Index reference material into Vectorize for RAG

## Customizing

### Patient scenarios

Edit the files in `patient-scenarios/`. Each `.md` file is a skill file that becomes Gemini's system instruction. Replace the sample content with your actual patient scenario information.

To add a new scenario:
1. Create a new `.md` file in `patient-scenarios/` (e.g. `hypertension.md`)
2. Add an entry in `src/patient.ts` → `SCENARIOS` array:
   ```typescript
   {
     key: "hypertension",
     title: "Hypertension Follow-up",
     description: "A 60-year-old male for routine BP check.",
     skillFile: "hypertension",
   }
   ```

### Indexed material (RAG)

As an instructor, use the "Index Reference Material" form on the Logs page to add medical reference text to the Vectorize knowledge base. When a student sends a message, the app queries Vectorize for relevant context and includes it in the Gemini prompt.

You can also index material programmatically:

```bash
curl -X POST https://your-app.workers.dev/api/index \
  -H "Content-Type: application/json" \
  -b "patient_sim_session=YOUR_SESSION_COOKIE" \
  -d '{"text": "Your reference material here", "metadata": {"tag": "cardiology"}}'
```

### Styling

All styles are in `public/css/styles.css`. The app uses CSS custom properties (variables) at the top of the file for easy theming.

## Project structure

```
patient-simulator/
├── src/
│   ├── index.ts        # Hono app — routes, SSE streaming, static assets
│   ├── auth.ts         # Student/instructor auth (PBKDF2, sessions)
│   ├── db.ts           # D1 queries (users, sessions, messages, logs)
│   ├── gemini.ts       # Gemini API client with streaming
│   ├── patient.ts      # Scenario definitions + system prompt builder
│   └── rag.ts          # Vectorize RAG (optional)
├── public/
│   ├── index.html      # Login / register page
│   ├── chat.html       # Student chat interface
│   ├── logs.html       # Instructor logs dashboard
│   ├── css/styles.css  # Shared styles
│   └── js/
│       ├── login.js   # Auth page logic
│       ├── chat.js     # Chat UI with SSE streaming client
│       └── logs.js     # Instructor logs viewer
├── patient-scenarios/  # Skill files (system prompts for Gemini)
│   ├── chest-pain.md
│   ├── migraine.md
│   └── abdominal-pain.md
├── schema.sql          # D1 database schema
├── wrangler.jsonc      # Cloudflare Workers config
├── package.json
└── tsconfig.json
```

## Notes

- **Vectorize availability**: If your Cloudflare plan doesn't include Vectorize, remove the `vectorize` block from `wrangler.jsonc`. The app gracefully skips RAG when the binding is absent.
- **Gemini API key**: The key is stored as a Cloudflare secret and never exposed to the client. All Gemini API calls happen server-side in the Worker.
- **Session security**: Passwords are hashed with PBKDF2 (100k iterations, SHA-256). Session tokens are random 32-byte strings stored in HTTP-only, Secure cookies.
