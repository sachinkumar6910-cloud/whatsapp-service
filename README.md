# WhatsApp Service v2.0 - Enterprise Multi-Tenant Platform

A production-ready Node.js SaaS platform for WhatsApp business automation with multi-tenancy, team collaboration, advanced anti-ban protection, and comprehensive analytics.

**Version**: 2.0.0 | **License**: MIT | **Language**: JavaScript/Node.js

---

## 🌟 Key Features

### Core Capabilities
- ✅ **Multi-tenant Architecture** - Complete organization isolation
- ✅ **PostgreSQL Database** - Enterprise-grade data persistence
- ✅ **Role-Based Access Control** - Admin, Manager, Agent, Viewer roles
- ✅ **Advanced Anti-Ban System** - Proxy rotation, fingerprinting, behavioral simulation
- ✅ **Media Message Support** - Images, videos, documents, audio
- ✅ **Webhook Event System** - Real-time notifications with retry logic
- ✅ **Team Collaboration** - Multi-user management with audit logging
- ✅ **Real-time Analytics** - Metrics, delivery rates, campaign tracking
- ✅ **API Key Management** - Secure authentication for integrations
- ✅ **File Upload/Download** - Secure media storage and retrieval

### Security
- ✅ **SQL Injection Prevention** - Parameterized queries throughout
- ✅ **AES-256-GCM Encryption** - Sensitive data at rest
- ✅ **JWT Authentication** - Stateless API security
- ✅ **HMAC Webhook Verification** - Signature-based webhook security
- ✅ **bcryptjs Password Hashing** - Industry-standard hashing
- ✅ **Input Sanitization** - All user inputs validated

### Deployment & DevOps
- ✅ **Docker Compose** - Multi-container orchestration
- ✅ **Environment Configuration** - 60+ configurable variables
- ✅ **Health Checks** - Built-in service monitoring
- ✅ **Nginx Reverse Proxy** - Production web server
- ✅ **Redis Caching** - Optional performance enhancement
- ✅ **Production-Ready** - VPS deployment guide included

---

## 🚀 Quick Start (5 minutes)

### Prerequisites
- Docker & Docker Compose (or Node.js 14+ & PostgreSQL 12+)
- 2GB RAM minimum
- Basic command line knowledge

### Option 1: Docker Compose (Recommended)

```bash
# 1. Clone repository
git clone https://github.com/sachinkumar6910-cloud/whatsapp-service.git
cd whatsapp-service

# 2. Setup environment
cp .env.example .env

# 3. Start services
docker-compose up -d

# 4. Verify installation
curl http://localhost:3002/health

# 5. Access dashboard
# Open: http://localhost:3002/dashboard.html
```

### Option 2: Manual Installation

```bash
# 1. Install dependencies
npm install

# 2. Create PostgreSQL database
createdb whatsapp_service
psql -d whatsapp_service -f database.sql

# 3. Configure environment
cp .env.example .env
nano .env

# 4. Start server
npm start
```

### First Use

```bash
# 1. Register account
curl -X POST http://localhost:3002/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@company.com","password":"secure123","name":"Admin","organization_name":"My Company"}'

# 2. Login and get API key
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@company.com","password":"secure123"}'

# 3. Create WhatsApp client
curl -X POST http://localhost:3002/api/clients \
  -H "X-API-Key: sk_..." \
  -H "Content-Type: application/json" \
  -d '{"org_id":"org_1","name":"Support","phone_number":"+1234567890"}'

# 4. Initialize WhatsApp session (scan QR code)
curl -X POST http://localhost:3002/api/clients/client_1/init \
  -H "X-API-Key: sk_..."

# 5. Send message
curl -X POST http://localhost:3002/api/clients/client_1/send-message \
  -H "X-API-Key: sk_..." \
  -H "Content-Type: application/json" \
  -d '{"to":"+9876543210","message":"Hello from WhatsApp!"}'
```

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| **[QUICKSTART.md](./QUICKSTART.md)** | 5-minute setup guide with common commands |
| **[WORKING.md](./WORKING.md)** | Complete system architecture & implementation details |
| **[INTEGRATION.md](./INTEGRATION.md)** | Module integration guide & comprehensive API reference |
| **[DEPLOYMENT.md](./DEPLOYMENT.md)** | Production deployment on Ubuntu VPS, Docker, CI/CD |

---

## 🏗️ Architecture Overview

