# Quick Start Guide - WhatsApp Service v2.0

## 🚀 5-Minute Setup (Docker)

### Step 1: Clone & Navigate
```bash
git clone https://github.com/sachinkumar6910-cloud/whatsapp-service.git
cd whatsapp-service
```

### Step 2: Create Environment File
```bash
cp .env.example .env
nano .env  # Edit with your settings
```

### Step 3: Start Services
```bash
docker-compose up -d
```

### Step 4: Verify Installation
```bash
# Check if services are running
docker-compose ps

# View logs
docker-compose logs -f whatsapp-service

# Test API
curl http://localhost:3002/health
```

**Success!** Your WhatsApp Service is now running at `http://localhost:3002`

---

## 📚 Core Concepts

### Multi-Tenancy
Each organization can have multiple:
- WhatsApp clients (phone numbers)
- Team members with different roles
- Contacts and message history
- Webhooks and automations

### Role-Based Access Control (RBAC)
- **Admin**: Full access to organization
- **Manager**: Manage team and view analytics
- **Agent**: Send messages from assigned clients
- **Viewer**: View-only access

### Anti-Ban Protection
Automatic protection includes:
- IP proxy rotation
- Browser fingerprint randomization
- Human behavior simulation (delays, typing patterns)
- Rate limiting (20/min, 100/hr, 1000/day)
- Suspicious activity detection

---

## 🔑 Getting Started (5 Steps)

### 1. Register Organization
```bash
curl -X POST http://localhost:3002/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@company.com",
    "password": "secure_password",
    "name": "Admin Name",
    "organization_name": "Your Company"
  }'
```

Save the returned `token` or get API key from dashboard.

### 2. Create WhatsApp Client
```bash
curl -X POST http://localhost:3002/api/clients \
  -H "X-API-Key: sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "org_id": "org_123",
    "name": "Sales Support",
    "phone_number": "+1234567890"
  }'
```

Save the `client.id`.

### 3. Initialize WhatsApp Session
```bash
curl -X POST http://localhost:3002/api/clients/client_123/init \
  -H "X-API-Key: sk_..."
```

**Scan QR code with WhatsApp** on your phone.

### 4. Send Your First Message
```bash
curl -X POST http://localhost:3002/api/clients/client_123/send-message \
  -H "X-API-Key: sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+9876543210",
    "message": "Hello from WhatsApp!"
  }'
```

### 5. Check Status
```bash
curl http://localhost:3002/health
```

---

## 📊 Dashboard

Access the web dashboard:
```
http://localhost:3002/dashboard.html
```

Features:
- Real-time message metrics
- Client status monitoring
- Team member management
- Webhook configuration
- Analytics and reports

---

## 🔌 API Overview

### Authentication
Use API Key in header: `X-API-Key: sk_your_api_key`

### Main Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| **Auth** | | |
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Get token |
| **Clients** | | |
| POST | `/api/clients` | Create WhatsApp client |
| POST | `/api/clients/:id/init` | Start WhatsApp session |
| GET | `/api/clients/:id/status` | Get client status |
| **Messages** | | |
| POST | `/api/clients/:id/send-message` | Send message |
| GET | `/api/clients/:id/messages` | Get history |
| **Team** | | |
| POST | `/api/team/members` | Add team member |
| POST | `/api/team/members/:userId/clients/:clientId` | Assign client |
| GET | `/api/audit-logs` | View activity logs |
| **Webhooks** | | |
| POST | `/api/webhooks` | Register webhook |
| GET | `/api/webhooks` | List webhooks |
| POST | `/api/webhooks/:id/test` | Test webhook |
| **Analytics** | | |
| GET | `/api/analytics/stats` | Dashboard stats |
| GET | `/api/analytics/metrics` | Message metrics |
| GET | `/api/analytics/storage` | Storage usage |
| **Media** | | |
| POST | `/api/media/upload` | Upload file |
| GET | `/api/media/:id/download` | Download file |

---

## 🛠️ Configuration

### Essential Variables (.env)

```bash
# Database
DB_USER=postgres
DB_PASSWORD=change_me
DB_HOST=postgres
DB_NAME=whatsapp_service

# Encryption (generate: openssl rand -hex 32)
DB_ENCRYPTION_KEY=your-key-here
ENCRYPTION_KEY=your-key-here

# JWT (min 32 chars)
JWT_SECRET=your-secret-key-here

# Server
PORT=3002

# Rate Limits
MESSAGE_RATE_LIMIT_PER_MINUTE=20
MESSAGE_RATE_LIMIT_PER_HOUR=100
MESSAGE_RATE_LIMIT_PER_DAY=1000
```

See `.env.example` for all 60+ variables.

---

## 📦 Deployment

### Docker Compose (Development)
```bash
docker-compose up -d
docker-compose logs -f
docker-compose down
```

### VPS Deployment
See `DEPLOYMENT.md` for complete Ubuntu setup guide.

---

## 🧪 Testing

### Health Check
```bash
curl http://localhost:3002/health
```

### Run Tests
```bash
npm test
```

### Load Test
```bash
ab -n 1000 -c 50 http://localhost:3002/health
```

---

## 📖 Full Documentation

- **WORKING.md** - Comprehensive system documentation
- **DEPLOYMENT.md** - Production deployment guide
- **INTEGRATION.md** - Module integration guide & API docs

---

## 🆘 Troubleshooting

| Problem | Solution |
|---------|----------|
| "Cannot connect to database" | Check PostgreSQL running: `docker-compose ps` |
| "Port 3002 already in use" | Change PORT in .env or kill process: `lsof -i :3002` |
| "API key not recognized" | Verify header: `X-API-Key: sk_...` |
| "Client not ready" | Wait for QR code scan to complete |
| "Rate limit exceeded" | Wait before sending more, or increase limits in .env |

---

## 🎯 Next Steps

1. ✅ Set up development environment (Docker Compose)
2. ✅ Create your first WhatsApp client
3. ✅ Send test messages
4. ✅ Set up webhooks for notifications
5. ✅ Add team members with RBAC
6. ✅ Configure analytics & reporting
7. ⬜ Deploy to production VPS
8. ⬜ Set up CI/CD pipeline

---

## 🚀 Pro Tips

- **Proxies**: Add proxy servers to avoid bans (`proxy_pool` table)
- **Webhooks**: Set up event notifications for real-time updates
- **Team**: Use agents for distributed message sending
- **Analytics**: Export reports for business intelligence
- **Media**: Upload company logos/images for campaigns
- **Rate Limits**: Adjust based on your sending patterns
- **Monitoring**: Check logs regularly: `docker-compose logs whatsapp-service`

---

## 💬 Support

- **Documentation**: Check README, WORKING.md, DEPLOYMENT.md, INTEGRATION.md
- **GitHub Issues**: https://github.com/sachinkumar6910-cloud/whatsapp-service/issues
- **Health Check**: `curl http://localhost:3002/health`

---

## ✨ Features

✅ Multi-tenant SaaS architecture  
✅ PostgreSQL database with encryption  
✅ Role-based access control (RBAC)  
✅ Advanced anti-ban protection  
✅ Media message support (image, video, audio, documents)  
✅ Webhook event system with retry logic  
✅ Team collaboration & audit logging  
✅ Real-time analytics & reporting  
✅ API key management  
✅ Docker containerization  
✅ Rate limiting & security  
✅ Production-ready deployment  

---

**Version**: 2.0.0  
**Node.js**: 14+  
**PostgreSQL**: 12+  
**Last Updated**: 2024-01-15

Enjoy building! 🚀
