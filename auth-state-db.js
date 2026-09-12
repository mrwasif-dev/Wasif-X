const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const db = require('./db');

/**
 * MongoDB-backed Baileys authentication state.
 *
 * IMPORTANT:
 * Baileys requires `creds` to always be a valid auth-credentials object.
 * Returning null here causes:
 *   TypeError: Cannot read properties of null (reading 'me')
 *
 * The key store is persisted as well, so a Heroku restart does not lose
 * the Signal keys needed by the linked WhatsApp device.
 */
async function useMongoAuthState(sessionId) {
  const saved = await db.loadSession(sessionId);

  const storedKeys = saved?.keys ? clone(saved.keys) : {};

  const state = {
    creds: saved?.creds ? decode(saved.creds) : initAuthCreds(),
    keys: {
      get: async (type, ids) => {
        const data = {};
        const stored = saved?.keys || {};

        for (const id of ids) {
          const value = stored?.[type]?.[id];
          if (value !== undefined && value !== null) {
            data[id] = decode(value);
          }
        }

        return data;
      },

      set: async (data) => {
        for (const category of Object.keys(data || {})) {
          if (!storedKeys[category]) storedKeys[category] = {};

          for (const id of Object.keys(data[category] || {})) {
            const value = data[category][id];

            if (value === null || value === undefined) {
              delete storedKeys[category][id];
            } else {
              storedKeys[category][id] = encode(value);
            }
          }
        }

        await db.saveSessionKeys(sessionId, storedKeys);
      },
    },
  };

  // Keep the reference used by state.keys.set valid.
  state.keys._stored = storedKeys;

  const saveCreds = async () => {
    try {
      await db.saveSessionCreds(sessionId, encode(state.creds));
    } catch (err) {
      console.error('❌ Error saving credentials to MongoDB:', err?.message || err);
    }
  };

  return {
    state,
    saveCreds,
    getCreds: () => state.creds,
    setCreds: (creds) => {
      state.creds = creds;
    },
  };
}

function encode(value) {
  return JSON.stringify(value, BufferJSON.replacer);
}

function decode(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value, BufferJSON.reviver);
  } catch {
    return value;
  }
}

function clone(value) {
  if (!value) return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

module.exports = { useMongoAuthState };
