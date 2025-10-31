require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Logger, SessionRecoveryManager, HealthChecker, AntiBanManager } = require('./monitoring');
const { AutomationMarketplace } = require('./automations');
const { SetupWizard } = require('./setup-wizard');
const { AuditLogger } = require('./audit-logger');
const { MessageTemplates, CampaignManager } = require('./templates');

const app = express();
const PORT = process.env.PORT || 3002;

// Initialize monitoring system
const logger = new Logger();
const sessionRecovery = new SessionRecoveryManager(logger);
const antiBan = new AntiBanManager(logger);

// Global variables for health checking
let healthChecker;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:3002'],
  credentials: true
}));
app.use(logApiAccess);
app.use(express.json());

// Client Authentication Middleware
function authenticateClient(req, res, next) {
  const clientId = req.headers['x-client-id'] || req.query.clientId;
  const apiKey = req.headers['x-api-key'];

  if (!clientId) {
    return res.status(401).json({ success: false, error: 'Client ID required' });
  }

  // In production, validate API key against client
  // For now, just check if client exists
  if (!clients.has(clientId)) {
    return res.status(404).json({ success: false, error: 'Client not found' });
  }

  req.clientId = clientId;
  next();
}

// API Access Logging Middleware
function logApiAccess(req, res, next) {
  const startTime = Date.now();
  const clientId = req.headers['x-client-id'] || req.query.clientId || 'unknown';

  // Log after response is sent
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    auditLogger.logApiAccess(clientId, req.path, req.method, res.statusCode, responseTime, {
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent') || 'unknown'
    });
  });

  next();
}

// Ensure sessions directory exists
const sessionsDir = process.env.SESSIONS_DIR || './sessions';
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
  console.log(`Created sessions directory: ${sessionsDir}`);
}

// Simple in-memory storage (replace with database in production)
const clients = new Map();
const qrCodes = new Map();

// Persistence configuration
const CLIENTS_DB_FILE = path.join(__dirname, 'clients-db.json');
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex'); // Generate if not set

// Encryption utilities for sensitive data
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipher('aes-256-cbc', ENCRYPTION_KEY);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText) {
  try {
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipher('aes-256-cbc', ENCRYPTION_KEY);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    logger.error('Decryption failed', { error: error.message });
    return null;
  }
}

// Persistence functions
function saveClientsToFile() {
  try {
    const clientsData = {};
    for (const [clientId, clientData] of clients.entries()) {
      // Only save serializable data, not the actual client instance
      clientsData[clientId] = {
        clientId,
        status: clientData.status,
        createdAt: clientData.createdAt,
        connectedAt: clientData.connectedAt,
        disconnectedAt: clientData.disconnectedAt,
        error: clientData.error,
        messageCount: clientData.messageCount || 0,
        lastActivity: clientData.lastActivity || Date.now()
      };
    }

    // Encrypt sensitive data before saving
    const encryptedData = encrypt(JSON.stringify(clientsData));
    fs.writeFileSync(CLIENTS_DB_FILE, encryptedData);

    logger.success(`Saved ${Object.keys(clientsData).length} clients to encrypted database`);
  } catch (error) {
    logger.error('Error saving clients to file', { error: error.message });
  }
}

function loadClientsFromFile() {
  try {
    if (fs.existsSync(CLIENTS_DB_FILE)) {
      const encryptedData = fs.readFileSync(CLIENTS_DB_FILE, 'utf8');
      const decryptedData = decrypt(encryptedData);

      if (!decryptedData) {
        logger.error('Failed to decrypt client database');
        return 0;
      }

      const clientsData = JSON.parse(decryptedData);
      logger.info(`Loading ${Object.keys(clientsData).length} clients from encrypted database`);

      // Recreate clients from saved data
      for (const [clientId, clientData] of Object.entries(clientsData)) {
        logger.info(`Restoring client: ${clientId} (${clientData.status})`);

        // Create the WhatsApp client (this will load from existing session if available)
        const client = createClient(clientId);

        // Restore client data
        clients.set(clientId, {
          client,
          status: clientData.status,
          createdAt: clientData.createdAt,
          connectedAt: clientData.connectedAt,
          disconnectedAt: clientData.disconnectedAt,
          error: clientData.error,
          messageCount: clientData.messageCount || 0,
          lastActivity: clientData.lastActivity || Date.now()
        });

        // Initialize the client (this will use existing session data if available)
        client.initialize().then(() => {
          logger.success(`Restored client ${clientId} successfully`);
        }).catch((error) => {
          logger.error(`Failed to restore client ${clientId}`, { error: error.message });
          // Update status to indicate restoration failed
          if (clients.has(clientId)) {
            const clientData = clients.get(clientId);
            clientData.status = 'restore_failed';
            clientData.error = error.message;
            clients.set(clientId, clientData);
            saveClientsToFile(); // Save the updated status
          }
        });
      }

      return Object.keys(clientsData).length;
    }
  } catch (error) {
    logger.error('Error loading clients from file', { error: error.message });
  }
  return 0;
}

