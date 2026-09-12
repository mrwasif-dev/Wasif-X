# 🤖 Wasif-X

ایک سادہ (Simple) واٹس ایپ بوٹ — بنایا گیا **Node.js** اور **Baileys** لائبریری سے۔

## ✨ فیچرز
- `.ping` — بوٹ کی سپیڈ چیک کریں
- `.menu` — کمانڈز کی لسٹ دیکھیں
- `.alive` — بوٹ آن ہے یا نہیں چیک کریں
- `.owner` — اونر کا نمبر دیکھیں
- QR کوڈ یا Pairing Code — دونوں طریقوں سے لاگ ان

---

## 🖥️ لوکل کمپیوٹر پر چلانا

```bash
git clone https://github.com/YOUR_USERNAME/wasif-x.git
cd wasif-x
npm install
npm start
```

پہلی بار چلانے پر ٹرمینل میں QR کوڈ آئے گا — اسے اپنے واٹس ایپ کے
**Settings > Linked Devices > Link a Device** سے سکین کر لیں۔

Pairing code استعمال کرنا ہو تو `.env` فائل میں `USE_PAIRING_CODE=true` کر دیں
(نیچے `.env.example` دیکھیں)۔

---

## 📤 GitHub پر اپلوڈ کرنا

```bash
cd wasif-x
git init
git add .
git commit -m "Initial commit - Wasif-X"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/wasif-x.git
git push -u origin main
```

> ⚠️ نوٹ: `session/` اور `.env` فولڈر/فائل کبھی گٹ ہب پر اپلوڈ نہ کریں —
> یہ آپ کے واٹس ایپ اکاؤنٹ کا لاگ ان ڈیٹا رکھتے ہیں۔ `.gitignore` میں یہ
> پہلے سے شامل ہیں۔

---

## 🚀 Heroku پر ڈپلائے کرنا

### طریقہ 1: Heroku CLI سے
```bash
heroku login
heroku create wasif-x-bot
heroku config:set BOT_NAME="Wasif-X"
heroku config:set PREFIX="."
heroku config:set OWNER_NUMBER="923001234567"
heroku config:set USE_PAIRING_CODE="false"
git push heroku main
heroku logs --tail
```

QR کوڈ دیکھنے کے لیے `heroku logs --tail` استعمال کریں (چونکہ Heroku پر
ٹرمینل نظر نہیں آتا، لاگز میں QR کوڈ ٹیکسٹ کی شکل میں آئے گا — یا
`USE_PAIRING_CODE=true` رکھ کر pairing code استعمال کریں جو زیادہ آسان ہے)۔

### طریقہ 2: Heroku Dashboard سے (بغیر CLI کے)
1. GitHub پر ریپو اپلوڈ کریں (اوپر دیکھیں)
2. [Heroku Dashboard](https://dashboard.heroku.com/) پر جا کر **New > Create new app**
3. **Deploy** ٹیب میں GitHub سلیکٹ کریں اور اپنی ریپو کنیکٹ کریں
4. **Settings > Config Vars** میں یہ ویلیوز شامل کریں:
   - `BOT_NAME` = Wasif-X
   - `PREFIX` = .
   - `OWNER_NUMBER` = 923xxxxxxxxx
   - `USE_PAIRING_CODE` = false
5. **Deploy Branch** پر کلک کریں
6. **More > View Logs** سے QR کوڈ دیکھ کر سکین کریں

---

## ⚠️ اہم نوٹ: سیشن اور Heroku
Heroku کا فائل سسٹم **ephemeral** ہوتا ہے — یعنی جب بھی ایپ ری اسٹارٹ/سلیپ
ہو گی، `session/` فولڈر ڈیلیٹ ہو جائے گا اور آپ کو دوبارہ QR/Pairing کوڈ
سے لاگ ان کرنا پڑے گا۔ مستقل (persistent) سیشن کے لیے آگے چل کر ان میں سے
کوئی حل استعمال کیا جا سکتا ہے:
- سیشن کو MongoDB / Firebase میں سٹور کرنا
- Heroku کی بجائے ایک VPS (جیسے کہ ہمیشہ آن رہنے والا سرور) استعمال کرنا

ابھی کے لیے یہ سادہ ورژن مقامی فائل سسٹم پر سیشن رکھتا ہے، جو ٹیسٹنگ کے
لیے بالکل ٹھیک ہے۔

---

## 📁 فائل اسٹرکچر
```
wasif-x/
├── index.js        → مین بوٹ لاجک
├── config.js        → سیٹنگز (نام، prefix، اونر نمبر)
├── package.json      → dependencies کی لسٹ
├── Procfile         → Heroku کو بتاتا ہے کہ ایپ کیسے چلانی ہے
├── app.json         → Heroku ون-کلک ڈپلائے کنفیگ
├── .env.example      → environment variables کی مثال
└── .gitignore        → کن فائلوں کو گٹ سے چھپانا ہے
```

بنایا گیا ❤️ کے ساتھ — **Wasif-X**
