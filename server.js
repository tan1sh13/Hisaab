import 'dotenv/config';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './src/mcp.js';
import { ttsRoute } from './src/tts.js';

const app = express();
app.use(express.json());
// no-store: browsers always fetch the latest page files (no stale CSS while we edit).
app.use(express.static('public', { etag: false, lastModified: false, setHeaders: (res) => res.set('Cache-Control', 'no-store') }));

// Hisaab's spoken voice (Gemini TTS, free tier). The page falls back to the browser voice on any error.
app.post('/tts', ttsRoute);

// Stateless MCP: a fresh server + transport for every request.
app.post('/mcp', async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true       // plain JSON, no SSE
    });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  }
});

// Stateless server: no GET stream, no session to DELETE.
const notAllowed = (_req, res) =>
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
app.get('/mcp', notAllowed);
app.delete('/mcp', notAllowed);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Hisaab on http://localhost:${port}`));
