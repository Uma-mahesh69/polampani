# 🌾 PolamPani · పొలం పని

**Fieldwork, filled on time.** PolamPani is an open-source, AI-powered platform that connects farmers with agricultural labourers (coolies) nearby. Farmers post fieldwork by typing or speaking, in Telugu or English. An explainable matching model instantly alerts the workers most likely to accept. If a job isn't filling, the search widens automatically, so no crop is lost to a labour shortage.

> Built for **Hacktoberfest Hack Day × AI for Vizag**. Track: **Best Open Source AI Project**.

---

## The problem

During transplanting and harvest windows, a few days' delay can cost a farmer a large share of the crop. Farmers find labour by word of mouth: calling middlemen and visiting villages. Labourers, meanwhile, miss work that is happening a few kilometres away. Nothing connects the two in real time.

## What PolamPani does

| For farmers 👨‍🌾 | For labourers 🧑‍🌾 |
|---|---|
| Post work in seconds: **type or speak** in Telugu/English and AI fills the form | Get **instant alerts** for jobs that fit their skills, location and free days |
| **AI fair-wage suggestion** + **labour-shortage forecast** before posting | **AI-ranked job feed** with a match % and plain-language reasons |
| Live progress: alerted → considering → confirmed (with one-tap call) | Accept in one tap; get directions and the farmer's number |
| **Auto-escalation**: unfilled jobs re-alert in wider radius rounds | Set availability and working days; no spam when unavailable |
| Instant replacement search if a worker cancels | Double-booking protection (one job per day) |

## How the AI works

### 1. Explainable matching model (`src/matcher.js`)
For every worker–job pair we compute six interpretable features:

