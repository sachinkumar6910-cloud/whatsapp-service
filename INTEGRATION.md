# WhatsApp Service v2.0 - Integration Guide

## 📋 Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Module Integration](#module-integration)
3. [API Documentation](#api-documentation)
4. [Workflow Examples](#workflow-examples)
5. [Testing Guide](#testing-guide)
6. [Migration from v1](#migration-from-v1)

---

## Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Express.js Server                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Auth         │  │ Clients      │  │ Messages     │           │
│  │ Endpoints    │  │ Management   │  │ APIs         │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Team Mgmt    │  │ Webhooks     │  │ Analytics    │           │
│  │ APIs         │  │ Events       │  │ Reports      │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
         │                 │                 │
         ▼                 ▼                 ▼
    ┌────────────────────────────────────────────────┐
    │  Core Managers & Services                      │
    ├────────────────────────────────────────────────┤
    │ • TeamManager (RBAC, Auth)                     │
    │ • AdvancedAntiBanManager (Proxy, Fingerprint)  │
    │ • MediaManager (Upload, Download)              │
    │ • WebhookManager (Events, Delivery)            │
    │ • AnalyticsManager (Metrics, Reports)          │
    │ • Logger (Structured logging)                  │
    └────────────────────────────────────────────────┘
         │                 │                 │
         ▼                 ▼                 ▼
    ┌────────────────────────────────────────────────┐
    │  Database Layer (db.js)                        │
    ├────────────────────────────────────────────────┤
    │ • Connection Pooling (pg)                      │
    │ • Parameterized Queries (SQL Injection Safe)   │
    │ • Encryption (AES-256-GCM)                     │
    │ • Query Builder Pattern                        │
    │ • Transaction Support                          │
    └────────────────────────────────────────────────┘
         │                 │                 │
         ▼                 ▼                 ▼
    ┌────────────────────────────────────────────────┐
    │  PostgreSQL Database                           │
    ├────────────────────────────────────────────────┤
    │ • Organizations & Multi-tenancy                │
    │ • Users & RBAC                                 │
    │ • WhatsApp Clients                             │
    │ • Messages & Contacts                          │
    │ • Webhooks & Events                            │
    │ • Analytics & Metrics                          │
    │ • Anti-ban Protection Data                     │
    │ • Audit Logs                                   │
    └────────────────────────────────────────────────┘
```

### Data Flow Example: Sending a Message

```
1. Client API Request
   POST /api/clients/:clientId/send-message
   ├─ Headers: { 'x-api-key': '...' }
   ├─ Body: { to: '1234567890', message: 'Hello' }
   └─ Organization & User Verification

2. Rate Limiting Check
   └─ AdvancedAntiBanManager.canSendMessage()
      ├─ Check per-minute limit
      ├─ Check per-hour limit
      └─ Check per-day limit

3. Simulate Human Behavior
   └─ AdvancedAntiBanManager.simulateHumanBehavior()
      ├─ Add typing delays (60-100ms)
      ├─ Add message delays (2-5s)
      └─ 10% chance of longer pauses

4. Database Operations
   └─ db.query() - Parameterized Insert
      ├─ Insert message record
      ├─ Get message ID
      └─ Update status to 'sending'

5. Send via WhatsApp
   └─ client.sendMessage(to, message)
      ├─ WhatsApp Web.js handles transmission
      └─ Wait for delivery

6. Update Status & Record Analytics
   ├─ Update message status to 'sent'
   ├─ analyticsManager.recordMessageMetric()
   │  └─ Insert into message_metrics
   └─ webhookManager.triggerEvent()
      └─ Queue webhook delivery for registered endpoints

7. Response to Client
   └─ { messageId: '123', status: 'sent' }
```

---

## Module Integration

### 1. Database Module (db.js)

**Purpose**: Secure database abstraction layer with SQL injection prevention

**Key Features**:
- Connection pooling (max 20 connections)
- Parameterized queries (all user input as $1, $2, etc.)
- Built-in encryption for sensitive data
- Transaction support with rollback
- Query builder for complex queries

**Usage**:
```javascript
const db = require('./db');

// Simple query
const result = await db.query(
  'SELECT * FROM users WHERE id = $1',
  [userId]
);

// Insert with encryption
const encrypted = await db.encryptSensitive(password);
await db.query(
  'INSERT INTO users (email, password) VALUES ($1, $2)',
  [email, encrypted]
);

// Transaction
await db.query('BEGIN');
try {
  await db.query('INSERT INTO table1 ...');
  await db.query('UPDATE table2 ...');
  await db.query('COMMIT');
} catch (error) {
  await db.query('ROLLBACK');
}

// QueryBuilder (safe identifier sanitization)
const builder = new db.QueryBuilder();
builder.select('email, name')
  .from('users')
  .where('organization_id', '=', orgId)
  .where('status', '=', 'active')
  .orderBy('created_at', 'DESC')
  .limit(50);

const query = builder.build();
const result = await db.query(query.sql, query.values);
```

### 2. Anti-Ban Manager (anti-ban.js)

**Purpose**: Advanced protection against WhatsApp bans with behavioral simulation

**Key Features**:
- Proxy rotation from database pool
- Browser fingerprint randomization
- Behavioral simulation (typing delays, message delays)
- Rate limiting (3-tier: minute/hour/day)
- Suspicious activity detection
- Session rotation

**Usage**:
```javascript
const AdvancedAntiBanManager = require('./anti-ban');

const antiBan = new AdvancedAntiBanManager();

// Generate browser profile for new client
const profile = antiBan.generateBrowserProfile();
// {
//   userAgent: 'Mozilla/5.0...',
//   timezone: 'America/New_York',
//   screen: { width: 1920, height: 1080 },
//   ...
// }

// Get available proxy
const proxy = await antiBan.getAvailableProxy();
// { host: '1.2.3.4', port: 8080, username: '...', ... }

// Apply fingerprinting to browser page
await antiBan.applyBrowserFingerprinting(puppeteerPage);

// Check if can send message
const check = antiBan.canSendMessage(clientId);
// {
//   allowed: true,
//   perMinute: { used: 15, limit: 20, remaining: 5 },
//   perHour: { used: 75, limit: 100, remaining: 25 },
//   perDay: { used: 800, limit: 1000, remaining: 200 }
// }

// Simulate human behavior before sending
await antiBan.simulateHumanBehavior();
// Adds realistic delays

// Detect suspicious activity
await antiBan.detectSuspiciousActivity(clientId, 'send_failure');
```

### 3. Media Manager (media-manager.js)

**Purpose**: Handle media files (images, videos, documents, audio)

**Key Features**:
- File upload with validation
- MIME type checking
- Magic bytes verification
- Secure storage
- File streaming for downloads
- Storage quota management

**Usage**:
```javascript
const MediaManager = require('./media-manager');

const mediaManager = new MediaManager();

// Upload file
const buffer = fs.readFileSync('image.jpg');
const media = await mediaManager.uploadFile(buffer, organizationId);
// { id: '123', filename: 'abc-xyz.jpg', size: 52048, ... }

// Send image message
const messageMedia = new MessageMedia('image/jpeg', buffer.toString('base64'));
await mediaManager.sendImageMessage(whatsappClient, phoneNumber, messageMedia);

// Send video message
const videoMedia = new MessageMedia('video/mp4', videoBuffer.toString('base64'));
await mediaManager.sendVideoMessage(whatsappClient, phoneNumber, videoMedia);

// Send document
const docMedia = new MessageMedia('application/pdf', pdfBuffer.toString('base64'));
await mediaManager.sendDocumentMessage(whatsappClient, phoneNumber, docMedia, 'Report.pdf');

// Get media info
const info = await mediaManager.getMediaInfo(mediaId);
// { id: '123', size: 52048, type: 'image/jpeg', ... }

// Download file
app.get('/media/:mediaId', async (req, res) => {
  await mediaManager.streamFileToResponse(req.params.mediaId, res);
});

// Check storage usage
const usage = await mediaManager.getStorageUsage(organizationId);
// { used: 1048576, limit: 5368709120, percentUsed: 19.5 }
```

### 4. Webhook Manager (webhook-manager.js)

**Purpose**: Event-driven webhook delivery system with retry logic

**Key Features**:
- Webhook registration with event filtering
- Async queue processing
- Exponential backoff retry (2^n seconds)
- HMAC-SHA256 signature verification
- Webhook testing
- Delivery logging

**Usage**:
```javascript
const WebhookManager = require('./webhook-manager');

const webhookManager = new WebhookManager();

// Register webhook
const webhook = await webhookManager.registerWebhook(
  organizationId,
  'https://example.com/webhook',
  ['message.sent', 'message.received', 'client.connected']
);
// { id: '123', secret: 'secret_key_...', ... }

// Trigger event (automatic webhook delivery)
await webhookManager.triggerEvent(
  organizationId,
  'message.sent',
  {
    messageId: '456',
    clientId: '789',
    to: '+1234567890',
    timestamp: new Date()
  }
);

// Manual webhook test
const testResult = await webhookManager.testWebhook(webhookId);
// { success: true, statusCode: 200, responseTime: 123 }

// Verify webhook signature (on your receiving end)
const isValid = webhookManager.verifyWebhookSignature(
  payload,
  signature,
  secret
);

// Broadcast event to all organizations
await webhookManager.broadcastEvent(
  'system.status',
  { status: 'healthy' }
);
```

**Webhook Payload Example**:
```json
{
  "event": "message.sent",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "messageId": "msg_123",
    "clientId": "client_456",
    "to": "+1234567890",
    "timestamp": "2024-01-15T10:30:00Z"
  },
  "signature": "sha256=abc123def456..."
}
```

### 5. Team Manager (team-manager.js)

**Purpose**: User management, RBAC, and authentication

**Key Features**:
- Role-based access control (Admin/Manager/Agent/Viewer)
- User creation with password hashing (bcryptjs)
- API key generation and verification
- Client assignment to team members
- Audit logging
- Permission checking

**Usage**:
```javascript
const TeamManager = require('./team-manager');

const teamManager = new TeamManager();

// Create user
const user = await teamManager.createUser(
  'john@example.com',
  'password123',
  'John Doe',
  organizationId,
  'manager'
);

// Authenticate user (returns JWT token)
const result = await teamManager.authenticateUser('john@example.com', 'password123');
// { token: 'eyJhbGc...', user: { id, email, name, role } }

// Check permission
const hasPermission = teamManager.hasPermission('manager', 'can_manage_team');
// true

// Generate API key
const apiKey = await teamManager.generateApiKey(userId);
// 'sk_abc123def456...'

// Verify API key
const user = await teamManager.verifyApiKey(apiKey);
// { id: '123', email: 'user@example.com', ... } or null

// Assign client to team member
await teamManager.assignClientToMember(userId, clientId, organizationId);

// Get audit logs
const logs = await teamManager.getAuditLogs(organizationId, 100, 0);
// [{ id, user_id, action, resource, details, timestamp }, ...]

// Log action (automatic in most operations)
await teamManager.logAction(
  organizationId,
  userId,
  'create_client',
  'whatsapp_clients',
  { clientId: '123', name: 'New Client' }
);
```

**RBAC Permission Matrix**:
```javascript
{
  admin: [
    'can_manage_team',
    'can_view_audit_logs',
    'can_manage_organization',
    'can_manage_webhooks',
    'can_view_analytics',
    'can_send_messages',
    'can_manage_clients'
  ],
  manager: [
    'can_manage_team',      // Limited to their agents
    'can_view_analytics',
    'can_send_messages',
    'can_manage_clients'
  ],
  agent: [
    'can_send_messages',
    'can_view_assigned_clients'
  ],
  viewer: [
    'can_view_analytics',
    'can_view_assigned_data'
  ]
}
```

### 6. Analytics Manager (analytics-manager.js)

**Purpose**: Message metrics, campaign analytics, and reporting

**Key Features**:
- Real-time metric recording
- Daily aggregation
- Delivery rate calculations
- Campaign analytics
- Contact segmentation
- Data export (CSV/JSON)

**Usage**:
```javascript
const AnalyticsManager = require('./analytics-manager');

const analyticsManager = new AnalyticsManager();

// Record metric
await analyticsManager.recordMessageMetric(
  organizationId,
  clientId,
  'message_sent'  // or 'message_received', 'message_failed', etc.
);

// Get daily metrics
const metrics = await analyticsManager.getDailyMetrics(
  organizationId,
  clientId,
  '2024-01-15'
);
// { sent: 150, delivered: 148, read: 140, failed: 2 }

// Get metrics for date range
const rangeMetrics = await analyticsManager.getMetricsRange(
  organizationId,
  clientId,
  new Date('2024-01-01'),
  new Date('2024-01-31')
);

// Get delivery rate
const deliveryRate = await analyticsManager.getDeliveryRate(
  organizationId,
  clientId,
  new Date('2024-01-01'),
  new Date('2024-01-31')
);
// 98.5

// Get read rate
const readRate = await analyticsManager.getReadRate(
  organizationId,
  clientId,
  new Date('2024-01-01'),
  new Date('2024-01-31')
);
// 93.2

// Get average response time (hours)
const avgResponseTime = await analyticsManager.getAverageResponseTime(
  organizationId,
  clientId
);
// 2.5

// Get campaign analytics
const campaignStats = await analyticsManager.getCampaignAnalytics(
  campaignId
);
// {
//   id: '123',
//   name: 'Summer Sale',
//   total_sent: 5000,
//   delivered: 4900,
//   read: 4200,
//   clicked: 1200,
//   delivery_rate: 98,
//   read_rate: 84,
//   click_rate: 24
// }

// Get organization dashboard stats
const stats = await analyticsManager.getOrganizationStats(organizationId);
// {
//   total_clients: 5,
//   total_contacts: 25000,
//   total_messages: 150000,
//   messages_today: 2500,
//   active_campaigns: 3
// }

// Export data
const csv = await analyticsManager.exportMessagesCSV(
  organizationId,
  clientId,
  new Date('2024-01-01'),
  new Date('2024-01-31')
);
// CSV formatted string
```

### 7. Logger Module (logger.js)

**Purpose**: Structured logging with console and file output

**Usage**:
```javascript
const logger = require('./logger');

logger.error('Error message', new Error());
logger.warn('Warning message');
logger.info('Info message');
logger.debug('Debug message');
logger.trace('Trace message');
logger.success('Success message');
```

---

## API Documentation

### Authentication

All protected endpoints require either:
1. **API Key** in header: `X-API-Key: sk_...`
2. **JWT Token** in header: `Authorization: Bearer eyJ...`

### Base URL
```
http://localhost:3002/api
```

### Auth Endpoints

#### Register User
```
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure_password",
  "name": "User Name",
  "organization_name": "Acme Corp"
}

Response (201):
{
  "message": "User created successfully",
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "organization_id": "org_456"
  }
}
```

#### Login
```
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure_password"
}

