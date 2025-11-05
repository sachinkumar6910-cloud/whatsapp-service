# WhatsApp Service - Complete Working Documentation

## 📋 Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Components](#core-components)
4. [How It Works](#how-it-works)
5. [API Endpoints](#api-endpoints)
6. [Integration Guide](#integration-guide)
7. [Message Flow](#message-flow)
8. [Security & Anti-Ban](#security--anti-ban)
9. [Troubleshooting](#troubleshooting)

---

## Overview

This is a **multi-tenant WhatsApp Web API service** that allows multiple clients to connect their WhatsApp accounts and send/receive messages programmatically through a REST API.

### Key Features
- ✅ Multiple WhatsApp accounts (multi-tenant)
- ✅ Real WhatsApp Web QR code authentication
- ✅ Send messages via REST API
- ✅ Anti-ban protection with rate limiting
- ✅ Message queuing and audit logging
- ✅ Session persistence (reconnects automatically)
- ✅ Health monitoring and metrics
- ✅ Campaign management
- ✅ Message templates
- ✅ Automation marketplace

### Tech Stack
- **Backend**: Node.js + Express
- **WhatsApp**: `whatsapp-web.js` (uses Puppeteer + Chrome)
- **Storage**: In-memory + File-based persistence
- **Frontend**: Vanilla HTML/CSS/JS dashboard

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Your Application                      │
│            (Makes REST API calls)                        │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ HTTP/REST API
                     ▼
┌─────────────────────────────────────────────────────────┐
│              WhatsApp Service (Node.js)                  │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Express API  │  │ Client Store │  │ QR Code Store│ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                  │                  │          │
│         └─────────┬────────┴──────────────────┘          │
│                   ▼                                      │
│  ┌────────────────────────────────────────────────────┐ │
│  │         WhatsApp Web.js Client Manager             │ │
│  │  (Manages multiple WhatsApp client instances)      │ │
│  └────────────────────┬───────────────────────────────┘ │
│                       │                                  │
└───────────────────────┼──────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Puppeteer   │ │  Puppeteer   │ │  Puppeteer   │
│  (Chrome)    │ │  (Chrome)    │ │  (Chrome)    │
│  Client 1    │ │  Client 2    │ │  Client N    │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────────┼────────────────┘
                        ▼
            ┌───────────────────────┐
            │  WhatsApp Web Servers │
            │   (web.whatsapp.com)  │
            └───────────────────────┘
```

---

## Core Components

### 1. **simple-server.js** (Main Server)
The primary server file that orchestrates everything.

**Key Responsibilities:**
- Express server setup and middleware
- Client creation and management
- Message sending/receiving
- QR code generation and storage
- API endpoint handling
- Session recovery

**Important Variables:**
```javascript
const clients = new Map();     // Stores all WhatsApp client instances
const qrCodes = new Map();     // Stores QR codes temporarily
```

### 2. **monitoring.js** (Monitoring System)
Handles logging, health checks, and anti-ban protection.

**Classes:**
- `Logger`: Structured logging with colors and metrics
- `SessionRecoveryManager`: Auto-reconnects disconnected clients
- `HealthChecker`: System health monitoring
- `AntiBanManager`: Rate limiting and message queuing

**Anti-Ban Features:**
```javascript
// Queues messages with delays to prevent WhatsApp bans
antiBan.queueMessage(clientId, recipient, message, sendFunction)

// Random delays: 2-5 seconds between messages
// Daily message limits: 1000 per client
// Hourly limits: 100 per client
```

### 3. **audit-logger.js** (Audit Logging)
Logs all activities for compliance and debugging.

**Tracks:**
- Message sent/received
- API access logs
- System events
- Client connections/disconnections

### 4. **automations.js** (Automation Marketplace)
Pre-built automation templates for common use cases.

**Available Automations:**
- Auto-reply messages
- Welcome messages for new contacts
- Away messages (business hours)
- Lead qualification flows
- Order status updates
- Appointment reminders
- Feedback collection

### 5. **templates.js** (Message Templates & Campaigns)
Template system for bulk messaging and campaigns.

**Features:**
- Variable substitution (e.g., `{{name}}`, `{{order_id}}`)
- Campaign creation and scheduling
- Progress tracking
- Analytics

### 6. **setup-wizard.js** (Onboarding)
Interactive setup wizard for new clients.

**Guides users through:**
1. Business type selection
2. WhatsApp connection (QR scan)
3. Automation setup
4. Template configuration

---

## How It Works

### 1. Client Creation Flow

```
User Request → POST /client/create
                    ↓
            Generate clientId
                    ↓
        Create Puppeteer instance
                    ↓
        Initialize whatsapp-web.js
                    ↓
        Store client in Map
                    ↓
        Return clientId to user
```

**Code Path:**
```javascript
// simple-server.js:509
app.post('/client/create', async (req, res) => {
  const clientId = req.body.clientId || generateClientId();
  
  const client = new Client({
    authStrategy: new LocalAuth({ clientId }),
    puppeteer: { headless: true }
  });
  
  // Setup event listeners (qr, ready, message, etc.)
  setupClientEventHandlers(client, clientId);
  
  await client.initialize();
  clients.set(clientId, { client, status: 'initializing' });
});
```

### 2. QR Code Authentication Flow

```
Client initializes → WhatsApp servers generate QR
                              ↓
                    'qr' event fires
                              ↓
                Convert QR to Data URL (image)
                              ↓
                Store in qrCodes Map
                              ↓
            User fetches via GET /client/:id/qr
                              ↓
                Display QR in UI
                              ↓
            User scans with phone
                              ↓
            WhatsApp authenticates
                              ↓
                'ready' event fires
                              ↓
            Session saved to ./sessions/
                              ↓
        Client status = 'connected'
```

**Code Path:**
```javascript
// simple-server.js:317
client.on('qr', async (qr) => {
  // This 'qr' string comes directly from WhatsApp servers
  // It's the REAL QR code, not random/fake
  
  const qrDataURL = await qrcode.toDataURL(qr);  // Convert to image
  qrCodes.set(clientId, {
    qr: qrDataURL,     // Base64 image for frontend
    raw: qr,           // Raw QR string
    timestamp: Date.now()
  });
});

// simple-server.js:341
client.on('ready', () => {
  qrCodes.delete(clientId);  // Remove QR after authentication
  // Session is now persisted in ./sessions/{clientId}/
});
```

### 3. Message Sending Flow

```
API Request → POST /client/:id/send
                    ↓
        Validate client exists
                    ↓
        Check client is connected
                    ↓
    Anti-ban: Queue message with delay
                    ↓
        client.sendMessage(to, message)
                    ↓
    WhatsApp Web protocol sends message
                    ↓
        Update metrics & audit log
                    ↓
        Return messageId to caller
```

**Code Path:**
```javascript
// simple-server.js:676
app.post('/client/:clientId/send', async (req, res) => {
  const { clientId } = req.params;
  const { to, message } = req.body;
  
  const client = clients.get(clientId).client;
  
  // Anti-ban protection wraps the send
  const result = await antiBan.queueMessage(
    clientId, 
    to, 
    message, 
    async (recipient, msg) => {
      return await client.sendMessage(recipient, msg);
    }
  );
  
  // Log to audit trail
  auditLogger.logMessage(clientId, 'outbound', to, message);
  
  res.json({ success: true, messageId: result.id.id });
});
```

### 4. Message Receiving Flow

```
WhatsApp message received → 'message' event fires
                                    ↓
                        Extract message data
                                    ↓
                        Log to audit trail
                                    ↓
                Update last activity timestamp
                                    ↓
            Check for active automations
                                    ↓
            Trigger automation if matched
```

**Code Path:**
```javascript
// simple-server.js:466
client.on('message', async (message) => {
  const contact = await message.getContact();
  
  // Log incoming message
  auditLogger.logMessage(
    clientId, 
    'inbound', 
    contact.id._serialized, 
    message.from,
    message.body
  );
  
  // Check for automations
  if (automationMarketplace.hasActiveAutomation(clientId)) {
    await automationMarketplace.processMessage(clientId, message);
  }
});
```

---

## API Endpoints

### Client Management

#### 1. Create Client
```http
POST /client/create
Content-Type: application/json

{
  "clientId": "my-whatsapp-client"  // Optional, auto-generated if not provided
}
```

**Response:**
```json
{
  "success": true,
  "clientId": "my-whatsapp-client",
  "message": "Client created successfully"
}
```

---

#### 2. Get QR Code
```http
GET /client/:clientId/qr
```

**Response:**
```json
{
  "success": true,
  "qr": "data:image/png;base64,iVBORw0KGgoAAAANS...",
  "raw": "2@xABC123..."
}
```

**Usage:**
```javascript
// Frontend code
fetch('http://localhost:3002/client/my-client/qr')
  .then(r => r.json())
  .then(data => {
    document.getElementById('qr-img').src = data.qr;
  });
```

---

#### 3. Check Client Status
```http
GET /client/:clientId/status
```

**Response:**
```json
{
  "success": true,
  "clientId": "my-whatsapp-client",
  "status": "connected",           // or "waiting_for_qr", "disconnected", "error"
  "hasQR": false,
  "info": {
    "pushname": "John Doe",
    "phone": "1234567890",
    "platform": "android"
  },
  "messageCount": 42,
  "lastActivity": 1699234567890
}
```

---

#### 4. List All Clients
```http
GET /clients
```

**Response:**
```json
{
  "success": true,
  "clients": [
    {
      "clientId": "client-1",
      "status": "connected",
      "messageCount": 100,
      "createdAt": 1699200000000
    }
  ],
  "total": 1
}
```

---

### Messaging

#### 5. Send Message
```http
POST /client/:clientId/send
Content-Type: application/json

{
  "to": "1234567890@c.us",
  "message": "Hello from API!"
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "true_1234567890@c.us_3A123ABC..."
}
```

**Phone Number Formats:**
- Individual: `"[country_code][number]@c.us"` (e.g., `"14155551234@c.us"`)
- Group: `"[group_id]@g.us"`

---

#### 6. Authenticated Send (with headers)
```http
POST /client/my/send
Content-Type: application/json
x-client-id: my-whatsapp-client
x-api-key: your-api-key-here

{
  "to": "1234567890@c.us",
  "message": "Hello!"
}
```

---

### Monitoring

#### 7. Health Check
```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": 1699234567890,
  "uptime": 86400,
  "clients": {
    "total": 5,
    "connected": 4,
    "waitingForQr": 1,
    "disconnected": 0,
    "error": 0
  },
  "qrCodes": 1,
  "system": {
    "memory": { "used": 150.5, "total": 512 },
    "cpu": { "usage": 23.5 }
  }
}
```

---

#### 8. Get Metrics
```http
GET /metrics
```

**Response:**
```json
{
  "success": true,
  "metrics": {
    "clientsCreated": 10,
    "qrCodesGenerated": 8,
    "sessionsRecovered": 2,
    "messagesSent": 1543,
    "messagesFailed": 12,
    "messagesReceived": 2341,
    "errors": 5
  }
}
```

---

### Audit & History

#### 9. Get Message History
```http
GET /messages/history?clientId=my-client&limit=50
x-client-id: my-client
```

**Response:**
```json
{
  "success": true,
  "messages": [
    {
      "timestamp": 1699234567890,
      "type": "outbound",
      "from": "my-client",
      "to": "1234567890@c.us",
      "message": "Hello!",
      "status": "sent",
      "messageId": "3A123ABC..."
    }
  ],
  "total": 1543
}
```

---

#### 10. Get Audit Logs
```http
GET /audit/logs?clientId=my-client&limit=100
x-client-id: my-client
```

---

### Templates & Campaigns

#### 11. Get Templates
```http
GET /templates
x-client-id: my-client
```

**Response:**
```json
{
  "success": true,
  "templates": [
    {
      "id": "welcome",
      "name": "Welcome Message",
      "content": "Hi {{name}}, welcome to {{business}}!",
      "variables": ["name", "business"]
    }
  ]
}
```

---

#### 12. Create Campaign
```http
POST /campaigns
Content-Type: application/json
x-client-id: my-client

{
  "name": "Black Friday Sale",
  "templateId": "promo",
  "recipients": [
    { "phone": "1234567890@c.us", "variables": { "name": "John", "discount": "20%" } },
    { "phone": "9876543210@c.us", "variables": { "name": "Jane", "discount": "25%" } }
  ],
  "schedule": "2025-11-25T09:00:00Z"
}
```

---

#### 13. Start Campaign
```http
POST /campaigns/:campaignId/start
x-client-id: my-client
```

---

### Automations

#### 14. Get Automation Templates
```http
GET /automations/templates
```

**Response:**
```json
{
  "success": true,
  "templates": {
    "customer_service": [
      {
        "id": "auto_reply",
        "name": "Auto Reply",
        "description": "Automatically respond to incoming messages"
      }
    ],
    "sales": [...]
  }
}
```

---

#### 15. Activate Automation
```http
POST /automations/activate
Content-Type: application/json
x-client-id: my-client

{
  "type": "customer_service",
  "templateId": "auto_reply",
  "config": {
    "replyMessage": "Thanks for reaching out! We'll respond soon."
  }
}
```

---

## Integration Guide

### Step 1: Install Dependencies in Your Project

```bash
npm install axios  # For making API calls
```

### Step 2: Create WhatsApp Service Client

```javascript
// whatsapp-client.js
const axios = require('axios');

class WhatsAppClient {
  constructor(baseURL = 'http://localhost:3002') {
    this.baseURL = baseURL;
    this.clientId = null;
  }

  // Create a new WhatsApp client
  async createClient(clientId) {
    const response = await axios.post(`${this.baseURL}/client/create`, {
      clientId: clientId || `client-${Date.now()}`
    });
    
    this.clientId = response.data.clientId;
    return response.data;
  }

  // Get QR code for authentication
  async getQRCode() {
    const response = await axios.get(
      `${this.baseURL}/client/${this.clientId}/qr`
    );
    return response.data.qr;  // Base64 image
  }

  // Check connection status
  async getStatus() {
    const response = await axios.get(
      `${this.baseURL}/client/${this.clientId}/status`
    );
    return response.data;
  }

  // Wait until connected
  async waitForConnection(timeoutMs = 120000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getStatus();
      
      if (status.status === 'connected') {
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new Error('Connection timeout');
  }

  // Send message
  async sendMessage(to, message) {
    const response = await axios.post(
      `${this.baseURL}/client/${this.clientId}/send`,
      { to, message }
    );
    return response.data;
  }

  // Send bulk messages
  async sendBulkMessages(recipients) {
    const results = [];
    
    for (const { to, message } of recipients) {
      try {
        const result = await this.sendMessage(to, message);
        results.push({ to, success: true, messageId: result.messageId });
      } catch (error) {
        results.push({ to, success: false, error: error.message });
      }
      
      // Wait 3 seconds between messages (anti-ban)
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    return results;
  }
}

module.exports = WhatsAppClient;
```

### Step 3: Use in Your Application

```javascript
// Example: Send order confirmation via WhatsApp
const WhatsAppClient = require('./whatsapp-client');

async function sendOrderConfirmation(orderId, customerPhone, orderDetails) {
  const whatsapp = new WhatsAppClient('http://localhost:3002');
  
  // Use existing client or create new one
  whatsapp.clientId = 'main-business-account';
  
  // Check if connected
  const status = await whatsapp.getStatus();
  
  if (status.status !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  
  // Format message
  const message = `
🎉 Order Confirmed!

Order ID: ${orderId}
Total: $${orderDetails.total}

Items:
${orderDetails.items.map(item => `- ${item.name} x${item.qty}`).join('\n')}

Estimated delivery: ${orderDetails.deliveryDate}

Thank you for your order! 🙏
  `.trim();
  
  // Send message
  const result = await whatsapp.sendMessage(
    `${customerPhone}@c.us`,
    message
  );
  
  console.log('Message sent:', result.messageId);
  return result;
}

// Usage
sendOrderConfirmation(
  'ORD-12345',
  '14155551234',
  {
    total: 99.99,
    items: [
      { name: 'Product A', qty: 2 },
      { name: 'Product B', qty: 1 }
    ],
    deliveryDate: '2025-11-10'
  }
);
```

### Step 4: Handle Webhooks (Optional)

If you want to receive incoming messages in your app:

```javascript
// Add this to simple-server.js after line 466
client.on('message', async (message) => {
  // Forward to your application webhook
  try {
    await axios.post('https://your-app.com/webhooks/whatsapp', {
      clientId: clientId,
      from: message.from,
      body: message.body,
      timestamp: message.timestamp,
      hasMedia: message.hasMedia
    });
  } catch (error) {
    logger.error('Webhook delivery failed', { error: error.message });
  }
});
```

---

## Message Flow

### Outbound Message Flow

```
Your App              WhatsApp Service           WhatsApp Servers
    |                        |                          |
    |  POST /send            |                          |
    |----------------------->|                          |
    |                        |                          |
    |                        | Validate & Queue         |
    |                        |----------------------    |
    |                        |                     |    |
    |                        |<---------------------    |
    |                        |                          |
    |                        | client.sendMessage()     |
    |                        |------------------------->|
    |                        |                          |
    |                        |      Message sent        |
    |                        |<-------------------------|
    |                        |                          |
    |                        | Log to audit             |
    |                        |----------------------    |
    |                        |                     |    |
    |                        |<---------------------    |
    |                        |                          |
    |  Response (messageId)  |                          |
    |<-----------------------|                          |
    |                        |                          |
```

### Inbound Message Flow

```
WhatsApp Servers     WhatsApp Service          Your App
    |                        |                      |
    |  Message received      |                      |
    |----------------------->|                      |
    |                        |                      |
    |                        | 'message' event      |
    |                        |------------------    |
    |                        |                 |    |
    |                        |<-----------------    |
    |                        |                      |
    |                        | Log to audit         |
    |                        |------------------    |
    |                        |                 |    |
    |                        |<-----------------    |
    |                        |                      |
    |                        | Check automations    |
    |                        |------------------    |
    |                        |                 |    |
    |                        |<-----------------    |
    |                        |                      |
    |                        | POST /webhook        |
    |                        |--------------------->|
    |                        |                      |
    |                        |     200 OK           |
    |                        |<---------------------|
    |                        |                      |
```

---

## Security & Anti-Ban

### Anti-Ban Manager (`monitoring.js`)

The service includes sophisticated anti-ban protection:

**Rate Limits:**
```javascript
// Per client limits
const limits = {
  messagesPerMinute: 20,      // Max 20 messages per minute
  messagesPerHour: 100,       // Max 100 messages per hour
  messagesPerDay: 1000,       // Max 1000 messages per day
  minDelay: 2000,             // Min 2 seconds between messages
  maxDelay: 5000              // Max 5 seconds between messages
};
```

**How It Works:**
1. Messages are queued, not sent immediately
2. Random delays added between messages (2-5 seconds)
3. Tracks message counts per minute/hour/day
4. Blocks sending if limits exceeded
5. Returns error with retry time

**Queue System:**
```javascript
// Messages wait in queue
const queue = [
  { clientId, to, message, timestamp, sendFunction }
];

// Processed one by one with delays
setInterval(() => {
  if (canSendMessage(clientId)) {
    const msg = queue.shift();
    sendMessage(msg);
  }
}, 1000);
```

### Session Recovery

Automatically reconnects disconnected clients:

```javascript
// monitoring.js:117
class SessionRecoveryManager {
  attemptRecovery(clientId) {
    // Try to reinitialize client
    // Max 3 attempts with exponential backoff
    // 1st attempt: immediate
    // 2nd attempt: 5 minutes later
    // 3rd attempt: 15 minutes later
  }
}
```

### Data Encryption

API keys and sensitive data are encrypted:

```javascript
// simple-server.js:91
function encrypt(text) {
  const cipher = crypto.createCipher('aes-256-cbc', ENCRYPTION_KEY);
  return cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
}
```

**Environment Variables:**
```bash
ENCRYPTION_KEY=your-32-char-hex-key-here
```

---

## Troubleshooting

### Issue 1: QR Code Not Generating

**Symptoms:**
- GET `/client/:id/qr` returns `"QR code not available"`
- Client stuck in "initializing" status

**Solutions:**
1. Check Puppeteer/Chrome installation:
   ```bash
   npm install puppeteer --force
   ```

2. Check logs for errors:
   ```bash
   tail -f logs/app.log
   ```

3. Ensure sessions directory exists:
   ```bash
   mkdir -p sessions
   chmod 755 sessions
   ```

4. Try headful mode (for debugging):
   ```javascript
   // simple-server.js:241
   puppeteer: {
     headless: false,  // Show browser window
     args: ['--no-sandbox']
   }
   ```

---

### Issue 2: Client Disconnects Frequently

**Symptoms:**
- Status changes from "connected" to "disconnected"
- Need to scan QR code repeatedly

**Solutions:**
1. Check session persistence:
   ```bash
   ls -la sessions/
   # Should show directories for each client
   ```

2. Don't delete session folders
3. Increase memory if running many clients:
   ```bash
   node --max-old-space-size=4096 simple-server.js
   ```

4. Check for WhatsApp updates (whatsapp-web.js needs updating)

---

### Issue 3: Messages Not Sending

**Symptoms:**
- API returns success but message not delivered
- Error: "Client not connected"

**Solutions:**
1. Check client status:
   ```bash
   curl http://localhost:3002/client/YOUR_CLIENT/status
   ```

2. Verify phone number format:
   ```javascript
   // Correct
   "14155551234@c.us"
   
   // Wrong
   "+1 (415) 555-1234"
   "14155551234"
   ```

3. Check if number is saved in contacts:
   - WhatsApp requires the number to be a valid WhatsApp user

4. Check rate limits:
   ```javascript
   // If sending too fast, messages queue up
   // Check queue length in metrics
   ```

---

### Issue 4: High Memory Usage

**Symptoms:**
- Server crashes with "Out of memory"
- Slow response times

**Solutions:**
1. Limit number of concurrent clients:
   ```javascript
   // simple-server.js
   const MAX_CLIENTS = 10;  // Adjust based on server RAM
   ```

2. Use PM2 with memory limit:
   ```bash
   pm2 start simple-server.js --max-memory-restart 1G
   ```

3. Clean up old sessions:
   ```bash
   # Remove sessions older than 30 days
   find sessions/ -type d -mtime +30 -exec rm -rf {} \;
   ```

---

### Issue 5: "WhatsApp Web version mismatch"

**Symptoms:**
- Error in logs about version mismatch
- QR code generated but won't connect

**Solutions:**
1. Update whatsapp-web.js:
   ```bash
   npm update whatsapp-web.js
   ```

2. Clear sessions and re-authenticate:
   ```bash
   rm -rf sessions/*
   rm -rf .wwebjs_cache/*
   ```

3. Check for library updates:
   ```bash
   npm outdated
   ```

---

## Production Deployment

### 1. Environment Variables

Create `.env.production`:
```bash
PORT=3002
NODE_ENV=production
SESSIONS_DIR=/var/whatsapp/sessions
ENCRYPTION_KEY=your-secure-32-char-key-here
CORS_ORIGIN=https://your-app.com
```

### 2. Use PM2 Process Manager

```bash
# Install PM2
npm install -g pm2

# Start service
pm2 start simple-server.js --name whatsapp-service

# Auto-restart on reboot
pm2 startup
pm2 save

# Monitor
pm2 monit

# Logs
pm2 logs whatsapp-service
```

### 3. Nginx Reverse Proxy

```nginx
# /etc/nginx/sites-available/whatsapp-service
server {
    listen 80;
    server_name whatsapp-api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### 4. SSL with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d whatsapp-api.yourdomain.com
```

### 5. Firewall

```bash
# Allow only necessary ports
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

---

## Performance Optimization

### 1. Connection Pooling
Reuse client connections instead of creating new ones.

### 2. Message Batching
Group messages to same recipient to reduce overhead.

### 3. Caching
Cache client status and QR codes in Redis:

```javascript
const redis = require('redis');
const client = redis.createClient();

// Cache QR code for 5 minutes
await client.setEx(`qr:${clientId}`, 300, qrDataURL);
```

### 4. Load Balancing
Run multiple instances behind a load balancer:

```bash
# ecosystem.config.js
module.exports = {
  apps: [{
    name: 'whatsapp-service',
    script: 'simple-server.js',
    instances: 4,
    exec_mode: 'cluster'
  }]
};

pm2 start ecosystem.config.js
```

---

## Testing

### Unit Test Example

```javascript
// test/message-send.test.js
const axios = require('axios');
const assert = require('assert');

describe('Message Sending', () => {
  it('should send message successfully', async () => {
    const response = await axios.post(
      'http://localhost:3002/client/test-client/send',
      {
        to: '1234567890@c.us',
        message: 'Test message'
      }
    );
    
    assert.equal(response.data.success, true);
    assert(response.data.messageId);
  });
});
```

### Integration Test

```bash
# test-ubuntu.sh (already included)
./test-ubuntu.sh
```

---

## Best Practices

### 1. Always Use Anti-Ban Features
Never bypass the message queue.

### 2. Monitor Rate Limits
Check metrics regularly to avoid hitting limits.

### 3. Handle Disconnections Gracefully
Implement retry logic in your application.

### 4. Log Everything
Use audit logs for debugging and compliance.

### 5. Backup Sessions
Regularly backup the `sessions/` directory.

### 6. Update Regularly
Keep dependencies updated, especially `whatsapp-web.js`.

### 7. Use Templates for Bulk
Use campaign manager instead of loops.

### 8. Validate Phone Numbers
Always format correctly: `[country][number]@c.us`

---

## FAQ

**Q: Can I send images/files?**  
A: Yes, extend the `/send` endpoint to accept media. Use `client.sendMessage()` with `MessageMedia` object.

**Q: How many clients can I run?**  
A: Depends on server resources. Each client uses ~200-300MB RAM. On a 4GB server, aim for 10-12 clients.

**Q: Is this against WhatsApp ToS?**  
A: Using unofficial APIs may violate ToS. For production, consider WhatsApp Business API (official).

**Q: Can I schedule messages?**  
A: Yes, use the campaign manager with `schedule` parameter.

**Q: How do I handle incoming messages?**  
A: The `'message'` event fires for incoming messages. Add webhook forwarding to your app.

**Q: Can I send to numbers not in contacts?**  
A: Yes, but the number must be a valid WhatsApp user.

**Q: How do I backup sessions?**  
A: Copy the entire `sessions/` directory. Restore it to keep authentication.

---

## Support & Resources

- **Repository**: https://github.com/sachinkumar6910-cloud/whatsapp-service
- **whatsapp-web.js Docs**: https://wwebjs.dev/
- **Issues**: Check logs in `logs/` directory
- **Dashboard**: http://localhost:3002/dashboard.html

---

## Changelog

### v1.0.0 (Current)
- ✅ Multi-tenant support
- ✅ Anti-ban protection
- ✅ Session persistence
- ✅ Message templates
- ✅ Campaign manager
- ✅ Automation marketplace
- ✅ Audit logging
- ✅ Health monitoring

---

**Last Updated**: November 6, 2025  
**Author**: WhatsApp Service Team  
**License**: MIT
