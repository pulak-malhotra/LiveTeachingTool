# Teacher Copilot — Agentathon Demo

## What This Is

Live demo app for the Quizizz/Wayground agentathon (April 10, 2026). The product demos itself: presenter talks on stage → app transcribes live → tracks topic/standard coverage in real-time → generates a quiz from the talk → (future) audience plays the quiz on Quizizz.

The "aha moment": the presenter reveals the agent has been listening the whole time, generates a quiz about the talk, and the audience plays it live.

## Stack

Node.js (Express) + vanilla HTML/CSS/JS. No frameworks. ES modules (`"type": "module"`).

## Running

```bash
cp .env.example .env  # fill in API keys
npm install
npm start             # or: npm run dev (auto-reload)
# → http://localhost:3000
```

## File Map

| File | What it does |
|---|---|
| `server.js` | Express server, 3 routes: `/api/transcribe` (Whisper), `/api/generate-quiz` (Claude), `/api/check-topics` (Claude coverage + suggestions) |
| `public/index.html` | Single page: header controls, 3-column coverage dashboard, quiz panel, transcript strip |
| `public/style.css` | Wayground-branded dark purple (#1a0e2e) + hot pink (#e2186f) theme, projector-optimized |
| `public/app.js` | Audio recording (10s chunks via MediaRecorder), transcription, coverage checking, activity feed, agent state, quiz rendering |

## API Configuration

### Claude (via Portkey gateway)
- Routed through Portkey: `baseURL: https://api.portkey.ai`
- Headers: `x-portkey-api-key` + `x-portkey-provider: @azure-anthropic-east-us2`
- Falls back to direct Anthropic API if `PORTKEY_API_KEY` is not set
- **Model: `claude-sonnet-4-6`** — this is the Azure deployment name
- `claude-sonnet-4-5-20250929` does NOT work (returns 404 DeploymentNotFound on Azure)

### OpenAI Whisper
- Model: `whisper-1`, response format: text
- Audio uploaded via multer (memory storage), written to temp file, streamed to API, cleaned up

## Env Vars

| Var | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | Yes | Whisper transcription |
| `PORTKEY_API_KEY` | Yes (if Portkey) | Routes Claude through Portkey gateway |
| `PORTKEY_PROVIDER` | No | Defaults to `@azure-anthropic-east-us2` |
| `ANTHROPIC_API_KEY` | Only without Portkey | Direct Anthropic fallback |
| `PORT` | No | Defaults to 3000 |

## Known Gotchas

1. **Model name on Azure**: Use `claude-sonnet-4-6`, NOT `claude-sonnet-4-5-20250929`. The latter 404s.
2. **OpenAI SDK startup crash**: `new OpenAI()` throws if `OPENAI_API_KEY` is unset. We pass `|| 'missing'` to defer errors to call time.
3. **Port conflicts**: If server won't start with EADDRINUSE, kill the old process: `lsof -ti:3000 | xargs kill`

## Deferred Work

- **Quizizz integration**: Route 3 (`POST /api/create-quiz`) removed. User said "will add tomorrow." Needs `QUIZIZZ_API_TOKEN`.
- **Auto-detect topics from transcript**: Proposed but not built.

## UX Decisions

- **Coverage dashboard is the hero** — Topics + Standards are front and center
- **Transcript takes a backseat** — thin strip at the bottom, single-line ticker
- **Activity feed** — right column showing everything the agent does, timestamped and color-coded
- **Agent state indicator** in header: Idle → Listening → Transcribing → Analyzing
- **10-second audio chunks** for transcription (good balance of speed and coherence)
- **Projector-optimized**: base font 18px, high contrast, dark theme, large buttons

## Style Guide

Wayground branding:
- Background: `#1a0e2e` (deep purple)
- Surface: `#241539`
- Primary: `#e2186f` (hot pink/magenta)
- Text: `#f0eaf8`
- Success: `#00b894`
