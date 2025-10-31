#!/bin/bash

# WhatsApp Service - Ubuntu Production Test Script
# Run this after deployment to verify everything works

echo "🧪 Testing WhatsApp Service on Ubuntu VPS..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ $2${NC}"
    else
        echo -e "${RED}❌ $2${NC}"
    fi
}

# Test 1: Check if Node.js is installed
echo "Testing Node.js installation..."
node --version > /dev/null 2>&1
print_status $? "Node.js installed"

# Test 2: Check if Chromium is available
echo "Testing Chromium installation..."
/snap/bin/chromium --version > /dev/null 2>&1
print_status $? "Chromium installed"

# Test 3: Check if PM2 is installed
echo "Testing PM2 installation..."
pm2 --version > /dev/null 2>&1
print_status $? "PM2 installed"

# Test 4: Check if application directory exists
echo "Testing application directory..."
[ -d "/opt/whatsapp-service" ]
print_status $? "Application directory exists"

# Test 5: Check if service is running
echo "Testing service status..."
pm2 describe whatsapp-service > /dev/null 2>&1
print_status $? "WhatsApp service running in PM2"

# Test 6: Check if port is listening
echo "Testing service port..."
nc -z localhost 3002
print_status $? "Port 3002 is listening"

# Test 7: Check health endpoint
echo "Testing health endpoint..."
curl -s -f http://localhost:3002/health > /dev/null 2>&1
print_status $? "Health endpoint responding"

# Test 8: Check Nginx configuration
echo "Testing Nginx configuration..."
sudo nginx -t > /dev/null 2>&1
print_status $? "Nginx configuration valid"

# Test 9: Check SSL certificate (if domain is configured)
echo "Testing SSL certificate..."
if [ -f "/etc/letsencrypt/live/$(hostname -f)/cert.pem" ]; then
    echo -e "${GREEN}✅ SSL certificate installed${NC}"
else
    echo -e "${YELLOW}⚠️  SSL certificate not found (may not be configured yet)${NC}"
fi

# Test 10: Check firewall
echo "Testing firewall..."
sudo ufw status | grep -q "Status: active"
print_status $? "Firewall is active"

echo ""
echo "🎯 Test Summary:"
echo "If all tests passed, your WhatsApp service is ready for production!"
echo ""
echo "📊 Service URLs:"
echo "  Health: http://localhost:3002/health"
echo "  Dashboard: http://localhost:3002/"
echo "  API: http://localhost:3002/clients"
echo ""
echo "🔧 Management:"
echo "  Logs: pm2 logs whatsapp-service"
echo "  Monitor: pm2 monit"
echo "  Restart: pm2 restart whatsapp-service"