require('dotenv').config();

module.exports = {
  BOT_NAME: process.env.BOT_NAME || 'Wasif-X',
  PREFIX: process.env.PREFIX || '.',
  OWNER_NUMBER: process.env.OWNER_NUMBER || '923000000000', // your WhatsApp number with country code, no +
};
