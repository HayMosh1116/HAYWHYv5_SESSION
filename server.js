'use strict';

const express = require('express');
const crypto = require('crypto');
const pino = require('pino');
const QRCode = require('qrcode');
const baileys = require('prince-baileys');
const {
  default: makeWASocket,
  Browsers,
  delay,
  makeCacheableSignalKeyStore,
  jidNormalizedUser
} = baileys;
const { getMongoClient, getWhatsAppAuthCollection, closeMongoClient } = require('./lib/mongo-client');
const { useMongoAuthState } = require('./lib/mongo-auth-state');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const sessions = new Map();
const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });
const MAX_ACTIVE_SESSIONS = Number(process.env.MAX_ACTIVE_SESSIONS || 5);
const REQUEST_WINDOW_MS = 2 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 10;
const requestsByIp = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

function rateLimit(req, res, next) {
  const now = Date.now();
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const previous = requestsByIp.get(ip);
  if (previous && now - previous.startedAt < REQUEST_WINDOW_MS && previous.count >= MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ error: 'Too many pairing attempts. Try again in 10 minutes.' });
  }
  if (!previous || now - previous.startedAt >= REQUEST_WINDOW_MS) requestsByIp.set(ip, { startedAt: now, count: 1 });
  else previous.count += 1;
  next();
}

function publicStatus(session) {
  return {
    sessionId: session.id,
    status: session.status,
    mode: session.mode,
    qr: session.status === 'waiting_qr' ? session.qr : undefined,
    pairingCode: session.pairingCode || undefined,
    message: session.message
  };
}

async function startSession(mode, phoneNumber) {
  for (const [id, old] of sessions) {
    if (old.closed && sessions.size > 100) sessions.delete(id);
  }
  const activeCount = [...sessions.values()].filter(item => !item.closed).length;
  if (activeCount >= MAX_ACTIVE_SESSIONS) throw new Error('The session service is busy. Try again shortly.');
  const sessionId = crypto.randomBytes(24).toString('hex');
  const session = {
    id: sessionId, mode, status: 'starting', qr: null, pairingCode: null,
    message: 'Starting a secure WhatsApp connection.', socket: null, closed: false
  };
  sessions.set(sessionId, session);
  session.timeout = setTimeout(async () => {
    if (!session.closed) {
      session.status = 'expired';
      session.message = 'Setup expired. Start a new pairing or QR session.';
      await closeSession(session);
    }
  }, 5 * 60 * 1000);

  try {
    const collection = await getWhatsAppAuthCollection();
    const { state, saveCreds } = await useMongoAuthState({
      collection, sessionId, baileys
    });
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      logger,
      browser: Browsers.macOS('Safari'),
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000
    });
    session.socket = sock;

    sock.ev.on('creds.update', update => {
      saveCreds(update).catch(error => {
        session.status = 'error';
        session.message = 'Could not save WhatsApp credentials to MongoDB.';
        console.error('[AUTH SAVE]', error.message);
      });
    });

    sock.ev.on('connection.update', async update => {
      if (update.qr && mode === 'qr' && !session.closed) {
        try {
          session.qr = await QRCode.toDataURL(update.qr);
          session.status = 'waiting_qr';
          session.message = 'Scan this QR code with WhatsApp Linked Devices.';
        } catch (error) {
          session.status = 'error';
          session.message = 'Could not render the QR code.';
        }
      }

      if (update.connection === 'open' && !session.closed) {
        session.status = 'connected';
        session.message = 'WhatsApp connected. Saving the full authentication state.';
        try {
          await saveCreds();
          await delay(1200);
          const ownJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
          if (ownJid) {
            await sock.sendMessage(ownJid, {
              text: [
                '*HAYWHY MDX v5 — SESSION LINKED*',
                '',
                'Your full WhatsApp authentication state is saved securely in MongoDB.',
                '',
                '*Set this value in your bot host environment:*',
                `WHATSAPP_SESSION_ID=${sessionId}`,
                '',
                'Use the exact value above. Keep it private.'
              ].join('\n')
            });
          }
          session.status = 'saved';
          session.message = 'Authentication saved. The session ID was sent to your WhatsApp account.';
        } catch (error) {
          session.status = 'error';
          session.message = 'WhatsApp connected, but final save/notification failed. Check service logs.';
          console.error('[SESSION FINALIZE]', error.message);
        } finally {
          await closeSession(session);
        }
      }

      if (update.connection === 'close' && !session.closed && session.status !== 'saved') {
        session.status = 'disconnected';
        session.message = 'WhatsApp connection closed before setup finished. Start again.';
        await closeSession(session);
      }
    });

    if (mode === 'pairing') {
      if (!/^\d{8,15}$/.test(phoneNumber || '')) {
        await closeSession(session);
        throw new Error('Enter a valid phone number with country code, digits only.');
      }
      await delay(1200);
      const code = await sock.requestPairingCode(phoneNumber);
      session.pairingCode = String(code).match(/.{1,4}/g)?.join('-') || String(code);
      session.status = 'waiting_pairing';
      session.message = 'Enter this code in WhatsApp Linked Devices.';
    }
    return session;
  } catch (error) {
    session.status = 'error';
    session.message = error.message || 'Could not start the WhatsApp session.';
    await closeSession(session);
    sessions.delete(sessionId);
    throw error;
  }
}

