# 🤖 Wasif-X

A simple WhatsApp bot built with **Node.js** and the **Baileys** library.
It includes a **web login page** — no need to check the terminal or logs to connect.

## ✨ Features
- `.ping` — check bot speed
- `.menu` — show the list of commands
- `.alive` — check if the bot is online
- `.owner` — get the owner's contact
- 🌐 **Web login page** — open it in your browser and log in with a QR code or a pairing code

---

## 🖥️ Running Locally

```bash
git clone https://github.com/YOUR_USERNAME/wasif-x.git
cd wasif-x
npm install
npm start
```

Now open this in your browser:
```
http://localhost:3000
```

The page has two tabs:
- **QR Code** — scan it directly with WhatsApp to log in
- **Pairing Code** — enter your number (with country code) to get a code and enter it in WhatsApp

Once the connection succeeds, the same page automatically shows "✅ Connected!".

---

## 📤 Pushing to GitHub

```bash
cd wasif-x
git init
git add .
git commit -m "Initial commit - Wasif-X"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/wasif-x.git
git push -u origin main
```

> ⚠️ Note: never push the `session/` folder or the `.env` file to GitHub —
> they hold your WhatsApp login data. Both are already listed in `.gitignore`.

---

## 🚀 Deploying to Heroku

### Method 1: Heroku CLI
```bash
heroku login
heroku create wasif-x-bot
heroku config:set BOT_NAME="Wasif-X"
heroku config:set PREFIX="."
heroku config:set OWNER_NUMBER="923001234567"
git push heroku main
```

Once deployed, open this link in your browser:
```
https://wasif-x-bot.herokuapp.com
```
and log in from there with a QR scan or a pairing code.

### Method 2: Heroku Dashboard (no CLI)
1. Push the repo to GitHub (see above)
2. Go to the [Heroku Dashboard](https://dashboard.heroku.com/) and click **New > Create new app**
3. In the **Deploy** tab, select GitHub and connect your repo
4. In **Settings > Config Vars**, add these values:
   - `BOT_NAME` = Wasif-X
   - `PREFIX` = .
   - `OWNER_NUMBER` = 923xxxxxxxxx
5. Click **Deploy Branch**
6. Once deployed, click **"View"** or open
   `https://your-app-name.herokuapp.com` directly in your browser — that's your login page

---

---

## 🔧 Troubleshooting: Pairing Code Not Working
If clicking "Get Pairing Code" fails or gives an error, try these:
- Enter the number as **digits only with country code**, no `+` and no leading `0` (e.g. `923001234567`, not `+92 300 1234567`)
- Wait a few seconds after the page loads before requesting a code — the bot needs a moment to establish its connection
- Delete the `session/` folder and restart the app if you were previously logged in or a login attempt got stuck
- Make sure you click **"Link with phone number instead"** on the WhatsApp linking screen (not the QR scanner) before entering the code
- The code expires in about a minute — if it doesn't work in time, just click the button again for a new one

## ⚠️ Important Note: Sessions and Heroku
Heroku's filesystem is **ephemeral** — meaning whenever the app restarts or
sleeps, the `session/` folder gets wiped, and you'll need to log in again
from the web page with a new QR/pairing code. For a persistent session,
you can later use one of these solutions:
- Store the session in MongoDB / Firebase
- Use a VPS instead of Heroku (an always-on server)

For now, this simple version stores the session on the local filesystem,
which works fine for testing.

---

## 📁 File Structure
```
wasif-x/
├── index.js          → Express server + bot logic (including QR/Pairing API)
├── index.html        → Web login page (QR + Pairing Code UI)
├── config.js         → Settings (name, prefix, owner number)
├── package.json      → List of dependencies
├── Procfile          → Tells Heroku how to run the app
├── app.json          → Heroku one-click deploy config
├── .env.example      → Example environment variables
└── .gitignore        → Which files to hide from Git
```

Built with ❤️ — **Wasif-X**