Response (200):
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "organization_id": "org_456",
    "role": "admin"
  }
}
```

### Client Endpoints

#### Create Client
```
POST /clients
X-API-Key: sk_...
Content-Type: application/json

{
  "org_id": "org_123",
  "name": "Sales Team",
  "phone_number": "+1234567890"
}

Response (201):
{
  "message": "Client created successfully",
  "client": {
    "id": "client_123",
    "name": "Sales Team",
    "phone_number": "+1234567890",
    "status": "initializing"
  }
}
```

#### Initialize Client
```
POST /clients/:clientId/init
X-API-Key: sk_...

Response (200):
{
  "message": "Client initialization started",
  "clientId": "client_123",
  "status": "initializing"
}
```

#### Get Client Status
```
GET /clients/:clientId/status
X-API-Key: sk_...

Response (200):
{
  "id": "client_123",
  "name": "Sales Team",
  "status": "ready",
  "phoneNumber": "+1234567890",
  "deviceInfo": { ... }
}
```

### Message Endpoints

#### Send Message
```
POST /clients/:clientId/send-message
X-API-Key: sk_...
Content-Type: application/json

{
  "to": "+1987654321",
  "message": "Hello there!",
  "media": null  // or base64 encoded file
}

Response (200):
{
  "message": "Message sent successfully",
  "messageId": "msg_789"
}
```

#### Get Message History
```
GET /clients/:clientId/messages?limit=50&offset=0&contact=%2B1987654321
X-API-Key: sk_...

