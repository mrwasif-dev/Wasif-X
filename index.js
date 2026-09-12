require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const P = require('pino');
const config = require('./config');
const db = require('./db');

const logger = P({ level: 'silent' });
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SESSION_ID = process.env.SESSION_ID || 'default-session';

// Root page - serves the login page (index.html) directly
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let sock;
let currentQR = null;
let isConnected = false;
let socketReady = false;
let connectionState = 'starting';
let reconnectTimer = null;
let reconnectAttempts = 0;
let startInProgress = false;
let intentionalRestart = false;
let botStartedAt = Date.now();

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function stopSocket() {
  const oldSock = sock;
  sock = null;
  socketReady = false;
  if (!oldSock) return;
  try { oldSock.ev.removeAllListeners(); } catch (_) {}
  try { oldSock.end(undefined); } catch (_) {}
}

function scheduleReconnect(reason = 'connection closed') {
  if (intentionalRestart || reconnectTimer || connectionState === 'logged_out') return;
  reconnectAttempts += 1;
  const delay = Math.min(30000, 2000 * Math.pow(2, Math.min(reconnectAttempts - 1, 4)));
  connectionState = 'reconnecting';
  console.log(`🔄 Reconnect scheduled in ${delay}ms (${reason})`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await startBot();
    } catch (err) {
      console.error('❌ Reconnect failed:', err?.stack || err);
      scheduleReconnect('reconnect attempt failed');
    }
  }, delay);
}

async function startBot() {
  if (startInProgress) return;
  startInProgress = true;
  socketReady = false;
  connectionState = 'connecting';

  try {
    if (db.getConnectionState && db.getConnectionState() !== 'connected') {
      connectionState = 'database_error';
      scheduleReconnect('MongoDB is not connected');
      return;
    }

    const { useMongoAuthState } = require('./auth-state-db');
    const authState = await useMongoAuthState(SESSION_ID);
    const { saveCreds } = authState;
    const { version } = await fetchLatestBaileysVersion();

    const newSock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      auth: authState.state,
      browser: Browsers.windows('Chrome'),
      syncFullHistory: false,
      markOnlineOnConnect: true,
    });
    sock = newSock;

    newSock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Baileys emits updates before the socket reaches `open`. Pairing code
      // must be requested during this phase, so readiness means socket exists.
      socketReady = true;

      if (qr) currentQR = qr;

      if (connection === 'close') {
        if (sock !== newSock) return;
        isConnected = false;
        socketReady = false;
        currentQR = null;
        connectionState = 'disconnected';
        db.updateConnectionStatus(SESSION_ID, false).catch(() => {});

        const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.data?.statusCode || lastDisconnect?.error?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          connectionState = 'logged_out';
          reconnectAttempts = 0;
          console.log('🚪 WhatsApp session logged out. Clearing invalid auth state.');
          // A 401/logged-out session can never reconnect with the same Signal
          // credentials. Remove it so the next start exposes a clean pairing
          // state instead of looping forever with rejected credentials.
          db.deleteSession(SESSION_ID).catch(() => {});
        } else if (!intentionalRestart) {
          console.log(`❌ Connection closed (code ${statusCode || 'unknown'}).`);
          scheduleReconnect('WhatsApp connection closed');
        }
      } else if (connection === 'open') {
        if (sock !== newSock) return;
        isConnected = true;
        connectionState = 'connected';
        reconnectAttempts = 0;
        currentQR = null;
        const jid = newSock?.user?.id;
        if (jid) db.updateConnectionStatus(SESSION_ID, true, jid).catch(() => {});
        console.log(`✅ ${config.BOT_NAME} connected successfully!`);
      } else if (connection === 'connecting') {
        connectionState = 'connecting';
      }
    });

    newSock.ev.on('creds.update', saveCreds);
  // Message handling logic
  newSock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg) return;
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      '';

    if (!body) return;

    const isCmd = body.startsWith(config.PREFIX);
    const command = isCmd
      ? body.slice(config.PREFIX.length).trim().split(/ +/)[0].toLowerCase()
      : '';

    console.log(`📩 Message received [${from}]: ${body}`);

    // Log message to MongoDB
    db.logMessage(SESSION_ID, from, body, isCmd, isCmd ? command : null);

    if (!isCmd) return;

    try {
      switch (command) {
        case 'ping': {
          const start = Date.now();
          await newSock.sendMessage(from, { text: '🏓 Pong!' }, { quoted: msg });
          const end = Date.now();
          await newSock.sendMessage(from, { text: `⚡ Speed: ${end - start}ms` });
          break;
        }

        case 'menu':
        case 'help': {
          const menuText = `╭───「 *${config.BOT_NAME}* 」
│
│ ${config.PREFIX}ping   - Check bot speed
│ ${config.PREFIX}menu   - Show this menu
│ ${config.PREFIX}alive  - Check if the bot is online
│ ${config.PREFIX}owner  - Get owner info
│
╰────────────────`;
          await newSock.sendMessage(from, { text: menuText }, { quoted: msg });
          break;
        }

        case 'alive': {
          await newSock.sendMessage(
            from,
            { text: `✅ *${config.BOT_NAME}* is online and active!` },
            { quoted: msg }
          );
          break;
        }

        case 'owner': {
          await newSock.sendMessage(
            from,
            { text: `👤 Owner number: wa.me/${config.OWNER_NUMBER}` },
            { quoted: msg }
          );
          break;
        }

        default: {
          await newSock.sendMessage(
            from,
            { text: `❓ Unknown command. Type *${config.PREFIX}menu* to see the list.` },
            { quoted: msg }
          );
        }
      }
    } catch (err) {
      console.error('Error running command:', err);
    }
  });
  } catch (err) {
    isConnected = false;
    socketReady = false;
    connectionState = 'error';
    console.error('❌ Bot startup error:', err?.stack || err);
    scheduleReconnect('bot startup error');
  } finally {
    startInProgress = false;
  }
}