// Auto-save clients every 30 seconds
setInterval(saveClientsToFile, 30000);

// Save clients on process exit
process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, saving clients before exit...');
  saveClientsToFile();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, saving clients before exit...');
  saveClientsToFile();
  process.exit(0);
});

// Create WhatsApp client
function createClient(clientId) {
  logger.info('Creating WhatsApp client', { clientId });

  const puppeteerOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-default-apps',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-field-trial-config',
      '--disable-back-forward-cache',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--force-color-profile=srgb',
      '--metrics-recording-only',
      '--no-default-browser-check',
      '--password-store=basic',
      '--use-mock-keychain',
      '--disable-component-extensions-with-background-pages',
      '--disable-background-networking',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--disable-logging',
      '--disable-notifications',
      '--disable-ipc-flooding-protection',
      '--disable-print-preview',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-crash-upload',
      '--no-default-browser-check',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ],
  };

  // Use custom Chromium path if specified
  const chromiumPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (chromiumPath) {
    puppeteerOpts.executablePath = chromiumPath;
    logger.info('Using Chromium path', { chromiumPath });
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: clientId,
      dataPath: `./sessions/${clientId}`
    }),
    puppeteer: puppeteerOpts,
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    takeoverOnConflict: true,
    takeoverTimeoutMs: 0,
    restartOnAuthFail: true
  });

  // Set up page to avoid detection
  client.on('page_loaded', async (page) => {
    try {
      // Set viewport
      await page.setViewport({ width: 1280, height: 720 });
      
      // Set user agent
      await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Override navigator properties to avoid detection
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'Chrome PDF Plugin', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', description: '', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
            { name: 'Native Client', description: '', filename: 'internal-nacl-plugin' }
          ]
        });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      });
      
      logger.info('Page anti-detection setup completed', { clientId });
    } catch (error) {
      logger.warn('Failed to setup page anti-detection', { clientId, error: error.message });
    }
  });

  // Client events
  client.on('qr', async (qr) => {
    logger.info('QR Code generated', { clientId });
    logger.metric('QR code generated', { clientId });
    try {
      const qrDataURL = await qrcode.toDataURL(qr);
      qrCodes.set(clientId, {
        qr: qrDataURL,
        raw: qr,
        timestamp: Date.now()
      });
      logger.success('QR Code stored', { clientId });

      // Update client status
      if (clients.has(clientId)) {
        const clientData = clients.get(clientId);
        clientData.status = 'waiting_for_qr';
        clientData.lastActivity = Date.now();
        clients.set(clientId, clientData);
      }
    } catch (error) {
      logger.error('Error generating QR code', { clientId, error: error.message });
    }
  });

  client.on('ready', () => {
    logger.success('WhatsApp client is ready', { clientId });
    qrCodes.delete(clientId);

    // Reset recovery attempts on successful connection
    sessionRecovery.resetAttempts(clientId);

    // Update client status
    if (clients.has(clientId)) {
      const clientData = clients.get(clientId);
      clientData.status = 'connected';
      clientData.connectedAt = Date.now();
      clientData.lastActivity = Date.now();
      clientData.error = null;
      clients.set(clientId, clientData);
    }

    // Update metrics
    logger.updateMetrics({
      connectedClients: Array.from(clients.values()).filter(c => c.status === 'connected').length
    });
  });

  client.on('authenticated', () => {
    logger.success('Client authenticated successfully', { clientId });
  });

  client.on('auth_failure', (msg) => {
    logger.error('Authentication failed', { clientId, error: msg });
    // Update client status
    if (clients.has(clientId)) {
      const clientData = clients.get(clientId);
      clientData.status = 'auth_failed';
      clientData.error = msg;
      clientData.lastActivity = Date.now();
      clients.set(clientId, clientData);
    }
  });

  client.on('error', (error) => {
    logger.error('Client error during initialization', { clientId, error: error.message });
    // Update client status
    if (clients.has(clientId)) {
      const clientData = clients.get(clientId);
      clientData.status = 'error';
      clientData.error = error.message;
      clientData.lastActivity = Date.now();
      clients.set(clientId, clientData);
    }
  });

  client.on('disconnected', (reason) => {
    logger.warn('Client disconnected', { clientId, reason });

    // Check if this is a logout from mobile device
    const isLogout = reason === 'LOGOUT' || reason?.includes('logged out') ||
                     reason?.includes('Removed') || reason?.includes('removed');

    if (isLogout) {
      logger.info('User logged out from mobile device, preparing for re-authentication', { clientId });

      // Clear session files to force fresh authentication
      const sessionPath = path.join(process.cwd(), 'sessions', clientId);
      try {
        if (fs.existsSync(sessionPath)) {
          fs.rmSync(sessionPath, { recursive: true, force: true });
          logger.info('Cleared old session files', { clientId });
        }
      } catch (fileError) {
        logger.warn('Error clearing session files', { clientId, error: fileError.message });
      }

      // Update client status to indicate re-authentication needed
      if (clients.has(clientId)) {
        const clientData = clients.get(clientId);
        clientData.status = 'needs_reauth';
        clientData.error = 'User logged out from mobile device. Please scan QR code again.';
        clientData.disconnectedAt = Date.now();
        clientData.lastActivity = Date.now();
        clients.set(clientId, clientData);
      }

      logger.info('Ready for re-authentication', { clientId });
    } else {
      // Regular disconnection (network, etc.)
      qrCodes.delete(clientId);

      // Update client status
      if (clients.has(clientId)) {
        const clientData = clients.get(clientId);
        clientData.status = 'disconnected';
        clientData.error = reason;
        clientData.lastActivity = Date.now();
        clients.set(clientId, clientData);
      }

      // Schedule automatic recovery for non-logout disconnections
      if (!isLogout) {
        sessionRecovery.scheduleRecovery(clientId, async () => {
          logger.info('Attempting automatic session recovery', { clientId });

          try {
            // Try to reinitialize the client
            if (client && typeof client.initialize === 'function') {
              await client.initialize();
              return true;
            }
          } catch (error) {
            logger.error('Session recovery failed', { clientId, error: error.message });
          }
          return false;
        });
      }
    }

    // Update metrics
    logger.updateMetrics({
      connectedClients: Array.from(clients.values()).filter(c => c.status === 'connected').length
    });
  });

  client.on('loading_screen', (percent, message) => {
    logger.info('Client loading', { clientId, percent, message });
  });

  client.on('message', async (message) => {
    logger.info('Message received', { clientId, from: message.from, body: message.body.substring(0, 100) });

    // Update last activity
    if (clients.has(clientId)) {
      const clientData = clients.get(clientId);
      clientData.lastActivity = Date.now();
      clients.set(clientId, clientData);
    }

    // Log inbound message
    auditLogger.logMessage(clientId, 'inbound', client.info?.wid?.user || clientId, message.from, message.body, 'received', {
      messageId: message.id.id,
      hasMedia: !!message.hasMedia
    });

    // Process automations
    try {
      const automationResults = await automationMarketplace.processMessage(clientId, message, {
        clientData: clients.get(clientId),
        timestamp: Date.now()
      });

      // Log automation triggers
      if (automationResults.length > 0) {
        logger.info('Automations triggered', {
          clientId,
          messageFrom: message.from,
          triggeredCount: automationResults.length,
          results: automationResults
        });
      }
    } catch (error) {
      logger.error('Automation processing failed', { clientId, error: error.message });
    }
  });

  return client;
}