### System Components

```
┌─────────────────────────────────────────┐
│     Express.js REST API Server          │
├─────────────────────────────────────────┤
│ Auth | Clients | Messages | Team        │
│ Webhooks | Analytics | Media            │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────────────────────────────┐
│        Core Manager Layer                │
├──────────────────────────────────────────┤
│ • TeamManager (RBAC, Auth)               │
│ • AdvancedAntiBanManager (Anti-ban)      │
│ • MediaManager (Files)                   │
│ • WebhookManager (Events)                │
│ • AnalyticsManager (Metrics)             │
│ • Logger (Structured logging)            │
└──────────────────┬───────────────────────┘
                   │
┌──────────────────────────────────────────┐
│      Database Layer (db.js)              │
├──────────────────────────────────────────┤
│ • Parameterized Queries                  │
│ • Connection Pooling                     │
│ • Encryption (AES-256-GCM)               │
│ • Transaction Support                    │
└──────────────────┬───────────────────────┘
                   │
┌──────────────────────────────────────────┐
│       PostgreSQL + Redis                 │
├──────────────────────────────────────────┤
│ Organizations • Users • Clients           │
│ Messages • Contacts • Webhooks           │
│ Analytics • Audit Logs • Media Files     │
└──────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 14+ |
| **Framework** | Express.js |
| **Database** | PostgreSQL 12+ |
| **Cache** | Redis 6+ (optional) |
| **WhatsApp** | whatsapp-web.js + Puppeteer |
| **Auth** | JWT + API Keys |
| **Security** | bcryptjs, crypto, helmet |
| **Deployment** | Docker, Docker Compose, Nginx |
| **Testing** | Jest, Apache Bench |

---

## 📊 API Overview

### Main Endpoints

| Category | Method | Endpoint | Purpose |
|----------|--------|----------|---------|
| **Auth** | POST | `/api/auth/register` | Create organization & admin |
| | POST | `/api/auth/login` | Login and get token |
| **Clients** | POST | `/api/clients` | Create WhatsApp client |
| | POST | `/api/clients/:id/init` | Initialize WhatsApp session |
| | GET | `/api/clients/:id/status` | Get client status |
| **Messages** | POST | `/api/clients/:id/send-message` | Send text/media message |
| | GET | `/api/clients/:id/messages` | Get message history |
| **Team** | POST | `/api/team/members` | Add team member |
| | POST | `/api/team/members/:id/clients/:cid` | Assign client to member |
| | GET | `/api/audit-logs` | View activity logs |
| **Webhooks** | POST | `/api/webhooks` | Register webhook |
| | GET | `/api/webhooks` | List webhooks |
| | POST | `/api/webhooks/:id/test` | Test webhook delivery |
| **Analytics** | GET | `/api/analytics/stats` | Organization dashboard stats |
| | GET | `/api/analytics/metrics` | Message metrics by date |
| | GET | `/api/analytics/campaigns/:id/export` | Export campaign report |
| **Media** | POST | `/api/media/upload` | Upload media file |
| | GET | `/api/media/:id/download` | Download media file |
| **Health** | GET | `/health` | Service health check |

**Full API docs**: See [INTEGRATION.md](./INTEGRATION.md#api-documentation)

---

## 🔐 Database Schema

### Core Tables (25+ tables total)

| Table | Purpose |
|-------|---------|
| `organizations` | Tenant/organization data with plan levels |
| `users` | Team members with RBAC and organization isolation |
| `whatsapp_clients` | WhatsApp client instances per organization |
| `messages` | All sent/received messages with metadata |
| `contacts` | Contact information and engagement metrics |
| `automations` | Workflow automation definitions |
| `campaigns` | Marketing campaign tracking |
| `templates` | Message templates |
| `webhooks` | Event webhook registrations |
| `webhook_deliveries` | Webhook delivery history and retries |
| `message_metrics` | Daily aggregated message statistics |
| `audit_logs` | Complete activity audit trail |
| `file_uploads` | Media files and metadata |
| `proxy_pool` | Available proxy servers for anti-ban |
| `browser_profiles` | Stored browser fingerprints |
| `ban_alerts` | WhatsApp ban detection events |
| `api_keys` | API key management |
| `rate_limits` | Message rate limiting records |

**Full schema**: See [database.sql](./database.sql)

---

## 🔒 Security Features

### SQL Injection Prevention
```javascript
// All queries use parameterized values
await db.query('SELECT * FROM users WHERE id = $1', [userId]);
// Safe: user input never concatenated into SQL
```

### Encryption at Rest
```javascript
// Sensitive data encrypted with AES-256-GCM
const encrypted = await db.encryptSensitive(password);
// Stored encrypted, decrypted on retrieval
```

### Authentication & Authorization
- **JWT tokens** for API authentication
- **API keys** for integrations with bcrypt hashing
- **Role-based access control** (Admin/Manager/Agent/Viewer)
- **Organization-level isolation** on every query

### Anti-Ban Protection
```javascript
// Automatic in-app protection
- IP proxy rotation from pool
- Browser fingerprint randomization
- Human behavior simulation (typing delays, pauses)
- Rate limiting (20/min, 100/hr, 1000/day)
- Suspicious activity detection
```

---

## 🛠️ Configuration

### Environment Variables (See .env.example)

```

