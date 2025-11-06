#!/usr/bin/env node

/**
 * WhatsApp Service v2.0 - Main Server
 * 
 * Integrated Components:
 * - PostgreSQL Database (db.js)
 * - Advanced Anti-Ban System (anti-ban.js)
 * - Media Manager (media-manager.js)
 * - Webhook System (webhook-manager.js)
 * - Team Management (team-manager.js)
 * - Analytics Engine (analytics-manager.js)
 * - Structured Logging (logger.js)
 */

require('dotenv').config();
const express = require('express');
const { Client, LocalAuth, MessageMedia, Events } = require('whatsapp-web.js');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

// Import custom modules
const logger = require('./logger');
const db = require('./db');
const AdvancedAntiBanManager = require('./anti-ban');
const MediaManager = require('./media-manager');
const WebhookManager = require('./webhook-manager');
const TeamManager = require('./team-manager');
const AnalyticsManager = require('./analytics-manager');

// ============================================================================
// INITIALIZATION
// ============================================================================

const app = express();
const PORT = process.env.PORT || 3002;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Initialize managers
let antiBanManager;
let mediaManager;
let webhookManager;
let teamManager;
let analyticsManager;

// Store active WhatsApp clients
const clients = new Map();

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Security headers
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || '*',
  credentials: true
}));

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Rate limiting (global)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

/**
 * Verify API Key
 */
const verifyApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    const userResult = await teamManager.verifyApiKey(apiKey);
    if (!userResult) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    req.user = userResult;
    next();
  } catch (error) {
    logger.error('API Key verification failed:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};

/**
 * Check organization access
 */
const checkOrgAccess = async (req, res, next) => {
  try {
    const orgId = req.body.org_id || req.params.org_id || req.query.org_id;
    
    if (!orgId) {
      return res.status(400).json({ error: 'Organization ID required' });
    }

    // Verify user has access to this organization
    const result = await db.query(
      'SELECT * FROM users WHERE id = $1 AND organization_id = $2',
      [req.user.id, orgId]
    );

    if (result.rows.length === 0 && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    req.org_id = orgId;
    next();
  } catch (error) {
    logger.error('Organization access check failed:', error);
    res.status(500).json({ error: 'Authorization error' });
  }
};

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', async (req, res) => {
  try {
    // Check database connection
    const dbCheck = await db.query('SELECT NOW()');
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbCheck ? 'connected' : 'disconnected',
      activeClients: clients.size,
      environment: NODE_ENV
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// ============================================================================
// AUTHENTICATION ENDPOINTS
// ============================================================================

/**
 * User Registration
 * POST /api/auth/register
 */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, organization_name } = req.body;

    // Validate input
    if (!email || !password || !name || !organization_name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user exists
    const existing = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Create organization
    const orgResult = await db.query(
      'INSERT INTO organizations (name, plan, created_at) VALUES ($1, $2, NOW()) RETURNING id',
      [organization_name, 'starter']
    );

    const orgId = orgResult.rows[0].id;

    // Create user
    const user = await teamManager.createUser(
      email,
      password,
      name,
      orgId,
      'admin'
    );

    logger.info(`New user registered: ${email}`);
    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        organization_id: orgId
      }
    });
  } catch (error) {
    logger.error('Registration failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * User Login
 * POST /api/auth/login
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await teamManager.authenticateUser(email, password);

    if (!result) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    logger.info(`User logged in: ${email}`);
    res.json({
      message: 'Login successful',
      token: result.token,
      user: result.user
    });
  } catch (error) {
    logger.error('Login failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CLIENT MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * Create WhatsApp Client
 * POST /api/clients
 */
app.post('/api/clients', verifyApiKey, checkOrgAccess, async (req, res) => {
  try {
    const { name, phone_number } = req.body;

    if (!name || !phone_number) {
      return res.status(400).json({ error: 'Name and phone number required' });
    }

    // Store client in database
    const result = await db.query(
      `INSERT INTO whatsapp_clients 
       (organization_id, name, phone_number, status, created_at) 
       VALUES ($1, $2, $3, $4, NOW()) 
       RETURNING id, name, phone_number, status`,
      [req.org_id, name, phone_number, 'initializing']
    );

    const clientId = result.rows[0].id;
    logger.info(`Client created: ${clientId} - ${name}`);

    res.status(201).json({
      message: 'Client created successfully',
      client: result.rows[0]
    });
  } catch (error) {
    logger.error('Client creation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get Client Status
 * GET /api/clients/:clientId/status
 */
app.get('/api/clients/:clientId/status', verifyApiKey, async (req, res) => {
  try {
    const { clientId } = req.params;

    const result = await db.query(
      'SELECT id, name, status, phone_number, device_info FROM whatsapp_clients WHERE id = $1',
      [clientId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const client = result.rows[0];
    res.json({
      id: client.id,
      name: client.name,
      status: client.status,
      phoneNumber: client.phone_number,
      deviceInfo: client.device_info
    });
  } catch (error) {
    logger.error('Status check failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Initialize WhatsApp Session
 * POST /api/clients/:clientId/init
 */
app.post('/api/clients/:clientId/init', verifyApiKey, async (req, res) => {
  try {
    const { clientId } = req.params;

    // Get client details
    const clientResult = await db.query(
      'SELECT * FROM whatsapp_clients WHERE id = $1',
      [clientId]
    );

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const clientData = clientResult.rows[0];

    // Check if client already initialized
    if (clients.has(clientId)) {
      return res.json({
        message: 'Client already initialized',
        status: 'ready'
      });
    }

    // Create WhatsApp client with anti-ban protection
    const browserProfile = antiBanManager.generateBrowserProfile();
    const proxy = await antiBanManager.getAvailableProxy();

    const puppeteerArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      `--user-agent=${browserProfile.userAgent}`,
    ];

    if (proxy) {
      puppeteerArgs.push(`--proxy-server=${proxy.host}:${proxy.port}`);
    }

    const sessionDir = path.join(__dirname, 'sessions', `session-${clientId}`);
    fs.mkdirSync(sessionDir, { recursive: true });

    const whatsappClient = new Client({
      authStrategy: new LocalAuth({ clientId: `client-${clientId}` }),
      puppeteer: {
        args: puppeteerArgs,
        headless: true
      }
    });

    // Apply browser fingerprinting
    whatsappClient.on('page_ready', async (page) => {
      await antiBanManager.applyBrowserFingerprinting(page);
      logger.info(`Browser fingerprinting applied for client ${clientId}`);
    });

    // Handle client ready
    whatsappClient.on('ready', async () => {
      logger.info(`WhatsApp client ready: ${clientId}`);
      
      // Update database
      await db.query(
        'UPDATE whatsapp_clients SET status = $1, last_connected = NOW() WHERE id = $2',
        ['ready', clientId]
      );

      // Record event
      await analyticsManager.recordMessageMetric(
        clientData.organization_id,
        clientId,
        'client_connected'
      );

      // Trigger webhook
      await webhookManager.triggerEvent(
        clientData.organization_id,
        'client.connected',
        { clientId, timestamp: new Date() }
      );
    });

    // Handle incoming messages
    whatsappClient.on('message', async (msg) => {
      try {
        logger.info(`Message received on ${clientId}: ${msg.body}`);

        // Store message in database
        const msgResult = await db.query(
          `INSERT INTO messages 
           (organization_id, client_id, contact_id, message_text, direction, status, received_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           RETURNING id`,
          [
            clientData.organization_id,
            clientId,
            msg.from,
            msg.body,
            'inbound',
            'received'
          ]
        );

        // Record analytics
        await analyticsManager.recordMessageMetric(
          clientData.organization_id,
          clientId,
          'message_received'
        );

        // Trigger webhook
        await webhookManager.triggerEvent(
          clientData.organization_id,
          'message.received',
          {
            clientId,
            messageId: msgResult.rows[0].id,
            from: msg.from,
            body: msg.body,
            timestamp: new Date()
          }
        );

      } catch (error) {
        logger.error(`Error handling message on ${clientId}:`, error);
      }
    });

    // Handle errors
    whatsappClient.on('disconnected', async () => {
      logger.warn(`Client disconnected: ${clientId}`);
      clients.delete(clientId);

      // Update database
      await db.query(
        'UPDATE whatsapp_clients SET status = $1 WHERE id = $2',
        ['disconnected', clientId]
      );

      // Trigger webhook
      await webhookManager.triggerEvent(
        clientData.organization_id,
        'client.disconnected',
        { clientId, timestamp: new Date() }
      );
    });

    whatsappClient.on('auth_failure', async (msg) => {
      logger.error(`Auth failure for ${clientId}: ${msg}`);
      
      // Record ban alert
      await db.query(
        `INSERT INTO ban_alerts (client_id, reason, detected_at)
         VALUES ($1, $2, NOW())`,
        [clientId, msg]
      );
    });

    // Initialize client
    clients.set(clientId, {
      instance: whatsappClient,
      data: clientData,
      antiban: antiBanManager,
      media: mediaManager,
      createdAt: new Date()
    });

    await whatsappClient.initialize();

    res.json({
      message: 'Client initialization started',
      clientId,
      status: 'initializing'
    });

  } catch (error) {
    logger.error('Client initialization failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// MESSAGE ENDPOINTS
// ============================================================================

/**
 * Send Message
 * POST /api/clients/:clientId/send-message
 */
app.post('/api/clients/:clientId/send-message', verifyApiKey, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { to, message, media, mediaUrl } = req.body;

    if (!to || (!message && !media && !mediaUrl)) {
      return res.status(400).json({ error: 'Phone number and message/media required' });
    }

    const clientWrapper = clients.get(clientId);
    if (!clientWrapper) {
      return res.status(404).json({ error: 'Client not found or not ready' });
    }

    const { instance: client, data: clientData, antiban } = clientWrapper;

    // Check rate limits
    const rateLimitCheck = antiBanManager.canSendMessage(clientId);
    if (!rateLimitCheck.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        details: rateLimitCheck
      });
    }

    // Apply human behavior simulation
    await antiban.simulateHumanBehavior();

    let messageId;
    const sendResult = await db.query(
      `INSERT INTO messages 
       (organization_id, client_id, contact_id, message_text, direction, status, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id`,
      [
        clientData.organization_id,
        clientId,
        to,
        message || '[Media]',
        'outbound',
        'sending'
      ]
    );

    messageId = sendResult.rows[0].id;

    try {
      // Send media or text
      if (media || mediaUrl) {
        let messageMedia;
        if (media) {
          const buffer = Buffer.from(media, 'base64');
          messageMedia = new MessageMedia('image/jpeg', buffer.toString('base64'));
        } else {
          messageMedia = await MessageMedia.fromUrl(mediaUrl);
        }
        
        // Use media manager
        await mediaManager.sendImageMessage(client, to, messageMedia);
      } else {
        await client.sendMessage(to + '@c.us', message);
      }

      // Update message status
      await db.query(
        'UPDATE messages SET status = $1, sent_at = NOW() WHERE id = $2',
        ['sent', messageId]
      );

      // Record analytics
      await analyticsManager.recordMessageMetric(
        clientData.organization_id,
        clientId,
        'message_sent'
      );

      // Trigger webhook
      await webhookManager.triggerEvent(
        clientData.organization_id,
        'message.sent',
        {
          messageId,
          clientId,
          to,
          timestamp: new Date()
        }
      );

      logger.info(`Message sent: ${messageId}`);
      res.json({
        message: 'Message sent successfully',
        messageId
      });

    } catch (sendError) {
      logger.error(`Failed to send message ${messageId}:`, sendError);

      // Update status to failed
      await db.query(
        'UPDATE messages SET status = $1, error_message = $2 WHERE id = $3',
        ['failed', sendError.message, messageId]
      );

      // Detect suspicious activity
      await antiban.detectSuspiciousActivity(clientId, 'send_failure');

      res.status(500).json({
        error: 'Failed to send message',
        details: sendError.message,
        messageId
      });
    }

  } catch (error) {
    logger.error('Send message failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get Message History
 * GET /api/clients/:clientId/messages
 */
app.get('/api/clients/:clientId/messages', verifyApiKey, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { limit = 50, offset = 0, contact } = req.query;

    let query = 'SELECT * FROM messages WHERE client_id = $1';
    let params = [clientId];
    let paramIndex = 2;

    if (contact) {
      query += ` AND contact_id = $${paramIndex}`;
      params.push(contact);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    res.json({
      messages: result.rows,
      count: result.rows.length,
      total: result.rows.length
    });
  } catch (error) {
    logger.error('Message history fetch failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// TEAM MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * Create Team Member
 * POST /api/team/members
 */
app.post('/api/team/members', verifyApiKey, checkOrgAccess, async (req, res) => {
  try {
    const { email, password, name, role } = req.body;

    // Verify user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can create users' });
    }

    const user = await teamManager.createUser(
      email,
      password,
      name,
      req.org_id,
      role || 'agent'
    );

    logger.info(`Team member created: ${email}`);
    res.status(201).json({
      message: 'Team member created',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    logger.error('Team member creation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Assign Client to Team Member
 * POST /api/team/members/:userId/clients/:clientId
 */
app.post('/api/team/members/:userId/clients/:clientId', verifyApiKey, checkOrgAccess, async (req, res) => {
  try {
    const { userId, clientId } = req.params;

    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    await teamManager.assignClientToMember(userId, clientId, req.org_id);

    logger.info(`Client ${clientId} assigned to user ${userId}`);
    res.json({ message: 'Client assigned successfully' });
  } catch (error) {
    logger.error('Client assignment failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get Audit Logs
 * GET /api/audit-logs
 */
app.get('/api/audit-logs', verifyApiKey, checkOrgAccess, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;

    const logs = await teamManager.getAuditLogs(req.org_id, limit, offset);

    res.json({
      logs,
      count: logs.length
    });
  } catch (error) {
    logger.error('Audit logs fetch failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// WEBHOOK ENDPOINTS
// ============================================================================

/**
 * Register Webhook
 * POST /api/webhooks
 */
app.post('/api/webhooks', verifyApiKey, checkOrgAccess, async (req, res) => {
  try {
    const { url, events } = req.body;

    if (!url || !events) {
      return res.status(400).json({ error: 'URL and events required' });
    }

    const webhook = await webhookManager.registerWebhook(
      req.org_id,
      url,
      events
    );

    logger.info(`Webhook registered for ${url}`);
    res.status(201).json({
      message: 'Webhook registered',
      webhook: {
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        secret: webhook.secret
      }
    });
  } catch (error) {
    logger.error('Webhook registration failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get Webhooks
 * GET /api/webhooks
 */
app.get('/api/webhooks', verifyApiKey, checkOrgAccess, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, url, events, active, created_at FROM webhooks WHERE organization_id = $1 AND deleted_at IS NULL',
      [req.org_id]
    );

    res.json({ webhooks: result.rows });
  } catch (error) {
    logger.error('Webhooks fetch failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Test Webhook
 * POST /api/webhooks/:webhookId/test
 */
app.post('/api/webhooks/:webhookId/test', verifyApiKey, async (req, res) => {
  try {
    const { webhookId } = req.params;

    const result = await webhookManager.testWebhook(webhookId);

    res.json({
      message: 'Test sent',
      result
    });
  } catch (error) {
    logger.error('Webhook test failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ANALYTICS ENDPOINTS
// ============================================================================

/**
 * Get Organization Stats
 * GET /api/analytics/stats
 */
app.get('/api/analytics/stats', verifyApiKey, checkOrgAccess, async (req, res) => {
  try {
    const stats = await analyticsManager.getOrganizationStats(req.org_id);

    res.json(stats);
  } catch (error) {
    logger.error('Analytics fetch failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get Message Metrics
 * GET /api/analytics/metrics
 */
app.get('/api/analytics/metrics', verifyApiKey, checkOrgAccess, async (req, res) => {
  try {
    const { startDate, endDate, clientId } = req.query;

    const metrics = await analyticsManager.getMetricsRange(
      req.org_id,
      clientId,
      new Date(startDate),
      new Date(endDate)
    );

    res.json({ metrics });
  } catch (error) {
    logger.error('Metrics fetch failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Export Campaign Report
 * GET /api/analytics/campaigns/:campaignId/export
 */
app.get('/api/analytics/campaigns/:campaignId/export', verifyApiKey, async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { format = 'csv' } = req.query;

    const csv = await analyticsManager.exportCampaignReport(campaignId, format);

    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', `attachment; filename=campaign-${campaignId}.csv`);
    res.send(csv);
  } catch (error) {
    logger.error('Export failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// MEDIA ENDPOINTS
// ============================================================================

/**
 * Upload Media
 * POST /api/media/upload
 */
app.post('/api/media/upload', verifyApiKey, checkOrgAccess, async (req, res) => {
  try {
    const { file, organizationId } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'File required' });
    }

    const media = await mediaManager.uploadFile(
      Buffer.from(file, 'base64'),
      organizationId
    );

    logger.info(`Media uploaded: ${media.id}`);
    res.status(201).json({
      message: 'Media uploaded',
      media
    });
  } catch (error) {
    logger.error('Media upload failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Download Media
 * GET /api/media/:mediaId/download
 */
app.get('/api/media/:mediaId/download', verifyApiKey, async (req, res) => {
  try {
    const { mediaId } = req.params;

    await mediaManager.streamFileToResponse(mediaId, res);
  } catch (error) {
    logger.error('Media download failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get Storage Usage
 * GET /api/analytics/storage
 */
app.get('/api/analytics/storage', verifyApiKey, checkOrgAccess, async (req, res) => {
  try {
    const usage = await mediaManager.getStorageUsage(req.org_id);

    res.json(usage);
  } catch (error) {
    logger.error('Storage check failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// DASHBOARD STATIC FILES
// ============================================================================

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ============================================================================
// 404 HANDLER
// ============================================================================

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ============================================================================
// ERROR HANDLER
// ============================================================================

app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: NODE_ENV === 'development' ? err.message : undefined
  });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

async function initializeManagers() {
  try {
    logger.info('Initializing managers...');

    // Initialize database
    await db.query('SELECT NOW()'); // Test connection
    logger.success('Database connected');

    // Initialize managers
    antiBanManager = new AdvancedAntiBanManager();
    mediaManager = new MediaManager();
    webhookManager = new WebhookManager();
    teamManager = new TeamManager();
    analyticsManager = new AnalyticsManager();

    logger.success('All managers initialized');
  } catch (error) {
    logger.error('Manager initialization failed:', error);
    process.exit(1);
  }
}

async function startServer() {
  try {
    await initializeManagers();

    const server = http.createServer(app);

    server.listen(PORT, () => {
      logger.success(`WhatsApp Service v2.0 started on port ${PORT}`);
      logger.info(`Environment: ${NODE_ENV}`);
      logger.info(`Dashboard: http://localhost:${PORT}/dashboard.html`);
      logger.info(`API Base: http://localhost:${PORT}/api`);
      logger.info(`Health Check: http://localhost:${PORT}/health`);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down gracefully...');
      
      // Close all WhatsApp clients
      for (const [clientId, wrapper] of clients.entries()) {
        try {
          await wrapper.instance.destroy();
          logger.info(`Client ${clientId} closed`);
        } catch (error) {
          logger.error(`Error closing client ${clientId}:`, error);
        }
      }

      server.close(() => {
        logger.success('Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error('Server startup failed:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

module.exports = app;
