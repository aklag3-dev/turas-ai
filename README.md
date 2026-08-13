# Turas AI — Predictive Dispatch Dashboard

**Live:** https://aklag3-dev.github.io/turas-ai/

Agentic, multi-modal transit intelligence platform for Irish taxi & ride-hailing drivers. Replaces speculative driving with AI-powered predictive dispatch based on real-time passenger demand, weather, and transit disruptions.

---

## About

Turas AI (Irish: *turas* = journey) calculates the probability a driver will secure a fare within 10 minutes of arriving at a transit hub. It aggregates live flight arrivals, train schedules, ferry ETAs, and Met Éireann weather data to generate a **P_fare score** (0–100%) for each hub.

### Pilot Regions
- **Dublin:** Airport T1/T2, Heuston, Connolly, Dublin Port
- **Cork:** Airport, Kent Station, Ringaskiddy
- **Shannon/Limerick:** Airport, Colbert Station, Foynes Port

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    GitHub Pages (Static)                  │
│  index.html → agents/researcher-agent.js                 │
│             → agents/designer-agent.js                   │
│                          │                                │
│                          ▼                                │
│  ┌─────────────────────────────────────────────────┐    │
│  │      Cloudflare Worker (turas-ai-proxy)          │    │
│  │  /api/flights  → Aviationstack API               │    │
│  │  /api/weather  → Open-Meteo API                  │    │
│  │  /api/rail     → Irish Rail Realtime             │    │
│  │  /api/ferries  → VesselFinder (simulated)        │    │
│  │  /api/route    → OpenRouteService                │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Agent Pipeline
1. **Researcher Agent** — Collects live telemetry (arrivals, weather, disruptions) via Worker proxy
2. **Designer Agent** — Executes P_fare equations, ranks hubs, clusters by demand
3. **Dashboard** — Renders Leaflet map, hub cards, weather strip, chatbot, TTS alerts

---

## P_fare Model

The Fare Probability Score measures likelihood (0–100%) of securing a passenger fare within 10 minutes:

```
Step 1: N_pax = Σ(arrivals × capacity × load_factor)
Step 2: S_base = min(100, (N_pax / K_hub) × 100)
Step 3: M_weather = 1.0 + (min(rain, 10) × 0.035) + temp_modifier
Step 4: M_disrupt = 1.0 + (disruption × 0.25)
Step 5: B_supply = hourly_density × platform_access
Step 6: P_fare = clamp((S_base × M_weather × M_disrupt) / B_supply, 5, 99)
```

**Capacities:** European flight 180 · Transatlantic 280 · Regional train 200 · Ferry 400  
**Load factors:** Flights 0.82 · Trains 0.65 · Ferries 0.50  
**Hub baselines (K_hub):** DUB T1/T2 = 450 · Heuston = 250 · Cork = 120 · Shannon = 100

---

## Deployment

### Static Site (GitHub Pages)
The `deploy/` folder is the GitHub Pages root. Push to `main` branch triggers auto-deploy.

### Cloudflare Worker
```bash
cd deploy/worker
npm install
npm run deploy
npm run secret:aviationstack   # Set Aviationstack API key
npm run secret:ors             # Set OpenRouteService API key (optional)
```

### Worker Endpoints
| Endpoint | Purpose | API Key Required |
|----------|---------|------------------|
| `/api/flights?city=dublin` | Flight arrivals | Aviationstack |
| `/api/weather?lat=53.35&lon=-6.26` | Hourly forecast | None (Open-Meteo) |
| `/api/rail?station=dub-heuston` | Train arrivals | None |
| `/api/ferries` | Ferry ETAs | None (simulated) |
| `/api/route?start_lat=...&start_lon=...&end_lat=...&end_lon=...` | Driving route | OpenRouteService |
| `/api/health` | Worker status | None |

---

## Features

- **Live P_fare Scores** — Colour-coded pins (green ≥80%, amber 50–79%, red <50%)
- **Search Configuration Box** — Demo City, Primary Platform, and Search Radius (10–100 km)
- **Persistent Stepper Panel** — Real-time 4-step task progress tracking on screen
- **OSRM Road Route Navigation** — Real driving road geometry, distance, and travel time
- **Hub Details Extension Panel** — Deep-dive overview, $P_{fare}$ parameters ($S_{base}, M_{weather}, M_{disrupt}, B_{supply}$), arrivals stream, weather telemetry & raw JSON
- **Google Gemini 2.5 Flash Chatbot** — Intelligent AI assistant for hub rules and general out-of-domain questions
- **Drive Mode** — High-contrast UI with TTS audio alerts for hands-free operation
- **Outcome Feedback** — Drivers log results to calibrate the prediction model
- **Zero-PII** — Anonymous session IDs (AC-UUID), no personal data collected
- **EU AI Act Compliant** — Article 50 transparency notice, explainable parameters

---

## Future Roadmap & Features

1. **Recommendation Sharing (Social Dispatch)**
   - Share live hub recommendations with other drivers or dispatchers via unique URL links, email, SMS/text message, or WhatsApp.
   - One-click QR code export for instant mobile navigation.

2. **User Accounts & Driver Profiles**
   - Passwordless driver accounts (FIDO2 passkey / OAuth2).
   - Saved custom radius defaults, favorite hub watchlists, and preferred platform settings.
   - Personal shift yield analytics and $P_{fare}$ prediction accuracy tracking.

3. **Multi-Vehicle Powertrain Integration**
   - EV-specific hub recommendations with live ESB eCars charging station availability.

4. **Time-Series Surge Heatmaps**
   - Predictive demand heatmaps forecasting passenger arrival surges 2–4 hours in advance.

---

## Academic Context

Built for the **NCI Higher Diploma in AI for Business** assessment (H9CEAI: Customer Engagement & Artificial Intelligence).

### Assessment Criteria Met
1. **Agent Architecture (25%)** — Five agents: Researcher, Designer, Maker, Communicator, Manager
2. **Handoff & Orchestration (25%)** — Unbroken sequential JSON pipeline
3. **Working Prototype & Live MCP (20%)** — GitHub Pages + Cloudflare Worker + live APIs
4. **Strategic Rationale & Governance (15%)** — GDPR zero-PII, EU AI Act Article 50
5. **Reflection & Evaluation (15%)** — Feedback loop for model calibration

---

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS, Leaflet.js, OpenStreetMap
- **Backend:** Cloudflare Workers (ES modules)
- **APIs:** Aviationstack, Open-Meteo, Irish Rail Realtime, OpenRouteService
- **Hosting:** GitHub Pages (static), Cloudflare (Worker proxy)

---

## License

Educational project — NCI H9CEAI assessment.
