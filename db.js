const mongoose = require('mongoose');
const { BufferJSON } = require('@whiskeysockets/baileys');

// ============ Session Schema (Baileys Auth) ============
// Keep Baileys auth data as JSON strings. BufferJSON preserves Buffer values
// exactly, avoiding BSON type conversions that can cause Signal "Bad MAC"
// errors when a Heroku dyno restarts.
const sessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    jid: String,
    credsJson: { type: String, default: null },
    keysJson: { type: String, default: null },
    // Legacy fields kept temporarily so an old document can be read once.
    creds: mongoose.Schema.Types.Mixed,
    keys: mongoose.Schema.Types.Mixed,
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: 'sessions', timestamps: true }
);

const Session = mongoose.model('Session', sessionSchema);

// ============ Bot Settings Schema ============
const botSettingsSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    botName: {
      type: String,
      default: 'Wasif-X',
    },
    prefix: {
      type: String,
      default: '.',
    },
    ownerNumber: {
      type: String,
      required: true,
    },
    isConnected: {
      type: Boolean,
      default: false,
    },
    phoneNumber: String,
    qrCode: String,
    lastSync: {
      type: Date,
      default: Date.now,
    },
    settings: {
      autoReply: { type: Boolean, default: false },
      autoReplyMessage: String,
      allowCommands: { type: Boolean, default: true },
      logMessages: { type: Boolean, default: true },
    },
  },
  { collection: 'botSettings', timestamps: true }
);

const BotSettings = mongoose.model('BotSettings', botSettingsSchema);

// ============ Message Logs Schema ============
const messageLogSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    from: String,
    body: String,
    timestamp: {
      type: Date,
      default: Date.now,
    },
    isCommand: Boolean,
    command: String,
  },
  { collection: 'messageLogs' }
);

// Auto cleanup old logs (older than 90 days)
messageLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 });

const MessageLog = mongoose.model('MessageLog', messageLogSchema);

// ============ Database Connection ============
async function connectDB() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    console.log('✅ MongoDB connected successfully');
    return true;
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    return false;
  }
}


function getConnectionState() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[mongoose.connection.readyState] || 'unknown';
}

// ============ Session Management Functions ============

// Load the complete Baileys authentication state
async function loadSession(sessionId) {
  try {
    const session = await Session.findOne({ sessionId }).lean();
    if (!session) return null;

    let creds = null;
    let keys = {};

    if (session.credsJson) {
      creds = JSON.parse(session.credsJson, BufferJSON.reviver);
    } else if (session.creds) {
      // One-time compatibility with the previous Mixed-field format.
      creds = JSON.parse(JSON.stringify(session.creds), BufferJSON.reviver);
    }

    if (session.keysJson) {
      keys = JSON.parse(session.keysJson, BufferJSON.reviver) || {};
    } else if (session.keys) {
      keys = JSON.parse(JSON.stringify(session.keys), BufferJSON.reviver) || {};
    }

    console.log(`✅ Loaded MongoDB auth state for: ${sessionId}`);
    return { creds, keys };
  } catch (err) {
    console.error('Error loading auth state:', err);
    return null;
  }
}

// Save the complete Baileys authentication state
async function saveSession(sessionId, creds, keys) {
  try {
    const credsJson = JSON.stringify(creds, BufferJSON.replacer);
    const keysJson = JSON.stringify(keys, BufferJSON.replacer);

    await Session.findOneAndUpdate(
      { sessionId },
      {
        $set: {
          sessionId,
          credsJson,
          keysJson,
          lastUpdated: new Date(),
        },
        // Remove the old Mixed auth fields after the first successful save.
        $unset: {
          creds: 1,
          keys: 1,
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    console.error('Error saving auth state:', err);
    throw err;
  }
}

// Backwards-compatible helpers
async function saveSessionCreds(sessionId, creds) {
  const existing = await loadSession(sessionId);
  return saveSession(sessionId, creds, existing?.keys || {});
}

async function loadSessionCreds(sessionId) {
  const existing = await loadSession(sessionId);
  return existing?.creds || null;
}

// Delete the complete auth session
async function deleteSession(sessionId) {
  try {
    await Session.deleteOne({ sessionId });
    console.log(`🗑️  Deleted MongoDB session: ${sessionId}`);
    return true;
  } catch (err) {
    console.error('Error deleting session:', err);
    return false;
  }
}

// ============ Bot Settings Functions ============

// Get bot settings
async function getBotSettings(sessionId) {
  try {
    let settings = await BotSettings.findOne({ sessionId });
    if (!settings) {
      settings = new BotSettings({
        sessionId,
        ownerNumber: process.env.OWNER_NUMBER || '923000000000',
        botName: process.env.BOT_NAME || 'Wasif-X',
        prefix: process.env.PREFIX || '.',
      });
      await settings.save();
    }
    return settings;
  } catch (err) {
    console.error('Error getting bot settings:', err);
    throw err;
  }
}

// Update bot settings
async function updateBotSettings(sessionId, updates) {
  try {
    const settings = await BotSettings.findOneAndUpdate(
      { sessionId },
      {
        $set: updates,
        sessionId,
        ownerNumber: process.env.OWNER_NUMBER || '923000000000',
      },
      { upsert: true, new: true }
    );
    return settings;
  } catch (err) {
    console.error('Error updating bot settings:', err);
    throw err;
  }
}

// Update connection status
async function updateConnectionStatus(sessionId, isConnected, phoneNumber = null) {
  try {
    const updates = {
      isConnected,
      lastSync: new Date(),
    };
    if (phoneNumber) updates.phoneNumber = phoneNumber;

    const settings = await BotSettings.findOneAndUpdate(
      { sessionId },
      { $set: updates },
      { upsert: true, new: true }
    );
    return settings;
  } catch (err) {
    console.error('Error updating connection status:', err);
  }
}

// ============ Message Logging Functions ============

// Log a message
async function logMessage(sessionId, from, body, isCommand = false, command = null) {
  try {
    if (!from || !body) return;

    const log = new MessageLog({
      sessionId,
      from,
      body,
      isCommand,
      command,
      timestamp: new Date(),
    });

    await log.save();
  } catch (err) {
    console.error('Error logging message:', err);
  }
}

// Get message logs
async function getMessageLogs(sessionId, limit = 50) {
  try {
    const logs = await MessageLog.find({ sessionId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    return logs;
  } catch (err) {
    console.error('Error getting message logs:', err);
    return [];
  }
}

// ============ Export Functions ============
module.exports = {
  // Connection
  connectDB,
  getConnectionState,
  
  // Models
  Session,
  BotSettings,
  MessageLog,
  
  // Session functions
  saveSessionCreds,
  loadSessionCreds,
  deleteSession,
  
  // Settings functions
  getBotSettings,
  updateBotSettings,
  updateConnectionStatus,
  
  // Logging functions
  logMessage,
  getMessageLogs,
};