// A leftover half-registered session file is the most common cause of
// WhatsApp rejecting a pairing code as "incorrect" - wipe it and start a
// completely clean socket right before generating a new code.
async function resetSessionAndRestart() {
  intentionalRestart = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  try {
    await stopSocket();
  } catch (_) {}

  try {
    fs.rmSync(path.join(__dirname, 'session'), { recursive: true, force: true });
  } catch (_) {}

  await db.deleteSession(SESSION_ID);
  currentQR = null;
  isConnected = false;
  connectionState = 'connecting';

  intentionalRestart = false;
  await startBot();
}

// ---------------- Web login page API routes ----------------

// Current connection status
app.get('/api/status', async (req, res) => {
  try {
    const settings = await db.getBotSettings(SESSION_ID);
    res.json({
      connected: isConnected,
      state: connectionState,
      botName: config.BOT_NAME,
      phoneNumber: settings?.phoneNumber || null,
      lastSync: settings?.lastSync || null,
      sessionId: SESSION_ID,
      reconnectAttempts,
      uptimeSeconds: Math.floor((Date.now() - botStartedAt) / 1000),
      mongodb: db.getConnectionState ? db.getConnectionState() : 'unknown',
    });
  } catch (err) {
    res.json({ connected: isConnected, botName: config.BOT_NAME });
  }
});