| Feature | Signal |
|---|---|
| Proximity | `exp(-distance_km / 10)` (Haversine distance from worker's home to the field) |
| Skill match | 1.0 exact skill, 0.55 related skill (e.g. weeding ↔ transplanting), 0.15 new work |
| Availability | Is the job's weekday one of the worker's working days? |
| Wage fairness | Offered wage vs. the worker's expected wage |
| Reliability | Worker rating |
| Experience | log-scaled jobs completed |

A **logistic-regression model** turns these into *P(worker accepts and shows up)*. It starts from expert priors and **learns online** with SGD from every accept (label 1) and decline (label 0). Over time it adapts to local behaviour (e.g. if workers in an area care more about distance than wage). Every score comes with **human-readable reasons**, so farmers and workers can see *why* a match was made. No black box.

**Hard constraints** filter candidates before ranking: worker unavailable, already booked that day, or outside their travel radius (× the escalation multiplier).

### 2. Smart dispatch + auto-escalation (`src/jobs.js`)
- When a job is posted, the top `max(4, spots × 3)` candidates are alerted (live via Server-Sent Events + optional SMS webhook).
- Round *n* widens every worker's travel radius: `1× → 1.6× → 2.5× → 4×`.
- Escalation triggers automatically when a job is still open after `ESCALATE_AFTER_MIN` minutes, when declines leave fewer people considering than open spots, or when a confirmed worker cancels.
- When a job fills, everyone else who was alerted is told it's closed.

### 3. Multilingual job-post understanding (`src/nlp.js`)
An on-device rules engine understands English, Telugu script, transliterated Telugu and some Hindi:

```
"Need 6 people for paddy transplanting near Anakapalli tomorrow 6am, 550 per day"
"రేపు చోడవరం లో చెరకు నరకడానికి 8 మంది కావాలి, కూలి 600 రూపాయలు, ఉదయం 6 గంటలకు"
"saturday weeding work in sabbavaram, naluguru kavali, rs 450"
```
→ work type, workers needed, wage, date, start time, village + coordinates.

Optionally, point `LLM_BASE_URL` at any **OpenAI-compatible open-weights model server** (e.g. [Ollama](https://ollama.com)) and its output is merged in for harder phrasing. Voice input uses the browser's speech recognition (`te-IN` / `en-IN`).

### 4. Fair-wage & shortage forecast
Before posting, the farmer sees the median expected wage of skilled workers within 25 km, how many are free that day, and a shortage-risk level with a suggested wage.

## Why open source matters here
- **Runs fully offline / self-hosted**: no paid AI API, no data leaves the server. Any cooperative, FPO, NGO or panchayat can run it.
- **Transparent matching**: workers and farmers can audit exactly how they are ranked.
- **Localisable**: add a district's villages, crops and language keywords in one file (`src/catalog.js`, `src/nlp.js`).

## Quick start

Requires **Node.js ≥ 22.13** (uses the built-in `node:sqlite`, so there's no native build step).

```bash
npm install
npm start
```

Open http://localhost:3000. Demo data (8 farmers, 40 labourers around Visakhapatnam, 4 live jobs) is seeded automatically.

```bash
npm run reset   # wipe the database and reseed demo data
npm run dev     # auto-restart on file changes
```

### Optional configuration

| Env var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `DB_PATH` | SQLite file | `data/polampani.db` |
| `ESCALATE_AFTER_MIN` | Minutes before an unfilled job is re-dispatched wider | `10` |
| `LLM_BASE_URL` | OpenAI-compatible endpoint, e.g. `http://localhost:11434/v1` (Ollama) | off |
| `LLM_MODEL` | Model name | `llama3.2` |
| `LLM_API_KEY` | Bearer token if your server needs one | |
| `SMS_WEBHOOK_URL` | POST `{to, name, message}` here for every alert (plug in any SMS gateway) | off |
| `LOG_SMS` | Print would-be SMS to the console | off |

```bash
# Example: use a local open-weights model via Ollama
ollama pull llama3.2
LLM_BASE_URL=http://localhost:11434/v1 npm start
```

## 🎬 2-minute demo script

1. Open two browser windows side by side. In window A pick a **farmer** (e.g. *Ramana Rao*); in window B pick a **worker**.
2. Farmer: type or 🎤 speak *"Need 6 people for paddy harvesting near Anakapalli day after tomorrow 6am, 600 per day"* → **✨ AI auto-fill**. Show the **fair-wage suggestion** and **shortage risk**.
3. **Post**. The toast shows how many workers were alerted. Expand **🤖 AI matches** to see ranked workers with reasons.
4. Worker window: the alert pops up live with a sound. Click **Accept**. The farmer's progress bar and updates refresh in real time.
5. Decline a job as another worker. The **🧠 model card** updates its learned feature weights. Click **📣 Alert more workers** to show radius escalation.
6. Toggle **తెలుగు** in the header to show the Telugu interface.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/meta` | Work types, villages, stats, model info |
| GET/POST | `/api/users` | List (`?role=`) / register users |
| PATCH | `/api/users/:id` | Update availability, days, skills, wage, radius |
| POST | `/api/ai/parse` | `{text}` → structured job fields |
| GET | `/api/ai/insight` | Fair wage + supply forecast (`work_type, lat, lng, date, workers_needed`) |
| GET | `/api/ai/model` | Current model weights, samples, accuracy |
| GET/POST | `/api/jobs` | List (`?farmer_id=`) / create + auto-dispatch |
| GET | `/api/jobs/:id/matches` | Ranked candidates with reasons |
| POST | `/api/jobs/:id/{dispatch,accept,decline,withdraw,complete}` | Lifecycle actions |
| GET | `/api/workers/:id/feed` | AI-ranked open jobs for a worker |
| GET | `/api/workers/:id/assignments` | Worker's confirmed jobs |
| GET | `/api/notifications?user_id=` | Notifications |
| GET | `/api/stream?user_id=` | Server-Sent Events for live alerts |

## Project structure

```
server.js          Express app + routes + auto-escalation timer
src/catalog.js     Work types, villages (Vizag region), geo/date helpers
src/matcher.js     Feature engineering, logistic model, online learning, wage insight
src/nlp.js         Multilingual job-post parser (+ optional open LLM)
src/jobs.js        Job lifecycle: dispatch, accept, decline, withdraw, complete
src/notifier.js    SSE push + SMS webhook
src/seed.js        Demo data
public/            Vanilla JS frontend (Leaflet/OpenStreetMap map, EN/TE i18n)
```

## Roadmap
- IVR / missed-call and SMS-reply flows for labourers without smartphones
- Ratings by farmers after each job, feeding back into reliability
- Group/crew bookings (a *mestri* accepting for a team)
- Crop-calendar demand forecasting to pre-alert workers before peak season
- Payments via UPI with wage receipts

## Contributing
Contributions are welcome, especially **translations**, **new district village lists**, and **crop/keyword dictionaries**. Fork, branch, and open a PR.

## License
[MIT](LICENSE)
