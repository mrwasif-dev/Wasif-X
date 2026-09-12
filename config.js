require('dotenv').config();

module.exports = {
  BOT_NAME: process.env.BOT_NAME || 'Wasif-X',
  PREFIX: process.env.PREFIX || '.',
  OWNER_NUMBER: process.env.OWNER_NUMBER || '923000000000', // اپنا نمبر یہاں ڈالیں (country code کے ساتھ، بغیر + کے)
};
