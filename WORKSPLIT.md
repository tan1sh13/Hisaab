# Hisaab — Work Split (whole team)

> **Rule of precedence:** if this work split and `Hisaab-Team-Plan-and-Build-Guide.md` (the Complete Guidance) disagree, **follow the Complete Guidance**. Not covered anywhere → ask in chat; Tanish decides within 10 minutes.

Load: Tanish ~30% · Ritu ~30% · MBS ~30% · Dharmik ~10% (lighter, non-blocking).
Personal files: `worksplit-tanish.md`, `worksplit-ritu.md`, `worksplit-mbs.md`, `worksplit-dharmik.md`.

## Language decision

We support **English (+Hinglish/Tanglish), Hindi and Tamil**. **No model training is needed**: Gemini already understands these languages, the browser's speech API just needs a language code (`en-IN` / `hi-IN` / `ta-IN`), and spoken replies come from fixed templates. Language work is owned by **Tanish** (guide section 7). To keep loads equal, the architecture diagram export moved from Tanish to Dharmik.

## Who owns what

| Person | Role | Owns these files | Load |
| --- | --- | --- | --- |
| Tanish | Backend / MCP server + languages | `server.js`, `src/mcp.js`, `src/store.js`, `src/lang.js`, `package.json`, `.gitignore` | ~30% |
| Ritu | AI + logic | `src/llm.js`, `src/understand.js`, `src/bill.js`, `src/prices.js`, `src/messages.js`, `src/dates.js`, `tests/` | ~30% |
| MBS | Frontend + video | `public/index.html`, `public/app.js`, `public/mcp-client.js`, `public/style.css` | ~30% |
| Dharmik | Demo data, docs, QA | `data/seed.json`, `scripts/seed.js`, `README.md`, `LICENSE`, `.env.example`, `docs/` | ~10% |

## Task list

### Tanish
- [ ] Repo + skeleton pushed — **Thu 16:00**
- [ ] Stateless `/mcp` + "hello" tool in MCP Inspector — **Thu 17:30**
- [ ] `store.js` safe load/save
- [ ] All 8 tools registered with zod, each accepting `lang` — **Thu 23:30**
- [ ] `lang.js`: number words + local words (en/hi/ta) — **Thu 23:30**
- [ ] `lang.js`: `SAY` templates for every message in en/hi/ta — **Fri 10:00**
- [ ] 16 Hindi + Tamil sentences tested end to end (≥ 13 pass) — **Fri 12:00**
- [ ] `undo_last`, error handling, bug fixes
- [ ] Record "under the hood" part of video; submit on Devpost

### Ritu
- [ ] Gemini key + `askLLM` working — **Thu 19:00**
- [ ] `understand` prompt + validation + regex fallback (uses `lang.js` hints) — **Thu 23:30**
- [ ] `bill.js` + `prices.js` + tests (6 bill, 4 price) — **Thu 23:30**
- [ ] `messages.js` (WhatsApp text via `lang.js`), `dates.js` — **Fri 10:00**
- [ ] All 20 English/Hinglish test sentences pass — **Fri 12:00**
- [ ] Devpost description + product feedback — **Fri 16:00**

### MBS
- [ ] mic → text → spoken reply on a blank page — **Thu 19:00**
- [ ] `mcp-client.js` (initialize, tools/list, tools/call) + mock mode — **Thu 19:00**
- [ ] Page wired to real `/mcp`, event + price alert cards, MCP panel — **Thu 23:30**
- [ ] Bill + month summary cards, language picker, demo date picker — **Fri 12:00**
- [ ] Rehearse demo 3× — **Fri 16:00**
- [ ] Record, edit, upload video (< 3 min, public) — **Fri 19:00**

### Dharmik (lighter)
- [ ] Node 20+, clone, run once — **Thu 19:00**
- [ ] `LICENSE` (MIT), `.env.example`, start `docs/friction-log.md` — **Thu 19:00**
- [ ] `data/seed.json` + `scripts/seed.js` (`npm run seed`) — **Fri 10:00**
- [ ] `README.md` + `docs/architecture.png` — **Fri 14:00**
- [ ] Act in the video skit — **Fri 16:00–19:00**
- [ ] Submission checklist — **Fri 19:00 and 23:30**

## Hand-offs (who waits on whom)

| Needs | From | By |
| --- | --- | --- |
| Repo skeleton | Tanish → everyone | Thu 16:00 |
| `lang.js` HINTS (for the prompt) | Tanish → Ritu | Thu 21:00 |
| Real `/mcp` with tools | Tanish → MBS | Thu 23:00 |
| `bill.js`, `prices.js` functions | Ritu → Tanish | Thu 23:00 |
| `SAY` templates | Tanish → Ritu (`messages.js`), MBS (cards) | Fri 10:00 |
| Seed data | Dharmik → everyone | Fri 10:00 |
| Working app for recording | All → MBS | Fri 16:00 |

Blocked more than 30 minutes? Say so in chat immediately.
