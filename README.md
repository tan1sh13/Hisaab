# CivicTrack: Transparency and Coordination in Public Works

> **Track:** CivicTech: *Improving Transparency and Coordination in Public Works Projects*
> **Event:** 24-Hour Web Development Hackathon, IIITDM Kancheepuram (09–10 Oct 2026)

| | |
|---|---|
| **Team name** | `<TEAM NAME>` |
| **Team leader** | `<NAME>` |
| **Team members** | `<NAME 1>`, `<NAME 2>`, `<NAME 3>`, `<NAME 4>` |
| **Live demo (public link)** | `<DEPLOYED URL>` |
| **Demo video (2–5 min)** | [`/demo/demo.mp4`](./demo/demo.mp4) |
| **Demo logins** | See [Demo accounts](#demo-accounts) |

---

## 1. Problem Statement

Residents see roads dug up, drains under repair and pipelines being laid every day. These projects are run by different municipal and utility departments and contractors, and:

- **Information is scattered.** Project details sit in offices, on notice boards and in informal channels, and rarely reach the people affected.
- **Residents can't see the basics.** They can't tell a project's purpose, timeline, responsible authority, or why it is delayed.
- **Departments don't coordinate.** The same road can be dug up several times in a few months by different departments.
- **There is no accountability.** When work stalls or is done badly, there is no simple way to follow up, verify progress or hold anyone responsible.
- **Deadlines slip silently.** Residents have no reliable way to plan around disruptions.
- **Public money is wasted unnoticed.** Duplicated work and poor coordination cost money, and citizen feedback is not used to catch problems early.

**Impact:** traffic problems, safety hazards, business losses, falling trust in local authorities, and residents who feel unheard.

---

## 2. Our Solution

CivicTrack is a web platform with **two views on one shared dataset**:

- a **Citizen View** that makes every public work visible, understandable and trackable, and
- a **Department View** that groups citizen-reported problems by location and severity and sequences the departments that must work at the same spot.

### 2.1 Citizen View (transparency)

| Feature | What the citizen gets |
|---|---|
| **Public works map** | Every project on a map and list, filterable by area, department, status and severity. |
| **Project detail page** | Purpose, **responsible department**, **contractor**, start/end dates, current status and a full timeline. |
| **Budget transparency** | **Sanctioned budget**, amount spent so far, **maintenance budget/cost** and variance (over or under budget). |
| **Delay explanations** | Every deadline change requires a reason. A delay history log is shown publicly and delayed projects get an automatic "Delayed" badge. |
| **Report a problem** | Submit an issue with a geotagged photo, category (sewage, road, drainage, water, electricity, etc.) and description. |
| **Verify progress** | Nearby residents confirm "work in progress" or "completed", which is compared against the status claimed by the contractor. |
| **Follow-up and tracking** | Track the status of every report and see the department's reply. Confirm whether the issue was truly resolved. |
| **Area alerts** | Subscribe to an area or route and get notified of upcoming work and closures. |
| **Dig-once schedule** | See the planned order of works at a location, so residents know *when* each department will arrive. |

### 2.2 Department View (coordination and feedback)

#### Step 1: Group problems
Citizen reports are automatically clustered:

1. **By location**, merging reports within a small radius (e.g. 50 m) into one *location cluster*.
2. **By problem type** within each cluster (sewage leak, pothole, drain blockage, broken cable, ...).

Ten complaints about the same pothole become **one** problem with a "10 reports" count.

#### Step 2: Classify severity
Each problem group is rated **Minor / Moderate / Major**, using transparent rules:

| Severity | Rule of thumb (configurable) |
|---|---|
| **Major** | Safety or health risk (open sewage, exposed wires, large road cave-in), or many reports (e.g. 10+), or work stalled for 14+ days |
| **Moderate** | Disrupts daily use (blocked drain, large pothole), or 4–9 reports |
| **Minor** | Cosmetic or low impact, 1–3 reports |

Officers see a **prioritised queue** sorted by severity, then report count, then age.

#### Step 3: Multiple problems at one location, with a primary and a secondary department
When one location has problems belonging to **more than one department**, the system builds a **coordinated work order**:

1. A **primary department** is assigned using a configurable dependency order. Underground work always goes first and surface work last, for example:
   `Sewage / Water → Drainage → Electricity / Telecom → Roads`
2. The primary department is **told to do the primary job first**.
3. The **secondary department is scheduled to arrive 1 hour after the primary department marks its work complete** (the gap is configurable).
4. When the primary marks "Complete", the secondary is **notified automatically** and gets a confirmed start time.
5. The citizen sees the whole sequence on the project page.

> **Example:** At *3rd Main Rd* there is a sewage leak and a pothole. The Sewage Dept is primary and fixes the leak. The moment they mark it done, the Roads Dept is notified to arrive **1 hour later** to repair the pothole, so the road isn't dug twice.

#### Step 4: Dig-once conflict detection
When a department plans work on a road segment, the system flags any other planned or recent work nearby (within X months) and suggests merging the jobs. This addresses repeated digging of the same road.

#### Step 5: Analytics and early warning
- Heatmap of complaint hotspots.
- Scorecards per department and contractor: complaints per project, average response time, repeat-issue rate, delay rate, budget variance.
- Early-warning alerts when a project crosses a complaint threshold (e.g. 5 in a week).
- Escalation to the department head if a report is unanswered for N days.

---

## 3. Role-Based Access

| Role | Can do |
|---|---|
| **Citizen** (also public, no login) | Browse projects and budgets, view schedules |
| **Citizen (logged in)** | Report issues, verify progress, subscribe to alerts, confirm resolution |
| **Department officer** | See their department's grouped problems, update status, mark work complete, reply to reports, enter delay reasons |
| **Admin** | Manage departments, contractors, severity rules, sequencing order and the gap between primary and secondary work |

---

## 4. How the Project Maps to the Evaluation Criteria

| Criterion (weight) | Where to look |
|---|---|
| **Innovation (20%)** | Primary/secondary department sequencing with automatic hand-off, dig-once conflict detection, and crowd-verified progress versus the contractor's claim. |
| **Technical Implementation (35%)** | Location-and-type clustering, severity engine, sequencing/scheduling engine, escalation rules, role-based access, input validation, and edge cases (see below). |
| **Feasibility (20%)** | See [Feasibility and Future Scope](#8-feasibility-and-future-scope). |
| **Video Presentation (15%)** | [`/demo/demo.mp4`](./demo/demo.mp4), a 2–5 min walkthrough of the end-to-end scenario. |
| **Deployment (10%)** | Public link at the top of this README with seeded demo data and no setup needed. |

### Edge cases handled
- Duplicate or near-duplicate reports merge into one group instead of creating new ones.
- The primary department does not finish, so the secondary stays pending and the officer is escalated.
- Overlapping or conflicting schedules at the same location are detected and flagged.
- Reports with missing or invalid location or photo are rejected with a clear message.
- A deadline change without a reason is blocked.
- Reports spanning departments with no defined order fall back to the severity order.

---

## 5. Tech Stack

> Update this section to match what you actually build.

| Layer | Choice |
|---|---|
| Frontend | React + Vite, Tailwind CSS |
| Maps | Leaflet with OpenStreetMap tiles |
| Backend | Node.js + Express (REST API) |
| Database | PostgreSQL (Supabase) |
| Auth | Supabase Auth (role-based) |
| File storage | Supabase Storage (issue photos) |
| Hosting | Frontend on Vercel, backend on Render |

### Open-source libraries and APIs used (disclosure)

> The rules require every open-source library and API to be disclosed. Keep this list in sync with `package.json`.

| Library / API | Purpose | License |
|---|---|---|
| React | UI | MIT |
| Vite | Build tool | MIT |
| Tailwind CSS | Styling | MIT |
| Leaflet / react-leaflet | Interactive maps | BSD-2 / Hippocratic |
| OpenStreetMap tiles | Map data | ODbL |
| Express | API server | MIT |
| Supabase JS client | Database, auth, storage | MIT |
| Recharts | Charts | MIT |
| `<add others>` | | |

---

## 6. Data Note

All data in the demo (projects, budgets, contractors, departments and citizen reports) is **simulated** for the hackathon. No real municipal systems are integrated. Seed data is in [`/data/seed`](./data/seed).

---

## 7. Setup Instructions

### Prerequisites
- Node.js 18+
- npm 9+
- A Supabase project (free tier), or run the included local database

### 1. Clone
```bash
git clone <REPO_URL>
cd <REPO_NAME>
```

### 2. Environment variables
Copy the example file and fill in values:
```bash
cp .env.example .env
```
```env
# Backend
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
PORT=5000

# Frontend
VITE_API_URL=http://localhost:5000
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

### 3. Install dependencies
```bash
# backend
cd server && npm install

# frontend
cd ../client && npm install
```

### 4. Create the database and load demo data
```bash
cd server
npm run db:migrate   # creates tables
npm run db:seed      # loads departments, contractors, projects, reports
```

### 5. Run
```bash
# terminal 1
cd server && npm run dev

# terminal 2
cd client && npm run dev
```
Open **http://localhost:5173**.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Citizen | `citizen@demo.com` | `demo1234` |
| Sewage Dept officer | `sewage@demo.com` | `demo1234` |
| Roads Dept officer | `roads@demo.com` | `demo1234` |
| Admin | `admin@demo.com` | `demo1234` |

### Run tests
```bash
cd server && npm test
```

---

## 8. Feasibility and Future Scope

**Practical in the real world**
- Runs on commodity web infrastructure and works on any phone browser.
- Rule-based grouping and sequencing need no heavy ML, so they are fast, explainable and auditable.
- Rollout path: pilot in one ward, then one city, then integrate with municipal systems.

**Scalability and reliability**
- Spatial indexing for location queries.
- Stateless API, so it can scale horizontally.
- Background jobs for alerts and escalation timers.

**Future work**
- Integration with real municipal work-order and GIS systems.
- Contractor ratings and a public blacklist for repeat offenders.
- ML-based severity and sentiment detection from photos and text.
- SMS, WhatsApp and regional-language alerts.
- Offline-capable reporting for low-connectivity areas.
- Native mobile app.

---

## 9. Repository Structure

```
├── client/          # React frontend (citizen + department views)
├── server/          # Express API, grouping / severity / sequencing engines
├── data/seed/       # Simulated demo data
├── demo/demo.mp4    # 2–5 minute demo video
├── .env.example
└── README.md
```

---

## 10. Hackathon Compliance Checklist

- [x] Built for one problem statement: **CivicTech**
- [x] README covers problem statement, solution and setup instructions
- [x] Open-source libraries and APIs disclosed
- [x] Simulated data used (permitted by the rules)
- [ ] Demo video (2–5 min) added to the repository in `/demo`
- [ ] Web app hosted and publicly accessible (link at top)
- [ ] Submitted by the **team leader only** via the Google Form before **9:00 PM, 10 Oct 2026**

---

## 11. License and Ownership

The team retains ownership of this project. Organizers may request permission to feature it in promotional materials.

License: MIT (see `LICENSE`).
