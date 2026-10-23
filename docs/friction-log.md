# Hisaab — Friction Log

Every problem anyone hits, with the fix. Post problems in team chat; Dharmik copies them here.

| Time (IST) | Who | Problem | Fix |
| --- | --- | --- | --- |
| Thu 22 Oct 22:45 | Dharmik | Guide says Fri 06:00 for `scripts/seed.js`, but `seed.json` is the real dependency for everyone | Wrote `scripts/seed.js` together with `seed.json` on Thu night so it is ready early |
| Fri 23 Oct 12:15 | MBS | Chrome showed a half-styled page after CSS changes (cached old `style.css`); VS Code's browser looked different | Server now sends `Cache-Control: no-store` for page files, so every browser always loads the latest version |
| Fri 23 Oct 12:20 | MBS | Seed data missing locally: tomato showed "first time", Shanti unknown | `npm run seed` with Dharmik's `seed.json` before testing |
| Fri 23 Oct 12:20 | MBS | Price card squashed to a sliver in the chat | Chat items no longer shrink (`flex-shrink: 0`); the chat scrolls instead |
| Fri 23 Oct 12:25 | MBS | The mic heard Hisaab's own spoken reply and sent it as a user message (echo) | Mic is closed while Hisaab speaks and reopens after the reply ends |
| Fri 23 Oct 12:35 | MBS | Wanted Alexa-style hands-free use | Wake phrase "Hey San": the page listens only for it, then takes the command; after a question the mic stays open briefly for the answer |
| Fri 23 Oct 12:50 | Team | Decided to ship English only for now (Hindi/Tamil on the roadmap) | Removed Hindi/Tamil words, templates and tests; demo data names in English |
| Fri 23 Oct 12:55 | MBS | Chrome often writes a short "San" as "sun", "son", "Sam" or "Hasan" | Wake matcher accepts sound-alikes, checks Chrome's top 5 guesses, and shows what it heard |
| Fri 23 Oct 13:05 | MBS | Voice switched between Indian and US accents | Gemini's free voice quota allows only a few replies a day; now one free Indian-accent browser voice speaks everything (numbers turned into English words first) |
| Fri 23 Oct 13:05 | MBS | Open questions failed after a few tries: `gemini-3.8-flash` free tier is ~20 requests/day | Use `gemini-3.8-flash-lite` (~500/day) first, fall back to Flash on HTTP 429 |
| Fri 23 Oct 13:20 | MBS | Wake word stopped working after a while (Chrome refused a mic restart; the page gave up) | Retries with back-off plus a 2 s watchdog that restarts listening whenever it should be on |
| Fri 23 Oct 13:30 | MBS | "absent on 10th of October" was logged for today; "add a cook called Dharmik" not understood | Page no longer overwrites the date you said; parser handles everyday phrasing and dates, with sensible defaults |
| Fri 23 Oct 14:15 | MBS | Saying an absence twice cut two days' pay; Undo removed the wrong entry; date showed 31 Oct | One absence per helper per day; Undo removes that exact line; "today" is the real date (demo date optional) |
