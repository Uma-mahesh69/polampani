# PolamPani: Pitch & Presentation Guide

## The 2-minute pitch

**Problem (20s).** In coastal Andhra and across rural India, transplanting and harvest windows are just days long. Farmers still hunt for labour by phoning middlemen and driving from village to village; a short delay can wipe out a major share of the harvest. Meanwhile, agricultural labourers miss paid work only a few kilometres away. Existing apps assume English, high literacy, and constant high-speed data.

**Demo (70s).**
1. **Try it live:** On the landing page, type or tap any sentence in **Telugu, Hindi, Tamil, Kannada, or English**. AI instantly extracts the structured work chit with live model badges (Gemini 3.8 Flash / local AI).
2. **Farmer flow:** Post work by voice or text. AI fills work type, workers needed, date, time, duration, wage, and village; calculates **fair wage guidance**, and gives a **fill forecast** (Poisson-binomial probability of full crew from round 1).
3. **Worker flow (Window 2):** Alert arrives in real-time over SSE. Worker taps the speaker to **hear it in Telugu** and accepts in one tap. The farmer's crew progress updates live.
4. **AI matching & dispatch:** Open the job chit to see **AI matches with explainable reasons** (distance, skills, free days, wage match, rapport). Re-alert widens radius automatically (`1× → 1.6× → 2.5× → 4×`).
5. **Field day:** "I've reached the field" check-in, attendance marking, star ratings, and cash / UPI settlement record.
6. **Impact dashboard:** Transparent view of platform metrics, jobs filled, wages earned, and the matching model's live learned weights.

**Why it wins Best Open Source AI (30s).**
- **Explainable & Adaptive AI:** Online logistic regression with 7 signals that learns continuously from every accept, decline, and no-show via SGD. No black box.
- **Multilingual for India:** Native understanding across Indian languages via free-tier Gemini API (Google AI Studio) and open-weights LLMs (Ollama), backed by an offline edge engine for zero-network reliability.
- **Self-contained & Open Source:** Zero paid dependencies required. Runs locally or in village co-ops on Node.js + SQLite with zero native builds. MIT licensed.

---

## Presentation Cheat Sheet (Stage Checklist)

### 30 Seconds Before You Go On Stage
1. Ensure your terminal has the server running:
   ```powershell
   $env:GEMINI_API_KEY="your-key-here"  # optional, offline rules work too!
   npm start
   ```
2. Open two browser windows side by side:
   - **Left Window:** `http://localhost:3000/#/` (Landing / Farmer)
   - **Right Window:** `http://localhost:3000/#/login?role=worker` (Worker login)
3. In Left Window, log in as **Ramana Rao Gorle (Anakapalli)** via *Explore with a demo account*.
4. In Right Window, log in as a worker who has alerts (e.g. **Ravi Kumar** or **Lakshmi**).

### Click-by-Click Demo Path
| Step | Action | What to Say |
|---|---|---|
| **1. Landing** | Tap the **Telugu** or **Hindi** button under "Try it" | *"Farmers speak naturally in their mother tongue; AI extracts structured parameters instantly."* |
| **2. Post Work** | Left window: click **Post Work**, type or paste: `రేపు ఉదయం 6 గంటలకి 6 మంది కావాలి, కూలి 600` | *"AI fills in the date, time, workers, and suggests fair wage according to regional supply."* |
| **3. Review** | Show the **Fill Forecast** circle | *"Poisson-binomial model forecasts the probability of a full crew before you even post."* |
| **4. Live Alert** | Click Post. Watch Right Window receive alert with notification beep | *"Instant push alert with zero polling. Worker can tap to hear it read aloud."* |
| **5. Accept** | Right window: click **Accept** | *"Instant confirmation. Farmer's progress ring updates in real time."* |
| **6. Explainable AI** | Left window: click into the job -> **AI matches** | *"Every match explains WHY: distance, skill overlap, wage match, reliability, and past rapport."* |
| **7. Impact** | Click **Impact** in top nav | *"Live SGD weights shifting from priors. Full transparency on model learning and economic impact."* |

---

## Likely Judge Questions & Winning Answers

**Q: Is this real AI or just rule-based regex?**
> **Answer:** It uses real AI at two distinct layers:
> 1. **Matching Engine:** An online logistic-regression model (7 interpretable features) trained dynamically with stochastic gradient descent (SGD) on every real accept, decline, and no-show. The weights visibly move from expert priors on the Impact page.
> 2. **Language Understanding:** Dual-engine architecture. It connects to **Google AI Studio (Gemini 3.8 Flash)** or local open-weights LLMs (Ollama) for deep multilingual comprehension across Indian languages, with a fast offline regex fallback so rural users are never locked out when offline.

**Q: Why Gemini API / Open Source LLM rather than a proprietary SaaS wrapper?**
> **Answer:** Gemini via Google AI Studio offers a generous free tier (15 RPM / 1M tokens/min) with world-class Indic language support. Furthermore, PolamPani also natively supports self-hosted local open models via `LLM_BASE_URL` (Ollama/vLLM), meaning cooperatives or panchayats can run 100% offline air-gapped without spending a rupee.

**Q: How do you handle non-smartphone users?**
> **Answer:** Every alert and OTP is formatted for SMS via `SMS_WEBHOOK_URL`. Any basic GSM modem or Indian SMS gateway can broadcast these. The worker can accept via SMS or missed-call webhook.

**Q: How does the system prevent labourer no-shows?**
> **Answer:** 
> 1. Attendance check-in on the day of work ("I've reached the field").
> 2. Reliability is a direct input feature into the model ($0.6 \times \text{rating} + 0.4 \times \text{showRate}$).
> 3. No-shows trigger immediate negative gradient descent steps, demoting that worker in future rankings.
> 4. Auto-escalation automatically triggers a wider search radius if confirmed workers withdraw.

**Q: How does this scale beyond Visakhapatnam?**
> **Answer:** All regional intelligence (crop calendars, village coordinates, regional work types) is decoupled in `src/catalog.js`. Adding a new district in Andhra, Telangana, Punjab, or Tamil Nadu requires simply appending a list of villages and local crop cycles. SQLite easily handles single-district traffic; the queries are cleanly structured for PostgreSQL migration.