Response (200):
{
  "messages": [
    {
      "id": "msg_789",
      "contact_id": "+1987654321",
      "message_text": "Hello there!",
      "direction": "outbound",
      "status": "delivered",
      "created_at": "2024-01-15T10:30:00Z"
    },
    ...
  ],
  "count": 50
}
```

### Team Endpoints

#### Create Team Member
```
POST /team/members
X-API-Key: sk_...
Content-Type: application/json

{
  "org_id": "org_123",
  "email": "agent@example.com",
  "password": "secure_password",
  "name": "Sales Agent",
  "role": "agent"
}

Response (201):
{
  "message": "Team member created",
  "user": {
    "id": "user_456",
    "email": "agent@example.com",
    "name": "Sales Agent",
    "role": "agent"
  }
}
```

#### Assign Client to Team Member
```
POST /team/members/:userId/clients/:clientId
X-API-Key: sk_...
Content-Type: application/json

{
  "org_id": "org_123"
}

Response (200):
{
  "message": "Client assigned successfully"
}
```

#### Get Audit Logs
```
GET /audit-logs?limit=100&offset=0
X-API-Key: sk_...

Response (200):
{
  "logs": [
    {
      "id": "log_123",
      "user_id": "user_456",
      "action": "send_message",
      "resource": "messages",
      "details": { ... },
      "timestamp": "2024-01-15T10:30:00Z"
    },
    ...
  ],
  "count": 100
}
```

### Webhook Endpoints

#### Register Webhook
```
POST /webhooks
X-API-Key: sk_...
Content-Type: application/json

