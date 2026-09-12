require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const P = require('pino');
const config = require('./config');

const logger = P({ level: 'silent' });
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Root page - serves the login page (index.html) directly
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let sock;
let currentQR = null;
let isConnected = false;
let socketReady = false; // becomes true once the WebSocket connection is actually open

async function startBot() {
  socketReady = false;
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: state,
    // Windows Chrome is most reliable for pairing codes
    // (Android is not a valid Browsers method in Baileys)
    browser: Browsers.windows('Chrome'),
    // Disable history sync to avoid stale session data
    syncFullHistory: false,
    // Mark device as mobile app
    markOnlineOnConnect: true,
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    socketReady = true; // the WebSocket has responded, so it's safe to request a pairing code now

    if (qr) {
      currentQR = qr;
    }

    if (connection === 'close') {
      isConnected = false;
      socketReady = false;
      currentQR = null;
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('❌ Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    } else if (connection === 'open') {
      isConnected = true;
      currentQR = null;
      console.log(`✅ ${config.BOT_NAME} connected successfully!`);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Message handling logic
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
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

    if (!isCmd) return;

    try {
      switch (command) {
        case 'ping': {
          const start = Date.now();
          await sock.sendMessage(from, { text: '🏓 Pong!' }, { quoted: msg });
          const end = Date.now();
          await sock.sendMessage(from, { text: `⚡ Speed: ${end - start}ms` });
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
          await sock.sendMessage(from, { text: menuText }, { quoted: msg });
          break;
        }

        case 'alive': {
          await sock.sendMessage(
            from,
            { text: `✅ *${config.BOT_NAME}* is online and active!` },
            { quoted: msg }
          );
          break;
        }

        case 'owner': {
          await sock.sendMessage(
            from,
            { text: `👤 Owner number: wa.me/${config.OWNER_NUMBER}` },
            { quoted: msg }
          );
          break;
        }

        default: {
          await sock.sendMessage(
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
}

// A leftover half-registered session file is the most common cause of
// WhatsApp rejecting a pairing code as "incorrect" - wipe it and start a
// completely clean socket right before generating a new code.
async function resetSessionAndRestart() {
  try {
    if (sock) {
      sock.ev.removeAllListeners();
      try {
        sock.end(undefined);
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {
    // ignore
  }
  try {
    fs.rmSync(path.join(__dirname, 'session'), { recursive: true, force: true });
  } catch (e) {
    console.error('Could not clear old session:', e?.message || e);
  }
  await startBot();
}

// ---------------- Web login page API routes ----------------

// Current connection status
app.get('/api/status', (req, res) => {
  res.json({ connected: isConnected, botName: config.BOT_NAME });
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

    // Wait for the WebSocket connection to actually be open before requesting a code
    let waited = 0;
    while (!socketReady && waited < 15000) {
      await new Promise((r) => setTimeout(r, 300));
      waited += 300;
    }
    if (!socketReady) {
      return res.status(400).json({ error: 'Connection not ready yet, please try again' });
    }

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

app.listen(PORT, () => {
  console.log(`🌐 ${config.BOT_NAME} login page is live at: http://localhost:${PORT}`);
});

startBot();