### Key Configuration Variables

```bash
# Database Connection
DB_USER=postgres
DB_PASSWORD=your_password
DB_HOST=postgres
DB_NAME=whatsapp_service
DB_PORT=5432

# Encryption Keys (generate with: openssl rand -hex 32)
DB_ENCRYPTION_KEY=abc123def456...
ENCRYPTION_KEY=xyz789...

# JWT Secret (min 32 characters)
JWT_SECRET=your-super-secret-jwt-key-min-32-chars

# Server
PORT=3002
NODE_ENV=development

# Rate Limiting (messages per time window)
MESSAGE_RATE_LIMIT_PER_MINUTE=20
MESSAGE_RATE_LIMIT_PER_HOUR=100
MESSAGE_RATE_LIMIT_PER_DAY=1000

# Anti-Ban Settings
ENABLE_ANTI_BAN=true
PROXY_ROTATION_ENABLED=true
SESSION_ROTATION_INTERVAL=3600

# Media Storage
UPLOAD_MAX_SIZE=104857600  # 100MB
STORAGE_QUOTA=5368709120   # 5GB per org

# Webhooks
WEBHOOK_TIMEOUT=30000
WEBHOOK_MAX_RETRIES=3
WEBHOOK_RETRY_DELAY_MS=2000

# CORS & Security
CORS_ORIGINS=http://localhost:3002,https://yourdomain.com
```

**Full configuration**: See [.env.example](./.env.example) with 60+ variables

---

## 🚀 Deployment

### Local Development
```bash
# Using Docker Compose (Recommended)
docker-compose up -d

# Or with npm
npm install
npm start
```

### Production VPS
```bash
# Complete Ubuntu setup guide
See: DEPLOYMENT.md

# Quick summary:
1. Install Node.js, PostgreSQL, Nginx
2. Clone repository
3. Configure .env with production values
4. Set up SSL certificates (Let's Encrypt)
5. Configure Nginx reverse proxy
6. Use PM2 for process management
7. Enable firewall rules
```

### Docker Build
```bash
# Build custom image
docker build -t whatsapp-service:latest .

# Run container
docker run -d \
  -p 3002:3002 \
  -e DB_HOST=postgres \
  -e DB_PASSWORD=secure \
  whatsapp-service:latest
```

---

## 🧪 Testing

### Health Check
```bash
curl http://localhost:3002/health
# Response: {"status":"healthy","activeClients":0,...}
```

### API Test
```bash
# Run API tests
npm test

# Load testing
ab -n 1000 -c 50 http://localhost:3002/health
```

### Database Test
```bash
# Connect to database
psql -U postgres -d whatsapp_service

# List tables
\dt

# Check users
SELECT * FROM users;
```

---

## 🔄 Module Details

| Module | Purpose | Key Classes |
|--------|---------|------------|
| **db.js** | Database abstraction | QueryBuilder, Pool, Encryption |
| **anti-ban.js** | Anti-ban protection | AdvancedAntiBanManager |
| **media-manager.js** | File handling | MediaManager |
| **webhook-manager.js** | Event delivery | WebhookManager |
| **team-manager.js** | User management | TeamManager (RBAC) |
| **analytics-manager.js** | Metrics & reports | AnalyticsManager |
| **logger.js** | Structured logging | Logger |

**Full integration guide**: See [INTEGRATION.md](./INTEGRATION.md)

---

## 📈 Scaling & Performance