{
  "org_id": "org_123",
  "url": "https://example.com/webhook",
  "events": ["message.sent", "message.received", "client.connected"]
}

Response (201):
{
  "message": "Webhook registered",
  "webhook": {
    "id": "wh_123",
    "url": "https://example.com/webhook",
    "events": ["message.sent", "message.received", "client.connected"],
    "secret": "whsec_abc123..."
  }
}
```

#### Get Webhooks
```
GET /webhooks
X-API-Key: sk_...

Response (200):
{
  "webhooks": [
    {
      "id": "wh_123",
      "url": "https://example.com/webhook",
      "events": ["message.sent", "message.received"],
      "active": true,
      "created_at": "2024-01-15T10:30:00Z"
    },
    ...
  ]
}
```

#### Test Webhook
```
POST /webhooks/:webhookId/test
X-API-Key: sk_...

Response (200):
{
  "message": "Test sent",
  "result": {
    "success": true,
    "statusCode": 200,
    "responseTime": 123
  }
}
```

### Analytics Endpoints

#### Get Organization Stats
```
GET /analytics/stats
X-API-Key: sk_...

Response (200):
{
  "total_clients": 5,
  "total_contacts": 25000,
  "total_messages": 150000,
  "messages_today": 2500,
  "active_campaigns": 3
}
```

#### Get Message Metrics
```
GET /analytics/metrics?startDate=2024-01-01&endDate=2024-01-31&clientId=client_123
X-API-Key: sk_...

