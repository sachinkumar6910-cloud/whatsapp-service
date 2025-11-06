# WhatsApp Service v2.0 - Deployment & Setup Guide

## 🚀 Quick Start

### Prerequisites
- Node.js >= 14.0.0
- PostgreSQL >= 12
- Docker & Docker Compose (optional but recommended)
- 2+ GB RAM minimum
- Linux/macOS/Windows (with WSL2)

---

## 📦 Installation Methods

### Method 1: Docker Compose (Recommended)

```bash
# Clone repository
git clone https://github.com/sachinkumar6910-cloud/whatsapp-service.git
cd whatsapp-service

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
nano .env

# Start all services
docker-compose up -d

# Check logs
docker-compose logs -f whatsapp-service

# Access services
# App: http://localhost:3002
# Dashboard: http://localhost:3002/dashboard.html
# PgAdmin: http://localhost:5050 (dev only)
```

### Method 2: Manual Installation

```bash
# 1. Install dependencies
npm install

# 2. Set up PostgreSQL database
# Option A: Using Docker
docker run --name whatsapp-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=whatsapp_service \
  -p 5432:5432 \
  -d postgres:15-alpine

# Option B: Install locally (macOS)
brew install postgresql@15
brew services start postgresql@15

# 3. Create database
createdb whatsapp_service

# 4. Initialize schema
psql -U postgres -d whatsapp_service -f database.sql

# 5. Create .env file
cp .env.example .env
nano .env  # Edit with your settings

# 6. Start application
npm start
```

---

## 🔧 Configuration

### Essential Environment Variables

```bash
# Database
DB_USER=postgres
DB_PASSWORD=your_secure_password
DB_HOST=localhost
DB_NAME=whatsapp_service

# Encryption (generate with: openssl rand -hex 32)
DB_ENCRYPTION_KEY=your-32-character-hex-key
ENCRYPTION_KEY=your-32-character-hex-key

# JWT Secret (min 32 chars)
JWT_SECRET=your-super-secret-jwt-key-min-32-characters

# Ports
PORT=3002

# Anti-ban settings
MESSAGE_RATE_LIMIT_PER_MINUTE=20
MESSAGE_RATE_LIMIT_PER_HOUR=100
MESSAGE_RATE_LIMIT_PER_DAY=1000
```

---

## 🗄️ Database Setup

### Create Encryption Key

```bash
# Generate a random 32-byte hex key
openssl rand -hex 32
# Output: abc123def456...
# Copy this to DB_ENCRYPTION_KEY in .env
```

### Initialize Database

```bash
# Option 1: Using psql
psql -U postgres -d whatsapp_service -f database.sql

# Option 2: Using Docker
docker exec -i whatsapp-postgres psql -U postgres -d whatsapp_service < database.sql

# Option 3: Using Docker Compose
docker-compose exec postgres psql -U postgres -d whatsapp_service -f /docker-entrypoint-initdb.d/init.sql
```

### Verify Installation

```bash
psql -U postgres -d whatsapp_service -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';"
```

---

## 🌐 Nginx Configuration

### Generate SSL Certificates (Let's Encrypt)

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Generate certificate
sudo certbot certonly --standalone -d yourdomain.com

# Update nginx.conf with your domain
sudo nano /etc/nginx/sites-available/whatsapp-service

# Enable site
sudo ln -s /etc/nginx/sites-available/whatsapp-service /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### Nginx Configuration for VPS

```nginx
# /etc/nginx/sites-available/whatsapp-service

upstream whatsapp_backend {
    server 127.0.0.1:3002 max_fails=5 fail_timeout=30s;
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL Certificates
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript;
    gzip_min_length 1024;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=100r/m;
    limit_req zone=api burst=20 nodelay;

    # Proxy configuration
    location / {
        proxy_pass http://whatsapp_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Buffering
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # Static files cache
    location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
        proxy_pass http://whatsapp_backend;
        proxy_cache_valid 200 10d;
        add_header Cache-Control "public, immutable";
    }

    # Health check endpoint
    location /health {
        access_log off;
        proxy_pass http://whatsapp_backend;
    }
}
```

---

## 🐳 Docker Deployment

### Build Custom Docker Image

```bash
# Create Dockerfile
cat > Dockerfile << 'EOF'
FROM node:18-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    chromium \
    ca-certificates \
    dumb-init

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application
COPY . .

# Create necessary directories
RUN mkdir -p sessions uploads logs .wwebjs_cache

# Non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 3002

ENTRYPOINT ["/sbin/dumb-init", "--"]
CMD ["node", "simple-server.js"]
EOF

# Build image
docker build -t whatsapp-service:latest .

# Run container
docker run -d \
  --name whatsapp-service \
  -e NODE_ENV=production \
  -e DB_HOST=postgres \
  -e DB_PASSWORD=your_password \
  -p 3002:3002 \
  -v whatsapp-sessions:/app/sessions \
  -v whatsapp-uploads:/app/uploads \
  whatsapp-service:latest
```

