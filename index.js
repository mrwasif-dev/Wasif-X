require('dotenv').config();
const express = require('express');
const path = require('path');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const P = require('pino');
const config = require('./config');

const logger = P({ level: 'silent' });
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// روٹ پیج - لاگ ان پیج (index.html) براہِ راست دکھائیں
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let sock;
let currentQR = null;
let isConnected = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false, // QR اب ویب پیج پر دکھایا جائے گا، ٹرمینل میں نہیں
    auth: state,
    browser: [config.BOT_NAME, 'Chrome', '1.0.0'],
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
    }

    if (connection === 'close') {
      isConnected = false;
      currentQR = null;
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('❌ کنکشن بند ہو گیا۔ دوبارہ کوشش:', shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    } else if (connection === 'open') {
      isConnected = true;
      currentQR = null;
      console.log(`✅ ${config.BOT_NAME} کامیابی سے کنیکٹ ہو گیا ہے!`);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // پیغامات کا جواب دینے کی لاجک
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

    console.log(`📩 پیغام موصول ہوا [${from}]: ${body}`);

    if (!isCmd) return;

    try {
      switch (command) {
        case 'ping': {
          const start = Date.now();
          await sock.sendMessage(from, { text: '🏓 Pong!' }, { quoted: msg });
          const end = Date.now();
          await sock.sendMessage(from, { text: `⚡ سپیڈ: ${end - start}ms` });
          break;
        }

        case 'menu':
        case 'help': {
          const menuText = `╭───「 *${config.BOT_NAME}* 」
│
│ ${config.PREFIX}ping   - بوٹ کی سپیڈ چیک کریں
│ ${config.PREFIX}menu   - یہ مینو دیکھیں
│ ${config.PREFIX}alive  - چیک کریں بوٹ آن ہے یا نہیں
│ ${config.PREFIX}owner  - اونر کی معلومات
│
╰────────────────`;
          await sock.sendMessage(from, { text: menuText }, { quoted: msg });
          break;
        }

        case 'alive': {
          await sock.sendMessage(
            from,
            { text: `✅ *${config.BOT_NAME}* آن لائن اور فعال ہے!` },
            { quoted: msg }
          );
          break;
        }

        case 'owner': {
          await sock.sendMessage(
            from,
            { text: `👤 اونر نمبر: wa.me/${config.OWNER_NUMBER}` },
            { quoted: msg }
          );
          break;
        }

        default: {
          await sock.sendMessage(
            from,
            { text: `❓ نامعلوم کمانڈ۔ مینو دیکھنے کے لیے *${config.PREFIX}menu* لکھیں۔` },
            { quoted: msg }
          );
        }
      }
    } catch (err) {
      console.error('کمانڈ چلاتے وقت خرابی:', err);
    }
  });
}

// ---------------- ویب لاگ ان پیج کے API روٹس ----------------

// کنکشن کی موجودہ صورتحال
app.get('/api/status', (req, res) => {
  res.json({ connected: isConnected, botName: config.BOT_NAME });
});

// QR کوڈ (تصویر کی شکل میں) حاصل کرنا
app.get('/api/qr', async (req, res) => {
  if (isConnected) return res.json({ connected: true, qr: null });
  if (!currentQR) return res.json({ connected: false, qr: null });
  try {
    const dataUrl = await QRCode.toDataURL(currentQR);
    res.json({ connected: false, qr: dataUrl });
  } catch (e) {
    res.status(500).json({ error: 'QR بنانے میں خرابی ہوئی' });
  }
});

// فون نمبر سے Pairing Code حاصل کرنا
app.post('/api/pair', async (req, res) => {
  try {
    if (isConnected) {
      return res.status(400).json({ error: 'بوٹ پہلے سے کنیکٹ ہے' });
    }
    if (!sock) {
      return res.status(400).json({ error: 'بوٹ ابھی تیار نہیں، تھوڑی دیر بعد کوشش کریں' });
    }
    const { number } = req.body;
    if (!number) {
      return res.status(400).json({ error: 'نمبر درکار ہے' });
    }
    const cleanNumber = number.replace(/[^0-9]/g, '');
    if (cleanNumber.length < 8) {
      return res.status(400).json({ error: 'درست نمبر درج کریں (country code کے ساتھ)' });
    }
    const code = await sock.requestPairingCode(cleanNumber);
    res.json({ code });
  } catch (e) {
    console.error('Pairing کوڈ کی خرابی:', e);
    res.status(500).json({ error: 'کوڈ حاصل نہیں ہو سکا، دوبارہ کوشش کریں' });
  }
});

app.listen(PORT, () => {
  console.log(`🌐 ${config.BOT_NAME} لاگ ان پیج یہاں کھلا ہے: http://localhost:${PORT}`);
});

startBot();
