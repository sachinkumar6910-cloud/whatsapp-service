#!/bin/bash

# WhatsApp Service - Ubuntu VPS Setup Script
# Run this on your Ubuntu VPS to set up the WhatsApp service

set -e

echo "🚀 Setting up WhatsApp Service on Ubuntu VPS..."

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+ (required for whatsapp-web.js)
echo "📦 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Chromium via Snap
echo "📦 Installing Chromium browser..."
sudo snap install chromium

# Verify installations
echo "✅ Verifying installations..."
node --version
npm --version
chromium --version || echo "Chromium installed via snap"

# Create application directory
echo "📁 Creating application directory..."
sudo mkdir -p /opt/whatsapp-service
sudo chown $USER:$USER /opt/whatsapp-service

# Copy application files (you'll need to upload these)
echo "📋 Next steps:"
echo "1. Upload your WhatsApp service files to /opt/whatsapp-service/"
echo "2. Copy .env.production to .env and configure it"
echo "3. Run: cd /opt/whatsapp-service && npm install --production"
echo "4. Test: node simple-server.js"
echo "5. Set up process management with PM2"

echo "🎉 Ubuntu setup complete!"
echo "📖 See README-UBUNTU.md for detailed deployment instructions"