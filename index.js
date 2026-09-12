const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const readline = require('readline');
const http = require('http');
const config = require('./config');

// Heroku کے لیے ایک چھوٹا سا HTTP سرور (health check کے لیے، ورنہ web dyno سو جاتا ہے)
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`${config.BOT_NAME} is running ✅`);
  })
  .listen(PORT, () => console.log(`🌐 HTTP سرور پورٹ ${PORT} پر چل رہا ہے`));

const logger = P({ level: 'silent' });

const question = (text) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(text, (answer) => {
      rl.close();
      resolve(answer);
    });
  });

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: !config.USE_PAIRING_CODE,
    auth: state,
    browser: [config.BOT_NAME, 'Chrome', '1.0.0'],
  });

  // Pairing code login (اگر QR کے بجائے کوڈ سے لاگ ان کرنا ہو)
  if (config.USE_PAIRING_CODE && !sock.authState.creds.registered) {
    const phoneNumber = await question(
      'اپنا واٹس ایپ نمبر country code کے ساتھ درج کریں (مثال: 923001234567): '
    );
    const code = await sock.requestPairingCode(phoneNumber.trim());
    console.log(`\n👉 آپ کا Pairing Code: ${code}\n`);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !config.USE_PAIRING_CODE) {
      console.log('\n📱 نیچے دیا گیا QR کوڈ اپنے واٹس ایپ سے سکین کریں:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('❌ کنکشن بند ہو گیا۔ دوبارہ کوشش:', shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    } else if (connection === 'open') {
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
    const args = body.trim().split(/ +/).slice(1);

    console.log(`📩 پیغام موصول ہوا [${from}]: ${body}`);

    if (!isCmd) return;

    try {
      switch (command) {
        case 'ping': {
          const start = Date.now();
          await sock.sendMessage(from, { text: '🏓 Pong!' }, { quoted: msg });
          const end = Date.now();
          await sock.sendMessage(from, {
            text: `⚡ سپیڈ: ${end - start}ms`,
          });
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

  return sock;
}

startBot();