async function closeSession(session) {
  if (!session || session.closed) return;
  session.closed = true;
  try { session.socket?.end(undefined); } catch (_) {}
  session.socket = null;
  if (session.timeout) clearTimeout(session.timeout);
}

app.get('/health', async (_req, res) => {
  try {
    const client = await getMongoClient();
    const dbName = String(process.env.MONGODB_DB || 'haywhy_mdx').trim();
    await client.db(dbName).command({ ping: 1 });
    return res.status(200).json({
      ok: true,
      service: 'HAYWHY MDX v5 session service',
      database: 'connected'
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      service: 'HAYWHY MDX v5 session service',
      database: 'unavailable'
    });
  }
});

app.post('/api/pair', rateLimit, async (req, res) => {
  try {
    const number = String(req.body?.number || '').replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(number)) {
      return res.status(400).json({ error: 'Send a valid phone number with country code.' });
    }
    const session = await startSession('pairing', number);
    return res.status(200).json(publicStatus(session));
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Pairing service unavailable.' });
  }
});

app.post('/api/qr', rateLimit, async (_req, res) => {
  try {
    const session = await startSession('qr', '');
    return res.status(200).json(publicStatus(session));
  } catch (error) {
    return res.status(503).json({ error: error.message || 'QR service unavailable.' });
  }
});

app.get('/api/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found or expired.' });
  return res.json(publicStatus(session));
});

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HAYWHY MDX v5 Session</title>
<style>
body{margin:0;background:#090909;color:#f4f4f4;font:16px Arial,sans-serif;display:grid;place-items:center;min-height:100vh;padding:20px;box-sizing:border-box}
main{width:min(100%,440px);background:#151515;border:1px solid #333;border-radius:18px;padding:24px;box-sizing:border-box}
h1{margin-top:0}p{color:#bbb;line-height:1.5}label{display:block;margin:18px 0 8px}
input,button{width:100%;box-sizing:border-box;padding:14px;border-radius:10px;border:1px solid #555;font-size:16px}
input{background:#090909;color:white}button{margin-top:12px;background:#7b4acb;color:white;border:0;font-weight:bold}
#result{margin-top:18px;overflow-wrap:anywhere}#qr{display:block;width:min(100%,280px);margin:16px auto;background:white;padding:8px;border-radius:12px}
code{color:#c8a7ff}
</style></head><body><main><h1>HAYWHY MDX v5</h1>
<label for="number">WhatsApp number with country code</label><input id="number" inputmode="numeric" placeholder="2348012345678">
<button id="pair">Get pairing code</button><button id="qrbtn">Use QR code</button><div id="result" aria-live="polite"></div><img id="qr" hidden alt="WhatsApp QR code">
<script>
const result=document.getElementById('result'), qr=document.getElementById('qr');
let poller;
async function begin(path,body){clearInterval(poller);result.textContent='Starting secure connection…';qr.hidden=true;
try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not start');show(d);if(d.sessionId)poller=setInterval(async()=>{try{const x=await fetch('/api/sessions/'+encodeURIComponent(d.sessionId));if(!x.ok)return;show(await x.json())}catch(e){}},2000)}
catch(e){result.textContent=e.message}}
function show(d){const code=d.pairingCode?'\n\nPAIRING CODE: '+d.pairingCode:'';result.textContent=(d.message||d.status||'')+code;if(d.qr){qr.src=d.qr;qr.hidden=false}}
document.getElementById('pair').onclick=()=>begin('/api/pair',{number:document.getElementById('number').value});
document.getElementById('qrbtn').onclick=()=>begin('/api/qr',{});
</script></main></body></html>`);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`HAYWHY MDX v5 session service listening on ${PORT}`);
});

async function shutdown() {
  server.close();
  for (const session of sessions.values()) await closeSession(session);
  try { await closeMongoClient(); } catch (error) { console.error('[MONGODB CLOSE]', error.message); }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
