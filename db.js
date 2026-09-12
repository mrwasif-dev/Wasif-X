const mongoose = require('mongoose');

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
    keys: mongoose.Schema.Types.Mixed, // Encryption keys
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: 'sessions', timestamps: true }
);

// Auto cleanup old sessions (older than 30 days)
sessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

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
      useNewUrlParser: true,
      useUnifiedTopology: true,
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

// Save session credentials to MongoDB
async function saveSessionCreds(sessionId, creds) {
  try {
    const session = await Session.findOneAndUpdate(
      { sessionId },
      {
        sessionId,
        creds,
        lastUpdated: new Date(),
      },
      { upsert: true, new: true }
    );
    return session;
  } catch (err) {
    console.error('Error saving session:', err);
    throw err;
  }
}

// Load session credentials from MongoDB
async function loadSessionCreds(sessionId) {
  try {
    const session = await Session.findOne({ sessionId });
    if (session && session.creds) {
      console.log(`✅ Loaded session credentials for: ${sessionId}`);
      return session.creds;
    }
    return null;
  } catch (err) {
    console.error('Error loading session:', err);
    return null;
  }
}

// Delete session from MongoDB
async function deleteSession(sessionId) {
  try {
    await Session.deleteOne({ sessionId });
    console.log(`🗑️  Deleted session: ${sessionId}`);
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