Response (200):
{
  "metrics": [
    {
      "date": "2024-01-15",
      "sent": 150,
      "delivered": 148,
      "read": 140,
      "failed": 2
    },
    ...
  ]
}
```

#### Export Campaign Report
```
GET /analytics/campaigns/:campaignId/export?format=csv
X-API-Key: sk_...

Response (200):
[CSV file content]
```

#### Get Storage Usage
```
GET /analytics/storage
X-API-Key: sk_...

Response (200):
{
  "used": 1048576,
  "limit": 5368709120,
  "percentUsed": 19.5,
  "message": "Storage is at 19.5% capacity"
}
```

### Media Endpoints

#### Upload Media
```
POST /media/upload
X-API-Key: sk_...
Content-Type: application/json

{
  "org_id": "org_123",
  "file": "base64_encoded_file_content"
}

Response (201):
{
  "message": "Media uploaded",
  "media": {
    "id": "media_123",
    "filename": "image_abc123.jpg",
    "size": 52048,
    "mimetype": "image/jpeg"
  }
}
```

#### Download Media
```
GET /media/:mediaId/download
X-API-Key: sk_...

Response (200):
[File content with appropriate Content-Type header]
```

---

## Workflow Examples

### Example 1: Complete Setup Workflow

```javascript
// 1. Register organization
POST /api/auth/register
{
  "email": "admin@acmecorp.com",
  "password": "secure123",
  "name": "Admin",
  "organization_name": "Acme Corp"
}
// Response: { user: { id: "user_1", ... }, token: "..." }

