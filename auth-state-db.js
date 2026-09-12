const { initAuthCreds, BufferJSON, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const db = require('./db');

/**
 * Baileys authentication state backed by MongoDB.
 * Keeps both creds and Signal/Noise keys persistent across Heroku restarts.
 */
async function useMongoAuthState(sessionId) {
  const saved = await db.loadSession(sessionId);

  const creds = saved?.creds
    ? JSON.parse(JSON.stringify(saved.creds), BufferJSON.reviver)
    : initAuthCreds();

  const keyStore = saved?.keys
    ? JSON.parse(JSON.stringify(saved.keys), BufferJSON.reviver)
    : {};

  const rawKeys = {
    get: async (type, ids) => {
      const data = {};
      for (const id of ids) {
        const key = `${type}-${id}`;
        if (keyStore[key] !== undefined) data[id] = keyStore[key];
      }
      return data;
    },
    set: async (data) => {
      for (const type of Object.keys(data)) {
        for (const id of Object.keys(data[type])) {
          const value = data[type][id];
          const key = `${type}-${id}`;
          if (value === null || value === undefined) delete keyStore[key];
          else keyStore[key] = value;
        }
      }
      await save();
    },
  };

  let saving = Promise.resolve();
  async function save() {
    saving = saving.then(() => db.saveSession(sessionId, creds, keyStore));
    return saving;
  }

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore(rawKeys, undefined),
    },
    saveCreds: save,
  };
}

module.exports = { useMongoAuthState };
