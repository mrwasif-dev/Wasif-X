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
    printQRInTerminal: false, // QR is shown on the web page instead of the terminal
    auth: state,
    // Ubuntu/Chrome is the fingerprint that reliably completes pairing-code
    // linking with WhatsApp (some other fingerprints will generate a code
    // that WhatsApp then rejects as "incorrect")
    browser: Browsers.ubuntu('Chrome'),
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
    const cleanNumber = number.replace(/[^0-9]/g, '');
    if (cleanNumber.length < 8) {
      return res.status(400).json({ error: 'Enter a valid number with country code' });
    }

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
        const code = await sock.requestPairingCode(cleanNumber);
        return res.json({ code });
      } catch (err) {
        lastError = err;
        console.error(`Pairing code attempt ${attempt} failed:`, err?.message || err);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw lastError;
  } catch (e) {
    console.error('Pairing code error:', e);
    res.status(500).json({ error: 'Could not get pairing code. Make sure the number includes the country code (no + or 0), then try again.' });
  }
});

app.listen(PORT, () => {
  console.log(`🌐 ${config.BOT_NAME} login page is live at: http://localhost:${PORT}`);
});

startBot();
