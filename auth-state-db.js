const {
  initAuthCreds,
  BufferJSON,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const db = require('./db');

/**
 * Baileys authentication state backed by MongoDB.
 *
 * Important: Baileys uses Buffers extensively for Signal/Noise keys.
 * Store the auth state as JSON strings using Baileys' BufferJSON replacer
 * so MongoDB never changes Buffer values into BSON objects. This prevents
 * Signal "Bad MAC" errors after a Heroku restart.
 */
async function useMongoAuthState(sessionId) {
  const saved = await db.loadSession(sessionId);

  const creds = saved?.creds
    ? saved.creds
    : initAuthCreds();

  const keyStore = saved?.keys || {};

  const rawKeys = {
    get: async (type, ids) => {
      const data = {};
      for (const id of ids) {
        const key = `${type}-${id}`;
        if (keyStore[key] !== undefined) {
          data[id] = keyStore[key];
        }
      }
      return data;
    },

    set: async (data) => {
      for (const type of Object.keys(data)) {
        for (const id of Object.keys(data[type])) {
          const value = data[type][id];
          const key = `${type}-${id}`;

          if (value === null || value === undefined) {
            delete keyStore[key];
          } else {
            keyStore[key] = value;
          }
        }
      }

      await save();
    },
  };

  let saving = Promise.resolve();
  function save() {
    // Serialize writes so simultaneous creds/key updates cannot overwrite
    // each other with an older snapshot.
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