// 2. Create WhatsApp client
POST /api/clients
Headers: X-API-Key: sk_...
{
  "org_id": "org_1",
  "name": "Sales Team",
  "phone_number": "+1234567890"
}
// Response: { client: { id: "client_1", status: "initializing" } }

// 3. Initialize client session
POST /api/clients/client_1/init
Headers: X-API-Key: sk_...
// Waits for QR code scan...

// 4. Register webhook for notifications
POST /api/webhooks
Headers: X-API-Key: sk_...
{
  "org_id": "org_1",
  "url": "https://acme.com/whatsapp-webhook",
  "events": ["message.sent", "message.received", "client.connected"]
}
// Response: { webhook: { id: "wh_1", secret: "..." } }

// 5. Send test message
POST /api/clients/client_1/send-message
Headers: X-API-Key: sk_...
{
  "to": "+9876543210",
  "message": "Hello from WhatsApp!"
}
// Response: { messageId: "msg_1" }

// 6. Check analytics
GET /api/analytics/stats
Headers: X-API-Key: sk_...
// Response: { total_clients: 1, total_messages: 1, ... }
```

### Example 2: Team Collaboration

```javascript
// Admin creates team member
POST /api/team/members
{
  "org_id": "org_1",
  "email": "agent@acmecorp.com",
  "password": "secure456",
  "name": "John Agent",
  "role": "agent"
}
// Response: { user: { id: "user_2", ... } }

// Admin assigns client to agent
POST /api/team/members/user_2/clients/client_1
{
  "org_id": "org_1"
}

// Agent logs in and gets their token
POST /api/auth/login
{
  "email": "agent@acmecorp.com",
  "password": "secure456"
}
// Response: { token: "...", user: { id: "user_2", ... } }

// Agent sends message from assigned client
POST /api/clients/client_1/send-message
Headers: X-API-Key: sk_agent_...
{
  "to": "+9876543210",
  "message": "Hi, this is John from support!"
}

// Admin checks audit logs
GET /api/audit-logs
Headers: X-API-Key: sk_admin_...
// Response: { logs: [{ action: "send_message", user_id: "user_2", ... }] }
```

### Example 3: Campaign with Webhooks

```javascript
// 1. Upload media for campaign
POST /api/media/upload
{
  "org_id": "org_1",
  "file": "base64_image_content"
}
// Response: { media: { id: "media_1" } }

// 2. Get media download URL
GET /api/media/media_1/download
// Response: [Image binary]

// 3. Send campaign messages
for (let i = 0; i < contactList.length; i++) {
  POST /api/clients/client_1/send-message
  {
    "to": contactList[i],
    "message": "Check out our new products!",
    "media": "base64_image_content"
  }
}

// 4. Webhook receives events
// Your webhook endpoint receives:
{
  "event": "message.sent",
  "data": {
    "messageId": "msg_...",
    "to": "+1234567890",
    "timestamp": "2024-01-15T10:30:00Z"
  },
  "signature": "sha256=..."
}

