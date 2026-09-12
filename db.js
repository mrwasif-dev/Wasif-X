const mongoose = require('mongoose');
const { BufferJSON } = require('@whiskeysockets/baileys');

// ============ Session Schema (Baileys Auth) ============
const sessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    jid: String,
    creds: mongoose.Schema.Types.Mixed, // Baileys credentials
    // Legacy field kept for compatibility. New Signal keys are stored in AuthKey documents.
    keys: mongoose.Schema.Types.Mixed,
    authVersion: { type: Number, default: 2 },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: 'sessions', timestamps: true }
);

// WhatsApp auth sessions must NOT expire automatically.

const Session = mongoose.model('Session', sessionSchema);

const authKeySchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    type: { type: String, required: true },
    keyId: { type: String, required: true },
    value: { type: String, required: true },
  },
  { collection: 'authKeys', timestamps: true }
);
authKeySchema.index({ sessionId: 1, type: 1, keyId: 1 }, { unique: true });
const AuthKey = mongoose.model('AuthKey', authKeySchema);

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
      index: true,
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

// ============ Session Management Functions ============

function encode(value) {
  return JSON.stringify(value, BufferJSON.replacer);
}

function decode(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    // Legacy MongoDB data from the earlier bot version is intentionally not
    // reused for Signal keys because BSON may have changed Buffer values.
    return null;
  }
  return JSON.parse(value, BufferJSON.reviver);
}

async function saveSessionCreds(sessionId, creds) {
  try {
    await Session.findOneAndUpdate(
      { sessionId },
      {
        $set: {
          sessionId,
          creds: encode(creds),
          authVersion: 2,
          lastUpdated: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    console.error('Error saving session credentials:', err?.message || err);
    throw err;
  }
}

async function loadSessionCreds(sessionId) {
  try {
    const session = await Session.findOne({ sessionId }).lean();
    if (!session?.creds) return null;
    const creds = decode(session.creds);
    if (creds) console.log(`✅ Loaded MongoDB credentials for: ${sessionId}`);
    return creds;
  } catch (err) {
    console.error('Error loading session credentials:', err?.message || err);
    return null;
  }
}

async function saveAuthKeys(sessionId, data) {
  const ops = [];
  for (const type of Object.keys(data || {})) {
    for (const keyId of Object.keys(data[type] || {})) {
      const value = data[type][keyId];
      if (value === null || value === undefined) {
        ops.push({ deleteOne: { filter: { sessionId, type, keyId } } });
      } else {
        ops.push({
          updateOne: {
            filter: { sessionId, type, keyId },
            update: { $set: { sessionId, type, keyId, value: encode(value) } },
            upsert: true,
          },
        });
      }
    }
  }
  if (!ops.length) return;
  try {
    await AuthKey.bulkWrite(ops, { ordered: false });
  } catch (err) {
    console.error('Error saving Signal keys:', err?.message || err);
    throw err;
  }
}

async function loadAuthKeys(sessionId, type, ids) {
  if (!ids?.length) return {};
  try {
    const docs = await AuthKey.find({ sessionId, type, keyId: { $in: ids } }).lean();
    const result = {};
    for (const doc of docs) {
      try {
        result[doc.keyId] = decode(doc.value);
      } catch (e) {
        console.error(`Invalid stored Signal key ${type}/${doc.keyId}; ignoring it.`);
      }
    }
    return result;
  } catch (err) {
    console.error('Error loading Signal keys:', err?.message || err);
    return {};
  }
}

async function deleteSession(sessionId) {
  try {
    await Promise.all([
      Session.deleteOne({ sessionId }),
      AuthKey.deleteMany({ sessionId }),
    ]);
    console.log(`🗑️ Deleted MongoDB auth session: ${sessionId}`);
    return true;
  } catch (err) {
    console.error('Error deleting session:', err?.message || err);
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
  
  // Models
  Session,
  AuthKey,
  BotSettings,
  MessageLog,
  
  // Session functions
  saveSessionCreds,
  loadSessionCreds,
  saveAuthKeys,
  loadAuthKeys,
  deleteSession,
  
  // Settings functions
  getBotSettings,
  updateBotSettings,
  updateConnectionStatus,
  
  // Logging functions
  logMessage,
  getMessageLogs,
};
