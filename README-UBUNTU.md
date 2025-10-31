# WhatsApp Service - Ubuntu VPS Deployment Guide

Complete production deployment guide for running the WhatsApp service on Ubuntu VPS.

## 🚀 Quick Deployment

### Option 1: Automated Deployment (Recommended)

```bash
# On your Ubuntu VPS
wget https://raw.githubusercontent.com/your-repo/whatsapp-service/main/deploy-ubuntu.sh
chmod +x deploy-ubuntu.sh
sudo ./deploy-ubuntu.sh
```

### Option 2: Manual Setup

```bash
# Run the setup script
sudo ./setup-ubuntu.sh

# Then follow the manual steps below
```

## 📋 Prerequisites

- Ubuntu 20.04+ VPS
- Root or sudo access
- Domain name (optional but recommended)
- SSH access

## 🛠️ Manual Installation Steps

### 1. System Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Chromium
sudo snap install chromium

# Install PM2
sudo npm install -g pm2

# Install Nginx
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 2. Application Setup

```bash
# Create application directory
sudo mkdir -p /opt/whatsapp-service
sudo chown $USER:$USER /opt/whatsapp-service

# Upload your application files to /opt/whatsapp-service/
# This includes: simple-server.js, package.json, ecosystem.config.js, etc.

cd /opt/whatsapp-service

# Install dependencies
npm install --production

# Setup environment
cp .env.production .env
nano .env  # Edit with your configuration
```

### 3. Process Management

#### Using PM2 (Recommended)

```bash
# Start the service
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup auto-startup
pm2 startup
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp $HOME

# Enable PM2 auto-start
sudo systemctl enable pm2-$USER
```

#### Using Systemd (Alternative)

```bash
# Copy service file
sudo cp whatsapp-service.service /etc/systemd/system/

# Edit the service file with correct paths
sudo nano /etc/systemd/system/whatsapp-service.service

# Reload systemd and start service
sudo systemctl daemon-reload
sudo systemctl enable whatsapp-service
sudo systemctl start whatsapp-service
```

### 4. Web Server Configuration

```bash
# Copy nginx configuration
sudo cp nginx.conf /etc/nginx/sites-available/whatsapp-service

# Edit domain name
sudo nano /etc/nginx/sites-available/whatsapp-service
# Replace 'yourdomain.com' with your actual domain

# Enable site
sudo ln -s /etc/nginx/sites-available/whatsapp-service /etc/nginx/sites-enabled/

# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 5. SSL Certificate (Let's Encrypt)

```bash
# Get SSL certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Test renewal
sudo certbot renew --dry-run
```

### 6. Firewall Configuration

```bash
# Enable UFW
sudo ufw --force enable

# Allow SSH and HTTP/HTTPS
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'

# Check status
sudo ufw status
```

## 🔧 Management Commands

### PM2 Commands

```bash
# Status
pm2 status

# Logs
pm2 logs whatsapp-service

# Monitor
pm2 monit

# Restart
pm2 restart whatsapp-service

# Stop
pm2 stop whatsapp-service

# Delete
pm2 delete whatsapp-service
```

### Systemd Commands (if using systemd)

```bash
# Status
sudo systemctl status whatsapp-service

# Logs
sudo journalctl -u whatsapp-service -f

# Restart
sudo systemctl restart whatsapp-service

# Stop
sudo systemctl stop whatsapp-service
```

### Nginx Commands

```bash
# Test configuration
sudo nginx -t

# Reload
sudo systemctl reload nginx

# Restart
sudo systemctl restart nginx
```

## 📊 Monitoring & Logs

### Application Logs

```bash
# PM2 logs
pm2 logs whatsapp-service

# Direct log files
tail -f /opt/whatsapp-service/logs/out.log
tail -f /opt/whatsapp-service/logs/err.log
```

### System Logs

```bash
# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# System logs
sudo journalctl -u whatsapp-service -f
```

### Health Checks

```bash
# Application health
curl https://yourdomain.com/health

# PM2 status
pm2 jlist
```

## 🔒 Security Considerations

### 1. File Permissions

```bash
# Secure application directory
sudo chown -R $USER:$USER /opt/whatsapp-service
sudo chmod -R 755 /opt/whatsapp-service
sudo chmod 600 /opt/whatsapp-service/.env
```

### 2. Firewall

```bash
# Only allow necessary ports
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
```

### 3. SSL/TLS

- Always use HTTPS in production
- Keep certificates updated with certbot
- Use strong SSL settings

### 4. Environment Variables

- Never commit `.env` files
- Use strong secrets
- Rotate API keys regularly

## 🚨 Troubleshooting

### Service Won't Start

```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs whatsapp-service

# Check if port is in use
sudo netstat -tlnp | grep :3002

# Check Node.js
node --version
```

### Chromium Issues

```bash
# Check if Chromium is installed
/snap/bin/chromium --version

# Test Chromium manually
/snap/bin/chromium --headless --no-sandbox --disable-dev-shm-usage --disable-gpu https://www.google.com
```

### Nginx Issues

```bash
# Test configuration
sudo nginx -t

# Check nginx status
sudo systemctl status nginx

# Check nginx logs
sudo tail -f /var/log/nginx/error.log
```

### SSL Issues

```bash
# Check certificate
sudo certbot certificates

# Renew certificates
sudo certbot renew

# Check nginx SSL configuration
sudo nginx -T | grep -A 10 "ssl_"
```

## 📈 Performance Optimization

### 1. PM2 Configuration

```javascript
// ecosystem.config.js
{
  "apps": [{
    "name": "whatsapp-service",
    "script": "simple-server.js",
    "instances": 1,
    "max_memory_restart": "1G",
    "node_args": "--max-old-space-size=1024",
    "env": {
      "NODE_ENV": "production"
    }
  }]
}
```

### 2. Nginx Optimization

```nginx
# Add to nginx.conf
worker_processes auto;
worker_connections 1024;

# Enable gzip
gzip on;
gzip_types text/plain text/css application/json application/javascript;
```

### 3. System Limits

```bash
# Increase file limits
echo "fs.file-max = 65536" | sudo tee -a /etc/sysctl.conf
echo "* soft nofile 65536" | sudo tee -a /etc/security/limits.conf
echo "* hard nofile 65536" | sudo tee -a /etc/security/limits.conf
```

## 🔄 Backup & Recovery

### Database Backup (if using external DB)

```bash
# Create backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
mongodump --db whatsapp --out /opt/backups/whatsapp_$DATE
```

### Session Backup

```bash
# Backup sessions directory
tar -czf /opt/backups/sessions_$(date +%Y%m%d).tar.gz /opt/whatsapp-service/sessions/
```

### Automated Backups

```bash
# Add to crontab
0 2 * * * /path/to/backup-script.sh
```

## 📞 Support

For issues:
1. Check logs: `pm2 logs whatsapp-service`
2. Test health: `curl https://yourdomain.com/health`
3. Check system resources: `htop` or `top`
4. Review this documentation

## 📋 Checklist

- [ ] Ubuntu VPS provisioned
- [ ] Domain configured
- [ ] SSL certificate installed
- [ ] Application files uploaded
- [ ] Dependencies installed
- [ ] Environment configured
- [ ] Service running with PM2
- [ ] Nginx configured
- [ ] Firewall configured
- [ ] Backups configured
- [ ] Monitoring set up

---

**Happy deploying! 🚀**