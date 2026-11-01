# PolamPani: pitch notes

## The 2-minute pitch

**Problem (20s).** In coastal Andhra, paddy transplanting and harvest windows are a few days long. Farmers still find labour by phoning middlemen and driving to nearby villages, and a short delay can cost a big share of the crop. Meanwhile labourers miss paid work a few kilometres away. The tools that exist assume English, literacy and a good connection.

**Demo (70s).**
1. On the landing page, type the Telugu sentence a farmer would actually say. It becomes a structured work request as you type.
2. As a farmer, post that work by voice or text. AI fills in the details, suggests a fair wage, and shows the **chance of a full crew** before posting.
3. In a second window as a worker, the alert arrives instantly. Tap the speaker to **hear it in Telugu**, then accept. The farmer's screen updates live.
4. Open the job: **AI matches with reasons** for every worker, invite one, or widen the search.
5. Show today's job: check-ins, mark who came, rate, and pay by UPI.

**Why it wins Best Open Source AI (30s).** The AI is open and explainable: an online logistic-regression model with seven signals that learns from every accept, decline and no-show, and shows *why* for every match. It runs entirely on your own server, with no paid API and no data leaving the machine. A farmer cooperative, an FPO or a panchayat can run it for their own villages. Telugu is a first-class language, not a translation layer.

## Likely questions

**Is this real AI or rules?** Both, deliberately. Matching is a learned model (logistic regression, trained online with SGD on accept, decline and no-show labels). Its weights visibly shift from the priors on the Impact page. Language understanding is an offline rules engine for Telugu, English and Telugu in English letters, so it works without internet. It can call any open-weights LLM through `LLM_BASE_URL` for harder phrasing. Explainability and offline operation mattered more here than model size.

**Is the data real?** The demo uses seeded farmers and workers around Visakhapatnam with 30 days of *simulated* history. The model's starting accuracy comes from simulated responses. In production the same loop runs on real responses. The README says this openly.

**What about workers without smartphones?** Every alert and login code goes through an SMS webhook (`SMS_WEBHOOK_URL`) that any Indian SMS gateway can receive. The roadmap has missed-call/IVR acceptance.

**How does it prevent no-shows?** Reliability (rating and show-up rate) is a model feature, workers check in on the day, farmers mark attendance, and absences lower future ranking. Cancellations trigger an automatic replacement search.

**How would it scale beyond Vizag?** Villages and crop calendars are data in one file (`src/catalog.js`). Matching is per job and cheap. SQLite fits a district; the data layer is isolated in `src/db.js` for a move to Postgres.

**What did you test?** 13 unit and API tests, and a 52-check browser suite covering every flow, including two users in real time. Lighthouse mobile scores are 98 to 100.
