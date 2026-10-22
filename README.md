# Hisaab

Hisaab is an Alexa+ add-on that keeps your home's money memory by voice, in English, Hindi, Tamil, Hinglish or Tanglish.
It remembers who came and who didn't, and who is overcharging you at the sabzi market.

**Demo video:** _add YouTube link here_

## Features

- **Helpers ledger:** log the maid, cook, doodhwala and newspaper as it happens ("Shanti didi aaj nahi aayi", "Doodhwala ne aadha litre extra diya"). At month-end ask "Kisko kitna dena hai?" and get a bill card per helper plus a ready WhatsApp message.
- **Sabzi price memory:** log purchases ("Tomato 40 rupay kilo, corner wale bhaiya se"). Hisaab learns normal prices per item and vendor and warns you when something costs too much.
- **Memory across sessions:** everything is stored in `data/data.json`, so numbers survive a server restart.
- **Real MCP:** the web page is a real MCP client calling 8 tools over Streamable HTTP, and the MCP panel shows every request and response live.

## Languages supported

English (including Hinglish and Tanglish), Hindi and Tamil. No model training is needed: Gemini reads these languages, the browser speech API takes `en-IN` / `hi-IN` / `ta-IN`, and spoken replies come from fixed templates.

## Setup

You need **Node 20 or newer** (`node -v` must print v20+) and **Chrome** (or Edge) for the microphone.

```bash
git clone <repo-url>
cd hisaab
npm install
cp .env.example .env      # then fill in the values (see below)
npm run seed              # loads the demo data
npm start
```

Open http://localhost:3000 in Chrome. Always use `http://localhost:3000`, not `file://`.

`.env` contents:

```
GEMINI_API_KEY=your_key_from_aistudio.google.com
GEMINI_MODEL=a current Flash model name from AI Studio
PORT=3000
```

`npm run seed` resets the demo at any time (October 2026 data; use 31 Oct 2026 as the demo date on the page). Without a Gemini key the app still works through the regex fallback for the common sentences.

## Getting a free Gemini key

1. Go to https://aistudio.google.com and sign in with a Google account.
2. Choose **Get API key** and create a key.
3. Paste it into `.env` as `GEMINI_API_KEY`, and set `GEMINI_MODEL` to a current Flash model name shown in AI Studio.

The key stays on the server in `.env`. It is never sent to the browser and never committed.

## Architecture

![Hisaab architecture](docs/architecture.png)

One Node process on one port serves both the web page and the MCP server. Gemini is used only by `understand`, so an outage never breaks bills or price alerts. All money math is plain code.

```
Browser page                        Express server, one port
 mic / typed input   -- JSON-RPC -->  /mcp : 8 MCP tools (stateless)
 MCP client (fetch)  <--------------    |- understand.js --> Gemini API
 cards + MCP panel                      |- bill.js + prices.js
 speaks the say line                    `- store.js --> data/data.json
                                     /  : serves public/
```

## MCP tools

Every tool also accepts an optional `lang` (`en`, `hi` or `ta`) and returns a `say` line in that language.

| Tool | Input | Output |
| --- | --- | --- |
| `understand` | `text`, `date?`, `lang?` | `{ intent, args, source, say? }` |
| `add_helper` | `name, role, rateType, rate, unit?, paidLeaves?, defaultQtyPerDay?` | `{ helper, say }` |
| `log_helper_event` | `helper`, `type`, `qty?`, `amount?`, `date?`, `raw` | `{ event, helperName, say }` |
| `get_bill` | `helper?`, `month` (`YYYY-MM`) | `{ bills, say }` |
| `month_summary` | `month` | `{ bills, total, whatsapp, say }` |
| `log_purchase` | `item, vendor, price, unit, qty?, date?, raw` | `{ purchase, alert, say }` |
| `price_check` | `item`, `vendor?` | `{ item, avg, min, max, cheapestVendor, lastPrices, say }` |
| `undo_last` | none | `{ removed, say }` |

## Testing with MCP Inspector

With the server running:

```bash
npx @modelcontextprotocol/inspector
```

Choose transport **Streamable HTTP** and URL `http://localhost:3000/mcp`, then connect and try `tools/list`.

Unit tests for bills and prices: `npm test`.

## License

MIT, see [LICENSE](LICENSE).

## Team

Dharmik, Ritu, Tanish and MBS, built for the Build, Ship, Shape: Amazon Developer Hackathon (Alexa+ track).

Problems we hit while building, with fixes: [docs/friction-log.md](docs/friction-log.md).
