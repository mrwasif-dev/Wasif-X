const P = require('pino');
const {
  initAuthCreds,
  BufferJSON,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const db = require('./db');

const logger = P({ level: 'silent' });

/**
 * Baileys auth state stored safely in MongoDB.
 * Credentials are stored as JSON strings and Signal keys are stored one-by-one,
 * which preserves Buffer values and avoids MongoDB object conversion/race issues.
 */
async function useMongoAuthState(sessionId) {
  const savedCreds = await db.loadSessionCreds(sessionId);
  const creds = savedCreds || initAuthCreds();

  const keys = {
    get: async (type, ids) => {
      const stored = await db.loadAuthKeys(sessionId, type, ids);
      const result = {};
      for (const id of ids) {
        if (stored[id] !== undefined) result[id] = stored[id];
      }
      return result;
    },
    set: async (data) => {
      await db.saveAuthKeys(sessionId, data);
    },
  };

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore(keys, logger),
    },
    saveCreds: async () => {
      try {
        await db.saveSessionCreds(sessionId, creds);
      } catch (err) {
        console.error('Error saving credentials to MongoDB:', err?.message || err);
      }
    },
  };
}

module.exports = { useMongoAuthState };