// API Routes

// Create client
app.post('/client/create', async (req, res) => {
  try {
    const { clientId } = req.body;

    if (!clientId) {
      logger.warn('Client creation failed: missing clientId');
      return res.status(400).json({ success: false, error: 'clientId required' });
    }

    if (clients.has(clientId)) {
      logger.warn('Client creation failed: client exists', { clientId });
      return res.status(400).json({ success: false, error: 'Client exists' });
    }

    logger.info('Starting client creation', { clientId });
    const client = createClient(clientId);
    clients.set(clientId, {
      client,
      status: 'initializing',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0
    });

    logger.info('Initializing client', { clientId });
    
    // Initialize with timeout
    const initPromise = client.initialize();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Client initialization timeout after 60 seconds')), 60000);
    });
    
    try {
      await Promise.race([initPromise, timeoutPromise]);
      logger.success('Client initialized successfully', { clientId });
    } catch (initError) {
      logger.error('Client initialization failed', { clientId, error: initError.message });
      
      // Update client status to error
      if (clients.has(clientId)) {
        const clientData = clients.get(clientId);
        clientData.status = 'error';
        clientData.error = initError.message;
        clientData.lastActivity = Date.now();
        clients.set(clientId, clientData);
      }
      
      throw initError;
    }

    // Save client data to persistent storage
    saveClientsToFile();

    // Update metrics
    logger.updateMetrics({
      totalClients: clients.size
    });

    res.json({ success: true, clientId, message: 'Client created and initializing' });
  } catch (error) {
    logger.error('Error creating client', { error: error.message });
    // Clean up on error
    if (clients.has(req.body.clientId)) {
      clients.delete(req.body.clientId);
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get QR code
app.get('/client/:clientId/qr', (req, res) => {
  const { clientId } = req.params;

  if (!clients.has(clientId)) {
    return res.status(404).json({ success: false, error: 'Client not found' });
  }

  const clientData = clients.get(clientId);

  // If client needs re-authentication, reinitialize it
  if (clientData.status === 'needs_reauth') {
    console.log(`🔄 Reinitializing ${clientId} for re-authentication...`);

    try {
      // Destroy the old client if it exists
      if (clientData.client && typeof clientData.client.destroy === 'function') {
        clientData.client.destroy();
      }

      // Create a new client instance
      const newClient = createClient(clientId);
      clientData.client = newClient;
      clientData.status = 'initializing';
      clientData.error = null;
      clients.set(clientId, clientData);

      // Initialize the new client
      newClient.initialize().then(() => {
        console.log(`✅ ${clientId} reinitialized for re-authentication`);
      }).catch((error) => {
        console.error(`❌ Failed to reinitialize ${clientId}:`, error);
        clientData.status = 'error';
        clientData.error = error.message;
        clients.set(clientId, clientData);
      });

      return res.json({
        success: false,
        message: 'Reinitializing client for re-authentication. Please check again in a few seconds.'
      });
    } catch (error) {
      console.error(`❌ Error reinitializing client ${clientId}:`, error);
      return res.status(500).json({ success: false, error: 'Failed to reinitialize client' });
    }
  }

  const qrData = qrCodes.get(clientId);
  if (!qrData) {
    return res.json({
      success: false,
      message: 'QR code not available. Client may be connected or still initializing.'
    });
  }

  res.json({ success: true, qr: qrData.qr, raw: qrData.raw });
});

// Get status
app.get('/client/:clientId/status', (req, res) => {
  const { clientId } = req.params;

  if (!clients.has(clientId)) {
    return res.status(404).json({ success: false, error: 'Client not found' });
  }

  const clientData = clients.get(clientId);
  const client = clientData.client;

  let status = clientData.status || 'unknown';
  let info = null;
  let error = clientData.error || null;

  // Try to get more detailed status from client
  try {
    if (client && client.info && client.info.wid) {
      status = 'connected';
      info = client.info;
    } else if (qrCodes.has(clientId)) {
      status = 'waiting_for_qr';
    }
  } catch (e) {
    console.error(`Error getting client status for ${clientId}:`, e);
  }

  res.json({
    success: true,
    clientId,
    status,
    info,
    error,
    createdAt: clientData.createdAt,
    connectedAt: clientData.connectedAt,
    hasQR: qrCodes.has(clientId)
  });
});

// Send message
app.post('/client/:clientId/send', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { to, message } = req.body;

    logger.info('Message send request', { clientId, to });

    if (!clients.has(clientId)) {
      logger.warn('Client not found for message send', { clientId });
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const clientData = clients.get(clientId);
    const client = clientData.client;

    if (!client.info || !client.info.wid) {
      logger.warn('Client not connected for message send', { clientId });
      return res.status(400).json({ success: false, error: 'Client not connected' });
    }

    // Use anti-ban protection for message sending
    const result = await antiBan.queueMessage(clientId, to, message, async (recipient, msg) => {
      const sendResult = await client.sendMessage(recipient, msg);

      // Update client activity and metrics
      clientData.lastActivity = Date.now();
      clientData.messageCount = (clientData.messageCount || 0) + 1;
      clients.set(clientId, clientData);

      logger.updateMetrics({
        messagesSent: logger.metrics.messagesSent + 1
      });

      // Log message
      auditLogger.logMessage(clientId, 'outbound', recipient, client.info.wid.user, msg, 'sent', {
        messageId: sendResult.id.id
      });

      return sendResult;
    });

    logger.success('Message sent successfully', { clientId, to, messageId: result.id.id });
    res.json({ success: true, messageId: result.id.id });
  } catch (error) {
    logger.error('Error sending message', { clientId, error: error.message });
    logger.updateMetrics({
      messagesFailed: logger.metrics.messagesFailed + 1
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

// List clients
app.get('/clients', (req, res) => {
  const clientList = Array.from(clients.entries()).map(([clientId, clientData]) => {
    const client = clientData.client;
    let status = clientData.status || 'unknown';
    let error = clientData.error || null;

    // Try to get more detailed status from client
    try {
      if (client && client.info && client.info.wid) {
        status = 'connected';
      } else if (qrCodes.has(clientId)) {
        status = 'waiting_for_qr';
      }
    } catch (e) {
      console.error(`Error getting status for ${clientId}:`, e);
      error = e.message;
    }

    return {
      clientId,
      status,
      hasQR: qrCodes.has(clientId),
      createdAt: clientData.createdAt,
      connectedAt: clientData.connectedAt,
      error
    };
  });

  res.json({ success: true, clients: clientList });
});

// Delete client
app.delete('/client/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;

    if (!clients.has(clientId)) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const clientData = clients.get(clientId);
    const client = clientData.client;

    console.log(`🗑️ Deleting client: ${clientId}`);

    // Destroy the WhatsApp client session (this will log out WhatsApp)
    try {
      if (client && typeof client.destroy === 'function') {
        await client.destroy();
        console.log(`✅ WhatsApp session destroyed for ${clientId}`);
      }
    } catch (destroyError) {
      console.warn(`⚠️ Error destroying client ${clientId}:`, destroyError.message);
    }

    // Remove from memory
    clients.delete(clientId);
    qrCodes.delete(clientId);

    // Save updated client list to persistent storage
    saveClientsToFile();

    // Remove session files
    const sessionPath = path.join(process.cwd(), 'sessions', clientId);
    try {
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log(`🗂️ Session files removed for ${clientId}`);
      }
    } catch (fileError) {
      console.warn(`⚠️ Error removing session files for ${clientId}:`, fileError.message);
    }

    console.log(`✅ Client ${clientId} deleted successfully`);
    res.json({ success: true, message: `Client ${clientId} deleted and logged out from WhatsApp` });
  } catch (error) {
    console.error(`❌ Error deleting client:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const health = await healthChecker.performHealthCheck();
    res.json(health);
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Detailed metrics endpoint
app.get('/metrics', (req, res) => {
  const metrics = logger.getMetrics();
  const alerts = logger.getAlerts();

  // Add real-time client counts
  metrics.totalClients = clients.size;
  metrics.connectedClients = Array.from(clients.values()).filter(c => c.status === 'connected').length;
  metrics.waitingForQr = Array.from(clients.values()).filter(c => c.status === 'waiting_for_qr').length;
  metrics.disconnectedClients = Array.from(clients.values()).filter(c => c.status === 'disconnected').length;
  metrics.errorClients = Array.from(clients.values()).filter(c => ['auth_failed', 'restore_failed', 'error'].includes(c.status)).length;

  res.json({
    ...metrics,
    alerts: alerts.length,
    qrCodes: qrCodes.size,
    timestamp: new Date().toISOString()
  });
});

// Root route - serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Tenant-specific health check
app.get('/health/:clientId', authenticateClient, (req, res) => {
  const clientId = req.clientId;
  const health = healthChecker.getTenantHealth(clientId);

  // Add rate limit status
  health.rateLimits = antiBan.getRateLimitStatus(clientId);

  res.json(health);
});

// Alerts endpoint
app.get('/alerts', (req, res) => {
  const unresolvedOnly = req.query.unresolved !== 'false';
  const alerts = logger.getAlerts(unresolvedOnly);

  res.json({
    alerts,
    total: alerts.length,
    unresolved: alerts.filter(a => !a.resolved).length
  });
});

// Resolve alert endpoint
app.post('/alerts/:index/resolve', (req, res) => {
  const index = parseInt(req.params.index);
  const alerts = logger.getAlerts();

  if (index >= 0 && index < alerts.length) {
    logger.resolveAlert(index);
    res.json({ success: true, message: 'Alert resolved' });
  } else {
    res.status(404).json({ success: false, error: 'Alert not found' });
  }
});

// Automation Marketplace Endpoints
app.get('/automations/templates', (req, res) => {
  try {
    const category = req.query.category;
    const templates = automationMarketplace.getTemplates(category);
    res.json({ success: true, templates });
  } catch (error) {
    logger.error('Error fetching automation templates', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/automations/templates/:type/:id', (req, res) => {
  try {
    const { type, id } = req.params;
    const template = automationMarketplace.getTemplate(type, id);
    if (template) {
      res.json({ success: true, template });
    } else {
      res.status(404).json({ success: false, error: 'Template not found' });
    }
  } catch (error) {
    logger.error('Error fetching automation template', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/automations/activate', authenticateClient, (req, res) => {
  try {
    const { automationId, config } = req.body;
    const clientId = req.clientId;

    const automation = automationMarketplace.activateAutomation(clientId, automationId, config);
    res.json({ success: true, automation });
  } catch (error) {
    logger.error('Error activating automation', { clientId: req.clientId, automationId: req.body.automationId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/automations/:automationId', authenticateClient, (req, res) => {
  try {
    const { automationId } = req.params;
    const clientId = req.clientId;

    // Verify automation belongs to client
    const automations = automationMarketplace.getClientAutomations(clientId);
    const automation = automations.find(a => a.id === automationId);

    if (!automation) {
      return res.status(404).json({ success: false, error: 'Automation not found' });
    }

    const success = automationMarketplace.deactivateAutomation(automationId);
    res.json({ success, message: 'Automation deactivated' });
  } catch (error) {
    logger.error('Error deactivating automation', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/automations/my', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const automations = automationMarketplace.getClientAutomations(clientId);
    res.json({ success: true, automations });
  } catch (error) {
    logger.error('Error fetching client automations', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/automations/stats', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const stats = automationMarketplace.getAutomationStats(clientId);
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('Error fetching automation stats', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// Setup Wizard Endpoints
app.post('/setup/start', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const { businessType } = req.body;

    const result = setupWizard.startSetup(clientId, businessType);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Error starting setup wizard', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/setup/step', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const { userInput, userChoice } = req.body;

    const result = setupWizard.processStep(clientId, userInput, userChoice);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Error processing setup step', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/setup/status', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const status = setupWizard.getSetupStatus(clientId);
    res.json({ success: true, status });
  } catch (error) {
    logger.error('Error getting setup status', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// Audit Logs and Message History Endpoints
app.get('/audit/logs', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const { limit, eventType } = req.query;

    const logs = auditLogger.getAuditLogs(clientId, parseInt(limit) || 100, eventType);
    res.json({ success: true, logs });
  } catch (error) {
    logger.error('Error fetching audit logs', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/messages/history', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const { limit, direction, dateFrom, dateTo } = req.query;

    const messages = auditLogger.getMessageHistory(
      clientId,
      parseInt(limit) || 100,
      direction,
      dateFrom,
      dateTo
    );
    res.json({ success: true, messages });
  } catch (error) {
    logger.error('Error fetching message history', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/messages/stats', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const { dateFrom, dateTo } = req.query;

    const stats = auditLogger.getMessageStats(clientId, dateFrom, dateTo);
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('Error fetching message stats', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/messages/export', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const { format, dateFrom, dateTo } = req.query;

    const data = auditLogger.exportMessageHistory(clientId, format || 'json', dateFrom, dateTo);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="messages-${clientId}.csv"`);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="messages-${clientId}.json"`);
    }

    res.send(data);
  } catch (error) {
    logger.error('Error exporting message history', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/audit/stats', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const { dateFrom, dateTo } = req.query;

    const stats = auditLogger.getAuditStats(clientId, dateFrom, dateTo);
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('Error fetching audit stats', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// Message Templates and Campaigns Endpoints
app.get('/templates', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const { businessType } = req.query;

    // Get standard templates
    const templates = messageTemplates.getTemplates(businessType);

    // Get custom templates
    const customTemplates = messageTemplates.getCustomTemplates(clientId);

    res.json({
      success: true,
      templates: { ...templates, ...customTemplates },
      businessType: businessType || 'general'
    });
  } catch (error) {
    logger.error('Error fetching templates', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/templates/custom', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const { templateId, template } = req.body;

    if (!templateId || !template) {
      return res.status(400).json({ success: false, error: 'Template ID and template data required' });
    }

    messageTemplates.addCustomTemplate(clientId, templateId, template);
    res.json({ success: true, message: 'Custom template added' });
  } catch (error) {
    logger.error('Error adding custom template', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/templates/custom/:templateId', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const { templateId } = req.params;

    const deleted = messageTemplates.deleteCustomTemplate(clientId, templateId);
    if (deleted) {
      res.json({ success: true, message: 'Custom template deleted' });
    } else {
      res.status(404).json({ success: false, error: 'Template not found' });
    }
  } catch (error) {
    logger.error('Error deleting custom template', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/templates/render', authenticateClient, (req, res) => {
  try {
    const { template, variables } = req.body;

    if (!template) {
      return res.status(400).json({ success: false, error: 'Template required' });
    }

    const rendered = messageTemplates.renderTemplate(template, variables);
    res.json({ success: true, rendered });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Campaigns endpoints
app.post('/campaigns', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const campaignData = req.body;

    const campaign = campaignManager.createCampaign(clientId, campaignData);
    res.json({ success: true, campaign });
  } catch (error) {
    logger.error('Error creating campaign', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/campaigns', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const { status } = req.query;

    const campaigns = campaignManager.getClientCampaigns(clientId, status);
    res.json({ success: true, campaigns });
  } catch (error) {
    logger.error('Error fetching campaigns', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/campaigns/:campaignId/start', authenticateClient, (req, res) => {
  try {
    const { campaignId } = req.params;
    const clientId = req.clientId;

    // Verify campaign belongs to client
    const campaign = campaignManager.getCampaign(campaignId);
    if (!campaign || campaign.clientId !== clientId) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const updatedCampaign = campaignManager.startCampaign(campaignId);
    res.json({ success: true, campaign: updatedCampaign });
  } catch (error) {
    logger.error('Error starting campaign', { campaignId: req.params.campaignId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/campaigns/:campaignId/stop', authenticateClient, (req, res) => {
  try {
    const { campaignId } = req.params;
    const clientId = req.clientId;

    // Verify campaign belongs to client
    const campaign = campaignManager.getCampaign(campaignId);
    if (!campaign || campaign.clientId !== clientId) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const updatedCampaign = campaignManager.stopCampaign(campaignId);
    res.json({ success: true, campaign: updatedCampaign });
  } catch (error) {
    logger.error('Error stopping campaign', { campaignId: req.params.campaignId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/campaigns/analytics', authenticateClient, (req, res) => {
  try {
    const clientId = req.clientId;
    const { campaignId } = req.query;

    const analytics = campaignManager.getCampaignAnalytics(clientId, campaignId);
    res.json({ success: true, analytics });
  } catch (error) {
    logger.error('Error fetching campaign analytics', { clientId: req.clientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// Client-Specific Endpoints (for client dashboards)
app.get('/client/my/qr', authenticateClient, (req, res) => {
  const clientId = req.clientId;

  // Check if client needs re-authentication
  const clientData = clients.get(clientId);
  if (clientData.status === 'needs_reauth') {
    logger.info('Reinitializing client for re-authentication', { clientId });

    try {
      // Destroy the old client if it exists
      if (clientData.client && typeof clientData.client.destroy === 'function') {
        clientData.client.destroy();
      }

      // Create a new client instance
      const newClient = createClient(clientId);
      clientData.client = newClient;
      clientData.status = 'initializing';
      clientData.error = null;
      clients.set(clientId, clientData);

      // Initialize the new client
      newClient.initialize().then(() => {
        logger.success('Client reinitialized for re-authentication', { clientId });
      }).catch((error) => {
        logger.error('Failed to reinitialize client', { clientId, error: error.message });
        clientData.status = 'error';
        clientData.error = error.message;
        clients.set(clientId, clientData);
        saveClientsToFile();
      });

      return res.json({
        success: false,
        message: 'Reinitializing client for re-authentication. Please check again in a few seconds.'
      });
    } catch (error) {
      logger.error('Error reinitializing client', { clientId, error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to reinitialize client' });
    }
  }

  const qrData = qrCodes.get(clientId);
  if (!qrData) {
    logger.info('QR code not available', { clientId });
    return res.json({
      success: false,
      message: 'QR code not available. Client may be connected or still initializing.'
    });
  }

  res.json({ success: true, qr: qrData.qr, raw: qrData.raw });
});

app.get('/client/my/status', authenticateClient, (req, res) => {
  const clientId = req.clientId;

  if (!clients.has(clientId)) {
    return res.status(404).json({ success: false, error: 'Client not found' });
  }

  const clientData = clients.get(clientId);
  const client = clientData.client;

  let status = clientData.status || 'unknown';
  let info = null;
  let error = clientData.error || null;

  // Try to get more detailed status from client
  try {
    if (client && client.info && client.info.wid) {
      status = 'connected';
      info = client.info;
    } else if (qrCodes.has(clientId)) {
      status = 'waiting_for_qr';
    }
  } catch (e) {
    console.error(`Error getting client status for ${clientId}:`, e);
  }

  res.json({
    success: true,
    clientId,
    status,
    info,
    error,
    createdAt: clientData.createdAt,
    connectedAt: clientData.connectedAt
  });
});

app.post('/client/my/send', authenticateClient, async (req, res) => {
  const clientId = req.clientId;
  const { to, message } = req.body;

  if (!to || !message) {
    logger.warn('Message send failed: missing parameters', { clientId });
    return res.status(400).json({ success: false, error: 'Recipient and message required' });
  }

  if (!clients.has(clientId)) {
    logger.warn('Message send failed: client not found', { clientId });
    return res.status(404).json({ success: false, error: 'Client not found' });
  }

  const clientData = clients.get(clientId);
  const client = clientData.client;

  if (!client) {
    logger.warn('Message send failed: client not initialized', { clientId });
    return res.status(400).json({ success: false, error: 'Client not initialized' });
  }

  try {
    // Use anti-ban protection for message sending
    const result = await antiBan.queueMessage(clientId, to, message, async (recipient, msg) => {
      const sendResult = await client.sendMessage(recipient, msg);

      // Update client activity and metrics
      clientData.lastActivity = Date.now();
      clientData.messageCount = (clientData.messageCount || 0) + 1;
      clients.set(clientId, clientData);

      logger.updateMetrics({
        messagesSent: logger.metrics.messagesSent + 1
      });

      // Log message
      auditLogger.logMessage(clientId, 'outbound', recipient, client.info?.wid?.user || clientId, msg, 'sent', {
        messageId: sendResult.id.id
      });

      return sendResult;
    });

    logger.success('Client message sent successfully', { clientId, to, messageId: result.id.id });
    res.json({ success: true, messageId: result.id.id });
  } catch (error) {
    logger.error('Error sending client message', { clientId, error: error.message });
    logger.updateMetrics({
      messagesFailed: logger.metrics.messagesFailed + 1
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

// Static files
app.use(express.static('public'));

// Initialize health checker
healthChecker = new HealthChecker(logger, clients, qrCodes);

// Initialize automation marketplace
const automationMarketplace = new AutomationMarketplace(logger);

// Initialize setup wizard
const setupWizard = new SetupWizard(logger, clients, qrCodes, automationMarketplace);

// Initialize audit logger
const auditLogger = new AuditLogger(logger);

// Initialize message templates and campaign manager
const messageTemplates = new MessageTemplates(logger);
const campaignManager = new CampaignManager(logger, auditLogger);

// Load existing clients on startup
logger.info('Loading existing clients from database');
const loadedClients = loadClientsFromFile();
logger.success('Clients loaded from database', { count: loadedClients });

// Clean old logs periodically
setInterval(() => {
  logger.cleanOldLogs();
  setupWizard.cleanupOldSessions();
  auditLogger.cleanOldHistory();
  campaignManager.cleanupOldCampaigns();
}, 24 * 60 * 60 * 1000); // Daily

// Start server
app.listen(PORT, () => {
  logger.success('WhatsApp Service started', {
    port: PORT,
    dashboard: `http://localhost:${PORT}/dashboard.html`,
    api: `http://localhost:${PORT}/health`,
    metrics: `http://localhost:${PORT}/metrics`
  });
});