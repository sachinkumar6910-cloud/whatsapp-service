#!/bin/bash

# WhatsApp Service - Complete Ubuntu VPS Deployment Script
# This script handles the complete deployment process

set -e

# Configuration
APP_DIR="/opt/whatsapp-service"
DOMAIN="yourdomain.com"
EMAIL="admin@yourdomain.com"

echo "🚀 Starting complete WhatsApp Service deployment..."

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Update system
echo "📦 Updating system..."
sudo apt update && sudo apt upgrade -y

# Install required packages
echo "📦 Installing dependencies..."
sudo apt install -y curl wget gnupg2 software-properties-common ufw

# Install Node.js 18+
echo "📦 Installing Node.js 18..."
if ! command_exists node; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install Chromium
echo "📦 Installing Chromium..."
sudo snap install chromium

# Install PM2 globally
echo "📦 Installing PM2..."
if ! command_exists pm2; then
    sudo npm install -g pm2
fi

# Install Nginx
echo "📦 Installing Nginx..."
sudo apt install -y nginx

# Install Certbot for SSL (optional)
echo "📦 Installing Certbot..."
sudo apt install -y certbot python3-certbot-nginx

# Create application directory
echo "📁 Setting up application directory..."
sudo mkdir -p $APP_DIR
sudo mkdir -p $APP_DIR/logs
sudo mkdir -p $APP_DIR/sessions
sudo chown -R $USER:$USER $APP_DIR

# Copy application files (assuming they're in current directory)
echo "📋 Copying application files..."
cp -r . $APP_DIR/ 2>/dev/null || echo "⚠️  Please upload your application files to $APP_DIR"

# Install dependencies
echo "📦 Installing Node.js dependencies..."
cd $APP_DIR
if [ -f "package.json" ]; then
    npm install --production
fi

# Setup environment
echo "⚙️  Setting up environment..."
if [ ! -f ".env" ]; then
    cp .env.production .env
    echo "⚠️  Please edit $APP_DIR/.env with your configuration"
fi

# Configure firewall
echo "🔥 Configuring firewall..."
sudo ufw --force enable
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'

# Setup PM2
echo "⚙️  Setting up PM2 process management..."
pm2 delete whatsapp-service 2>/dev/null || true
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp $HOME

# Setup Nginx
echo "🌐 Configuring Nginx..."
sudo cp nginx.conf /etc/nginx/sites-available/whatsapp-service
sudo sed -i "s/yourdomain.com/$DOMAIN/g" /etc/nginx/sites-available/whatsapp-service

# Remove default nginx site if it exists
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/whatsapp-service /etc/nginx/sites-enabled/

# Test nginx configuration
sudo nginx -t

# Setup SSL (optional)
read -p "🔒 Do you want to setup SSL with Let's Encrypt? (y/n): " setup_ssl
if [[ $setup_ssl =~ ^[Yy]$ ]]; then
    echo "🔒 Setting up SSL certificate..."
    sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --email $EMAIL --agree-tos --non-interactive
fi

# Reload services
echo "🔄 Reloading services..."
sudo systemctl reload nginx
sudo systemctl enable nginx

# Create log rotation
echo "📝 Setting up log rotation..."
sudo tee /etc/logrotate.d/whatsapp-service > /dev/null <<EOF
$APP_DIR/logs/*.log {
    daily
    missingok
    rotate 52
    compress
    delaycompress
    notifempty
    create 644 $USER $USER
    postrotate
        pm2 reloadLogs
    endscript
}
EOF

# Setup monitoring (optional)
echo "📊 Setting up monitoring..."
pm2 monit

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Edit $APP_DIR/.env with your configuration"
echo "2. Upload your application files if not done already"
echo "3. Test the service: curl http://localhost:3002/health"
echo "4. Access your service at: https://$DOMAIN"
echo ""
echo "🔧 Management commands:"
echo "  Start:   pm2 start whatsapp-service"
echo "  Stop:    pm2 stop whatsapp-service"
echo "  Restart: pm2 restart whatsapp-service"
echo "  Logs:    pm2 logs whatsapp-service"
echo "  Monitor: pm2 monit"
echo ""
echo "📖 See README-UBUNTU.md for detailed documentation"