### Horizontal Scaling
- Use load balancer (Nginx, HAProxy)
- Multiple app instances behind reverse proxy
- Shared PostgreSQL database
- Redis for session caching (optional)

### Database Optimization
- Indexes on frequently queried columns
- Query caching (5-minute TTL)
- Connection pooling (max 20 connections)
- Regular VACUUM and ANALYZE

### Anti-Ban & Rate Limiting
- Distributed rate limiting (per organization, per client)
- Proxy pool rotation to distribute load
- Message queuing for peak handling
- Adaptive rate limits based on WhatsApp signals

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "Cannot connect to PostgreSQL" | Check DB credentials, ensure PostgreSQL is running |
| "Port 3002 already in use" | Change PORT in .env or kill existing process |
| "QR code not generating" | Ensure Puppeteer has access to display (X11 or xvfb) |
| "Rate limit exceeded" | Wait or increase limits in .env |
| "Client not ready" | Wait for QR code to be scanned completely |
| "Webhook delivery failed" | Check endpoint is public and responding |
| "Database encryption key invalid" | Regenerate key with: `openssl rand -hex 32` |

**More help**: Check logs with `docker-compose logs -f whatsapp-service`

---

## 🤝 Contributing

Contributions welcome! Please:
1. Fork repository
2. Create feature branch
3. Commit changes
4. Submit pull request

---

## 📋 Roadmap

- [ ] GraphQL API support
- [ ] Message scheduling
- [ ] Advanced NLP filtering
- [ ] Sentiment analysis
- [ ] Custom webhook payload mapping
- [ ] Bulk message API
- [ ] Contact sync from CRM
- [ ] A/B testing campaigns
- [ ] AI-powered responses
- [ ] Multi-language support

---

## 📄 License

MIT License - See LICENSE file

---

## 📞 Support & Contact

- **GitHub Issues**: https://github.com/sachinkumar6910-cloud/whatsapp-service/issues
- **Documentation**: Check README, WORKING.md, DEPLOYMENT.md, INTEGRATION.md
- **Status**: Actively maintained ✅
- **Last Updated**: 2024-01-15

---

## 🎉 Success!

Your WhatsApp Service v2.0 is ready to deploy!

### Next Steps:
1. ✅ Set up development environment (Docker)
2. ✅ Create your organization
3. ✅ Add WhatsApp clients
4. ✅ Send messages via API
5. ⬜ Deploy to production
6. ⬜ Scale to your needs

### Resources:
- **Quick Start**: [QUICKSTART.md](./QUICKSTART.md)
- **Full Docs**: [WORKING.md](./WORKING.md)
- **API Reference**: [INTEGRATION.md](./INTEGRATION.md)
- **Deployment**: [DEPLOYMENT.md](./DEPLOYMENT.md)

---

**Built with ❤️ for WhatsApp Business Automation**  
**Enterprise-Grade • Secure • Scalable • Production-Ready**

## Session Storage

Sessions are stored in Docker volumes:
- **Container**: `/app/sessions`
- **Host Volume**: `whatsapp_sessions`

## Environment Variables

```env
PORT=3002
NODE_ENV=development
SESSIONS_DIR=./sessions
CORS_ORIGIN=http://localhost:3000,http://localhost:3001,http://localhost:1337,http://localhost:3002
```

## Comparison with Evolution API

| Feature | Evolution API | WhatsApp Service |
|---------|---------------|------------------|
| QR Codes | ❌ Broken | ✅ Working |
| Multi-tenant | ✅ | ✅ |
| REST API | ✅ | ✅ |
| Dashboard | ⚠️ Buggy | ✅ Clean |
| Session Persistence | ✅ | ✅ |
| Message Sending | ✅ | ✅ |
| Reliability | ❌ Issues | ✅ Stable |

## Troubleshooting

### QR Code Not Appearing
- Wait 10-30 seconds after creating client
- Check browser console for errors
- Ensure client ID is unique

### Connection Issues
- Check Docker logs: `docker logs leadgen-whatsapp`
- Verify Puppeteer dependencies
- Check session permissions

### Session Lost
- Sessions are persisted in Docker volumes
- Recreate client if session is corrupted

## Development

```bash
cd whatsapp-service
npm install
npm run dev  # With nodemon
```

## Production Deployment

- Use environment variables for configuration
- Set up proper logging
- Configure reverse proxy (nginx)
- Set up monitoring
- Use managed database for client metadata (optional)

## License

MIT