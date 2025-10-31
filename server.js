require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store clients in memory (in production, use database)
const clients = new Map();
const qrCodes = new Map();

// Create sessions directory
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

// Initialize WhatsApp client for a tenant
function createClient(clientId) {
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: clientId,
      dataPath: path.join(sessionsDir, clientId)
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    }
  });

  // Client events
  client.on('qr', async (qr) => {
    console.log(`QR Code generated for client ${clientId}`);
    try {
      // Generate QR code as data URL
      const qrDataURL = await qrcode.toDataURL(qr);
      qrCodes.set(clientId, {
        qr: qrDataURL,
        raw: qr,
        timestamp: Date.now()
      });
      console.log(`QR Code stored for client ${clientId}`);
    } catch (error) {
      console.error(`Error generating QR code for ${clientId}:`, error);
    }
  });

  client.on('ready', () => {
    console.log(`WhatsApp client ${clientId} is ready!`);
    qrCodes.delete(clientId); // Remove QR code once connected
  });

  client.on('authenticated', () => {
    console.log(`Client ${clientId} authenticated successfully`);
  });

  client.on('auth_failure', (msg) => {
    console.error(`Authentication failed for ${clientId}:`, msg);
  });

  client.on('disconnected', (reason) => {
    console.log(`Client ${clientId} disconnected:`, reason);
    qrCodes.delete(clientId);
  });

  client.on('message', async (message) => {
    console.log(`Message from ${message.from}: ${message.body}`);

    // Forward to webhook if configured
    // You can add webhook forwarding here
  });

  return client;
}

// API Routes

// Create new client
app.post('/client/create', async (req, res) => {
  try {
    const { clientId } = req.body;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: 'clientId is required'
      });
    }

    if (clients.has(clientId)) {
      return res.status(400).json({
        success: false,
        error: 'Client already exists'
      });
    }

    const client = createClient(clientId);
    clients.set(clientId, {
      client,
      status: 'initializing',
      createdAt: new Date()
    });

    // Initialize the client
    await client.initialize();

    res.json({
      success: true,
      clientId,
      message: 'Client created and initializing'
    });

  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get QR code for client
app.get('/client/:clientId/qr', (req, res) => {
  const { clientId } = req.params;

  if (!clients.has(clientId)) {
    return res.status(404).json({
      success: false,
      error: 'Client not found'
    });
  }

  const qrData = qrCodes.get(clientId);
  if (!qrData) {
    return res.json({
      success: false,
      message: 'QR code not available. Client may already be connected or still initializing.',
      status: 'waiting'
    });
  }

  res.json({
    success: true,
    qr: qrData.qr,
    raw: qrData.raw,
    timestamp: qrData.timestamp
  });
});

// Get client status
app.get('/client/:clientId/status', (req, res) => {
  const { clientId } = req.params;

  if (!clients.has(clientId)) {
    return res.status(404).json({
      success: false,
      error: 'Client not found'
    });
  }

  const clientData = clients.get(clientId);
  const client = clientData.client;

  let status = 'unknown';
  if (client.info && client.info.wid) {
    status = 'connected';
  } else if (qrCodes.has(clientId)) {
    status = 'waiting_for_qr';
  } else {
    status = 'initializing';
  }

  res.json({
    success: true,
    clientId,
    status,
    info: client.info || null,
    createdAt: clientData.createdAt
  });
});

// Send message
app.post('/client/:clientId/send', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { to, message, media } = req.body;

    if (!clients.has(clientId)) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    const clientData = clients.get(clientId);
    const client = clientData.client;

    if (!client.info || !client.info.wid) {
      return res.status(400).json({
        success: false,
        error: 'Client not connected'
      });
    }

    let messageResult;

    if (media) {
      // Send media message
      const mediaMessage = MessageMedia.fromFilePath(media.path);
      messageResult = await client.sendMessage(to, mediaMessage, { caption: message });
    } else {
      // Send text message
      messageResult = await client.sendMessage(to, message);
    }

    res.json({
      success: true,
      messageId: messageResult.id.id,
      timestamp: messageResult.timestamp
    });

  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// List all clients
app.get('/clients', (req, res) => {
  const clientList = Array.from(clients.entries()).map(([clientId, clientData]) => {
    const client = clientData.client;
    let status = 'unknown';

    if (client.info && client.info.wid) {
      status = 'connected';
    } else if (qrCodes.has(clientId)) {
      status = 'waiting_for_qr';
    } else {
      status = 'initializing';
    }

    return {
      clientId,
      status,
      createdAt: clientData.createdAt,
      hasQR: qrCodes.has(clientId)
    };
  });

  res.json({
    success: true,
    clients: clientList
  });
});

// Delete client
app.delete('/client/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;

    if (!clients.has(clientId)) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    const clientData = clients.get(clientId);
    const client = clientData.client;

    // Destroy the client
    await client.destroy();

    // Remove from memory
    clients.delete(clientId);
    qrCodes.delete(clientId);

    // Remove session files
    const sessionPath = path.join(sessionsDir, clientId);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    res.json({
      success: true,
      message: 'Client deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting client:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Dashboard route
app.get('/dashboard/:clientId?', (req, res) => {
  const { clientId } = req.params;
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    clients: clients.size,
    qrCodes: qrCodes.size
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`WhatsApp Service running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`API: http://localhost:${PORT}/health`);
});

module.exports = app;