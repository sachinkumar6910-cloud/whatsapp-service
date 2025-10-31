# WhatsApp Multi-Tenant Service

A Node.js service built with whatsapp-web.js that provides multi-tenant WhatsApp integration with a web dashboard.

## Features

- ✅ **Multi-tenant support** - Manage multiple WhatsApp accounts
- ✅ **QR code authentication** - Web-based QR code display
- ✅ **REST API** - Similar to Evolution API but working
- ✅ **Web dashboard** - Easy management interface
- ✅ **Session persistence** - Sessions survive container restarts
- ✅ **Message sending** - Send text and media messages
- ✅ **Real-time status** - Monitor connection status

## Quick Start

### Using Docker Compose

The service is included in the main docker-compose.yml:

```bash
# Build and start all services
docker-compose up --build

# Or just the WhatsApp service
docker-compose up whatsapp-service --build
```

### Access Points

- **Dashboard**: http://localhost:3002/dashboard
- **API**: http://localhost:3002/health
- **API Docs**: See API endpoints below

## API Endpoints

### Client Management

```http
POST /client/create
Content-Type: application/json

{
  "clientId": "client_abc"
}
```

```http
GET /client/:clientId/qr
# Returns QR code as data URL
```

```http
GET /client/:clientId/status
# Returns connection status
```

```http
DELETE /client/:clientId
# Deletes client and session
```

### Messaging

```http
POST /client/:clientId/send
Content-Type: application/json

{
  "to": "1234567890@c.us",
  "message": "Hello from WhatsApp API!"
}
```

### Management

```http
GET /clients
# List all clients

GET /health
# Service health check
```

## Dashboard Usage

1. **Create Client**: Enter a unique client ID
2. **Get QR Code**: Select client and generate QR code
3. **Scan with WhatsApp**: Use phone to scan the displayed QR code
4. **Send Messages**: Use the messaging interface
5. **Monitor Status**: Check connection status in real-time

## Architecture

- **whatsapp-web.js**: Core WhatsApp Web integration
- **Express.js**: REST API server
- **Puppeteer**: Browser automation for WhatsApp Web
- **LocalAuth**: Session persistence
- **Docker**: Containerized deployment

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