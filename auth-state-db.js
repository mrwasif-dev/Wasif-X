const db = require('./db');

/**
 * Creates an authentication state handler that uses MongoDB instead of files
 * This is essential for Heroku's ephemeral filesystem
 */
async function useMongoAuthState(sessionId) {
  // In-memory cache for faster access
  const state = {
    creds: null,
    keys: {},
  };

  // Load initial state from MongoDB
  const savedCreds = await db.loadSessionCreds(sessionId);
  if (savedCreds) {
    state.creds = savedCreds;
  }

  return {
    state,
    
    // Save credentials to MongoDB
    saveCreds: async () => {
      try {
        if (state.creds) {
          await db.saveSessionCreds(sessionId, state.creds);
        }
      } catch (err) {
        console.error('Error saving credentials to MongoDB:', err);
      }
    },

    // Get creds
    getCreds: () => state.creds,
    
    // Set creds
    setCreds: (creds) => {
      state.creds = creds;
    },
  };
}

module.exports = { useMongoAuthState };