---

## 🚀 Production Deployment (Ubuntu VPS)

### Step 1: Initial Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Install Nginx
sudo apt install -y nginx

# Install Certbot for SSL
sudo apt install -y certbot python3-certbot-nginx

# Install PM2 for process management
sudo npm install -g pm2
```

### Step 2: Database Setup

```bash
# Create database
sudo -u postgres createdb whatsapp_service

# Create database user
sudo -u postgres createuser whatsapp_user

# Set password
sudo -u postgres psql -c "ALTER USER whatsapp_user WITH PASSWORD 'secure_password';"

# Grant permissions
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE whatsapp_service TO whatsapp_user;"

# Initialize schema
sudo -u postgres psql whatsapp_service < /home/user/whatsapp-service/database.sql
```

### Step 3: Application Deployment

```bash
# Clone repository
cd /opt
sudo git clone https://github.com/sachinkumar6910-cloud/whatsapp-service.git
sudo chown -R $USER:$USER whatsapp-service
cd whatsapp-service

# Install dependencies
npm install --production

# Copy and configure .env
cp .env.example .env
nano .env  # Edit with your settings

# Create PM2 ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'whatsapp-service',
    script: './simple-server.js',
    instances: 2,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production'
    },
    max_memory_restart: '1G',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
EOF

# Start with PM2
pm2 start ecosystem.config.js

# Make PM2 persistent
pm2 startup
pm2 save
```

### Step 4: Nginx Setup

```bash
# Copy Nginx configuration
sudo cp nginx.conf /etc/nginx/sites-available/whatsapp-service

# Enable site
sudo ln -s /etc/nginx/sites-available/whatsapp-service /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Get SSL certificate
sudo certbot certonly --nginx -d yourdomain.com

# Update nginx.conf with domain
sudo sed -i 's/yourdomain.com/yourdomain.com/g' /etc/nginx/sites-available/whatsapp-service

# Reload Nginx
sudo systemctl reload nginx

# Enable SSL renewal
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

### Step 5: Firewall Configuration

```bash
# Configure UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw enable
```

---

## 📊 Monitoring & Maintenance

### PM2 Monitoring

```bash
# View logs
pm2 logs whatsapp-service

# Monitor process
pm2 monit

# View process info
pm2 show whatsapp-service

# Restart service
pm2 restart whatsapp-service

# Stop service
pm2 stop whatsapp-service
```

### Database Maintenance

```bash
# Backup database
pg_dump -U whatsapp_user whatsapp_service > backup.sql

# Restore database
psql -U whatsapp_user whatsapp_service < backup.sql

# Analyze database
vacuumdb -U whatsapp_user -d whatsapp_service -v

# Check connections
psql -U whatsapp_user -d whatsapp_service -c "SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;"
```

### Log Rotation

```bash
# Create logrotate config
sudo nano /etc/logrotate.d/whatsapp-service

# Content:
/opt/whatsapp-service/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 nobody nobody
    sharedscripts
}

# Apply rotation
sudo logrotate -f /etc/logrotate.d/whatsapp-service
```

---

## 🔒 Security Hardening

### System Security

```bash
# SSH hardening
sudo sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Fail2ban
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Unattended upgrades
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### Database Security

```bash
# Backup database regularly
0 2 * * * /usr/bin/pg_dump -U whatsapp_user whatsapp_service | gzip > /backups/whatsapp_$(date +\%Y\%m\%d).sql.gz

# Enable SSL for database connections
# See PostgreSQL documentation for SSL setup
```

---

## 🧪 Testing

### Health Check

```bash
# Test API health
curl http://localhost:3002/health

# Response should be:
# {"status":"healthy","timestamp":1699...}
```

### Performance Testing

```bash
# Install Apache Bench
sudo apt install -y apache2-utils

# Test endpoint
ab -n 1000 -c 50 http://localhost:3002/health
```

---

## 🆘 Troubleshooting

### Common Issues

**Issue**: Database connection refused
```bash
# Solution: Check PostgreSQL status
sudo systemctl status postgresql
sudo systemctl start postgresql
```

**Issue**: Port 3002 already in use
```bash
# Solution: Find and kill process
lsof -i :3002
kill -9 <PID>
```

**Issue**: SSL certificate not found
```bash
# Solution: Regenerate certificate
sudo certbot certonly --standalone -d yourdomain.com
sudo systemctl reload nginx
```

---

## 📞 Support

- **GitHub Issues**: https://github.com/sachinkumar6910-cloud/whatsapp-service/issues
- **Documentation**: See WORKING.md
- **Email**: support@yourdomain.com

---

## 🎉 Success!

Your WhatsApp Service should now be running at:
- Dashboard: https://yourdomain.com/dashboard.html
- API: https://yourdomain.com/api
- Health: https://yourdomain.com/health