// 5. Get campaign metrics
GET /api/analytics/campaigns/campaign_1/export?format=csv
Headers: X-API-Key: sk_...
// Response: CSV file with all metrics
```

---

## Testing Guide

### 1. Unit Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test db.test.js

# Run with coverage
npm test -- --coverage
```

### 2. API Testing with cURL

```bash
# Register user
curl -X POST http://localhost:3002/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123",
    "name": "Test User",
    "organization_name": "Test Org"
  }'

# Login
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123"
  }'

# Create client
curl -X POST http://localhost:3002/api/clients \
  -H "X-API-Key: sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "org_id": "org_1",
    "name": "Test Client",
    "phone_number": "+1234567890"
  }'

# Check health
curl http://localhost:3002/health
```

### 3. Load Testing

```bash
# Install Apache Bench
sudo apt install apache2-utils

# Test endpoint
ab -n 1000 -c 50 http://localhost:3002/health

# Load test with custom headers
ab -n 1000 -c 50 \
  -H "X-API-Key: sk_..." \
  http://localhost:3002/api/analytics/stats
```

### 4. Database Testing

```bash
# Connect to database
psql -U postgres -d whatsapp_service

# Check tables
\dt

# Test insert
INSERT INTO organizations (name, plan) VALUES ('Test Org', 'starter');

# Verify encryption
SELECT * FROM users WHERE email = 'test@example.com';
```

---

## Migration from v1

### Step 1: Backup v1 Data

```bash
# Export client map from memory
# Implement export function in v1 server
GET /api/v1/export
// Save JSON to file: clients-backup.json
```

### Step 2: Create Database Schema

```bash
# Initialize new PostgreSQL database
psql -U postgres -d whatsapp_service -f database.sql
```

### Step 3: Migrate Data

```javascript
// Create migration script: migrate-v1-to-v2.js
const fs = require('fs');
const db = require('./db');

async function migrateData() {
  const backup = JSON.parse(fs.readFileSync('clients-backup.json'));
  
  // Create organization
  const org = await db.query(
    'INSERT INTO organizations (name, plan) VALUES ($1, $2) RETURNING id',
    ['Migrated Org', 'pro']
  );
  
  const orgId = org.rows[0].id;
  
  // Migrate clients
  for (const client of backup.clients) {
    await db.query(
      `INSERT INTO whatsapp_clients 
       (organization_id, name, phone_number, status)
       VALUES ($1, $2, $3, $4)`,
      [orgId, client.name, client.phone, 'ready']
    );
  }
  
  // Create admin user
  const admin = await db.query(
    `INSERT INTO users (email, password, name, organization_id, role)
     VALUES ($1, $2, $3, $4, $5)`,
    ['admin@example.com', 'hashed_password', 'Admin', orgId, 'admin']
  );
}

// Run migration
migrateData().then(() => console.log('Migration complete'));
```

### Step 4: Update Application Code

- Replace `simple-server.js` with `simple-server-v2.js`
- Update API calls to use new endpoints
- Update authentication to use API keys
- Update webhook configurations

### Step 5: Testing

- Test all existing workflows
- Verify data integrity
- Load test new system
- Gradual rollout to users

---

## Troubleshooting

### Issue: "API key required"
**Solution**: Include `X-API-Key` header in all API requests

### Issue: "Rate limit exceeded"
**Solution**: Wait before sending more messages, or upgrade rate limits in `.env`

### Issue: "Database connection refused"
**Solution**: Verify PostgreSQL is running and `.env` has correct credentials

### Issue: "Client not ready"
**Solution**: Wait for `POST /api/clients/:id/init` to complete (QR code scan)

### Issue: "Webhook delivery failed"
**Solution**: Check webhook URL is publicly accessible, verify HMAC signature

---

## Support & Resources

- **GitHub**: https://github.com/sachinkumar6910-cloud/whatsapp-service
- **Documentation**: See WORKING.md and DEPLOYMENT.md
- **Issues**: Open issue on GitHub repository