// Get QR code as an image
app.get('/api/qr', async (req, res) => {
  if (isConnected) return res.json({ connected: true, qr: null });
  if (!currentQR) return res.json({ connected: false, qr: null });
  try {
    const dataUrl = await QRCode.toDataURL(currentQR);
    res.json({ connected: false, qr: dataUrl });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Request a pairing code using a phone number
app.post('/api/pair', async (req, res) => {
  try {
    if (isConnected) {
      return res.status(400).json({ error: 'Bot is already connected' });
    }
    if (!sock) {
      return res.status(400).json({ error: 'Bot is not ready yet, please try again shortly' });
    }
    const { number } = req.body;
    if (!number) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    
    // Clean the number - remove all non-digits
    let cleanNumber = number.replace(/[^0-9]/g, '');
    
    // Remove leading 0 if present (e.g., 03001234567 -> 923001234567)
    if (cleanNumber.startsWith('0') && !cleanNumber.startsWith('00')) {
      cleanNumber = '92' + cleanNumber.substring(1);
    }
    
    // Validate the number
    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
      return res.status(400).json({ 
        error: 'Invalid number. Use format like 923001234567 (with country code, no +)' 
      });
    }
    
    console.log(`📱 Pairing code requested for: ${cleanNumber}`);

    // Always start from a clean, unregistered socket before requesting a
    // new pairing code - this avoids the "incorrect code" rejection caused
    // by a stale/half-linked session from a previous attempt
    await resetSessionAndRestart();

    // Pairing code is requested before the connection reaches `open`.
    // Only wait for the socket object itself to be available.
    let waited = 0;
    while (!sock && waited < 10000) {
      await wait(250);
      waited += 250;
    }
    if (!sock) return res.status(400).json({ error: 'Bot socket is not ready yet, please try again' });

    // Retry a couple of times - WhatsApp occasionally rejects the very first attempt
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`⏳ Pairing code attempt ${attempt}/3 for ${cleanNumber}...`);
        const result = await sock.requestPairingCode(cleanNumber);
        
        // Extract code from various possible response formats
        let code;
        if (typeof result === 'string') {
          code = result;
        } else if (result?.pairing_code) {
          code = result.pairing_code;
        } else if (result?.code) {
          code = result.code;
        } else {
          throw new Error('Invalid response format from WhatsApp');
        }
        
        if (!code || code.length < 4) {
          throw new Error('Received invalid code from WhatsApp');
        }
        
        console.log(`✅ Code generated successfully: ${code}`);
        return res.json({ code });
      } catch (err) {
        lastError = err;
        const errMsg = err?.message || String(err);
        console.error(`❌ Attempt ${attempt} failed:`, errMsg);
        if (attempt < 3) {
          console.log(`⏱️  Waiting 2 seconds before retry...`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
    
    console.error(`🚨 All 3 attempts failed. Last error:`, lastError?.message || lastError);
    throw lastError;
  } catch (e) {
    console.error('🔴 Pairing code error:', e?.message || e);
    const errorMsg = e?.message || String(e);
    let userMessage = 'Could not get pairing code.';
    let suggestion = 'Try these:';
    
    // Provide specific error guidance
    if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
      userMessage = 'WhatsApp rejected the request. Phone number may be incorrect.';
      suggestion = 'Tips: Use format 923001234567 (no + or 0 prefix). Double-check the number.';
    } else if (errorMsg.includes('timeout') || errorMsg.includes('ECONNREFUSED')) {
      userMessage = 'Connection error - WhatsApp servers not responding.';
      suggestion = 'Check your internet connection and try again in a moment.';
    } else if (errorMsg.includes('429') || errorMsg.includes('rate')) {
      userMessage = 'Too many requests. WhatsApp rate-limited us.';
      suggestion = 'Wait 1-2 minutes and try again.';
    } else if (errorMsg.includes('stale') || errorMsg.includes('session')) {
      userMessage = 'Session issue detected.';
      suggestion = 'Delete session/ folder and restart the app.';
    } else {
      suggestion = 'Make sure: 1) Number format is 923001234567 2) Internet is working 3) WhatsApp account exists';
    }
    
    res.status(500).json({ 
      error: userMessage,
      details: suggestion 
    });
  }
});

// Get bot settings
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await db.getBotSettings(SESSION_ID);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update bot settings
app.post('/api/settings', async (req, res) => {
  try {
    const settings = await db.updateBotSettings(SESSION_ID, req.body);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get message logs
app.get('/api/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const logs = await db.getMessageLogs(SESSION_ID, limit);
    res.json({ logs, total: logs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Database health check
app.get('/api/health', async (req, res) => {
  res.json({
    server: 'online',
    connected: isConnected,
    state: connectionState,
    session: SESSION_ID,
    uptimeSeconds: Math.floor((Date.now() - botStartedAt) / 1000),
    reconnectAttempts,
    mongodb: db.getConnectionState ? db.getConnectionState() : 'unknown',
  });
});

// Start server, then MongoDB, then WhatsApp.
app.listen(PORT, async () => {
  console.log(`🌐 ${config.BOT_NAME} login page is live on port ${PORT}`);
  const dbConnected = await db.connectDB();
  if (!dbConnected) {
    console.error('❌ MongoDB is unavailable. WhatsApp startup is paused.');
    connectionState = 'database_error';
    scheduleReconnect('MongoDB unavailable');
    return;
  }
  botStartedAt = Date.now();
  await startBot();
});

// Never let one rejected promise take down the whole bot process.
process.on('unhandledRejection', (err) => {
  console.error('🚨 Unhandled promise rejection:', err?.stack || err);
});

process.on('uncaughtException', (err) => {
  console.error('🚨 Uncaught exception:', err?.stack || err);
});

process.on('SIGTERM', async () => {
  try { if (reconnectTimer) clearTimeout(reconnectTimer); } catch (_) {}
  try { await stopSocket(); } catch (_) {}
  process.exit(0);
});

process.on('SIGINT', async () => {
  try { if (reconnectTimer) clearTimeout(reconnectTimer); } catch (_) {}
  try { await stopSocket(); } catch (_) {}
  process.exit(0);
});
