-- ================================================
-- WhatsApp Multi-Tenant Service - PostgreSQL Schema
-- ================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ================================================
-- ORGANIZATIONS & USERS
-- ================================================

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  plan VARCHAR(50) DEFAULT 'starter', -- starter, pro, enterprise
  status VARCHAR(50) DEFAULT 'active', -- active, suspended, inactive
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_status ON organizations(status);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role VARCHAR(50) DEFAULT 'agent', -- admin, manager, agent
  permissions JSONB DEFAULT '[]',
  status VARCHAR(50) DEFAULT 'active', -- active, inactive, suspended
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_users_org_id ON users(organization_id);
CREATE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_users_org_email ON users(organization_id, email);
CREATE INDEX idx_users_status ON users(status);

-- ================================================
-- WHATSAPP CLIENTS & SESSIONS
-- ================================================

CREATE TABLE whatsapp_clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id VARCHAR(255) NOT NULL,
  phone_number VARCHAR(20),
  status VARCHAR(50) DEFAULT 'initializing', -- initializing, waiting_for_qr, connected, disconnected, error
  device_info JSONB DEFAULT '{}', -- pushname, platform, battery, etc
  session_data BYTEA, -- encrypted session data
  proxy_config JSONB DEFAULT '{}', -- proxy IP, port, credentials
  browser_fingerprint JSONB DEFAULT '{}', -- browser profile data
  last_activity TIMESTAMP,
  message_count INT DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_clients_org_id ON whatsapp_clients(organization_id);
CREATE INDEX idx_clients_client_id ON whatsapp_clients(client_id);
CREATE INDEX idx_clients_status ON whatsapp_clients(status);
CREATE INDEX idx_clients_phone ON whatsapp_clients(phone_number);
CREATE UNIQUE INDEX idx_clients_org_id_client_id ON whatsapp_clients(organization_id, client_id);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES whatsapp_clients(id) ON DELETE CASCADE,
  session_hash VARCHAR(255) NOT NULL,
  ip_address INET,
  user_agent TEXT,
  device_fingerprint VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_sessions_client_id ON sessions(client_id);
CREATE INDEX idx_sessions_hash ON sessions(session_hash);

-- ================================================
-- MESSAGES
-- ================================================

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES whatsapp_clients(id) ON DELETE CASCADE,
  recipient VARCHAR(255) NOT NULL, -- phone@c.us or group@g.us
  sender VARCHAR(255),
  message_body TEXT,
  message_type VARCHAR(50) DEFAULT 'text', -- text, image, video, file, audio, document
  media_url TEXT,
  media_type VARCHAR(50), -- image/jpeg, video/mp4, etc
  media_size BIGINT,
  direction VARCHAR(20) DEFAULT 'outbound', -- inbound, outbound
  status VARCHAR(50) DEFAULT 'sent', -- sent, delivered, read, failed, pending
  message_id VARCHAR(255), -- WhatsApp message ID
  reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMP,
  read_at TIMESTAMP,
  failed_reason TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_messages_client_id ON messages(client_id);
CREATE INDEX idx_messages_recipient ON messages(recipient);
CREATE INDEX idx_messages_direction ON messages(direction);
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX idx_messages_type ON messages(message_type);

-- ================================================
-- CONTACTS & SEGMENTS
-- ================================================

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone_number VARCHAR(20) NOT NULL,
  name VARCHAR(255),
  email VARCHAR(255),
  tags JSONB DEFAULT '[]', -- array of tags
  custom_fields JSONB DEFAULT '{}', -- custom data
  first_contact_at TIMESTAMP,
  last_contacted_at TIMESTAMP,
  message_count INT DEFAULT 0,
  do_not_contact BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_contacts_org_id ON contacts(organization_id);
CREATE INDEX idx_contacts_phone ON contacts(phone_number);
CREATE INDEX idx_contacts_tags ON contacts USING GIN(tags);
CREATE UNIQUE INDEX idx_contacts_org_phone ON contacts(organization_id, phone_number);

CREATE TABLE segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  filter_criteria JSONB NOT NULL, -- filter conditions
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_segments_org_id ON segments(organization_id);

-- ================================================
-- AUTOMATIONS & CAMPAIGNS
-- ================================================

CREATE TABLE automations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES whatsapp_clients(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50), -- auto_reply, welcome, away, sequence, etc
  trigger_type VARCHAR(50), -- message_received, contact_added, time_based
  trigger_keywords JSONB DEFAULT '[]',
  response_template TEXT,
  actions JSONB DEFAULT '[]', -- array of actions
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_automations_org_id ON automations(organization_id);
CREATE INDEX idx_automations_client_id ON automations(client_id);
CREATE INDEX idx_automations_active ON automations(is_active);

CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES whatsapp_clients(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  template_id UUID,
  recipients_count INT DEFAULT 0,
  sent_count INT DEFAULT 0,
  delivered_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  read_count INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'draft', -- draft, scheduled, running, completed, paused, failed
  scheduled_for TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_campaigns_org_id ON campaigns(organization_id);
CREATE INDEX idx_campaigns_client_id ON campaigns(client_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);

CREATE TABLE campaign_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id),
  status VARCHAR(50) DEFAULT 'pending', -- pending, sent, delivered, failed, read
  failed_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_campaign_recipients_campaign_id ON campaign_recipients(campaign_id);
CREATE INDEX idx_campaign_recipients_contact_id ON campaign_recipients(contact_id);

-- ================================================
-- TEMPLATES
-- ================================================

CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(50), -- marketing, support, sales, etc
  variables JSONB DEFAULT '[]', -- template variables
  created_by UUID REFERENCES users(id),
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_templates_org_id ON templates(organization_id);
CREATE INDEX idx_templates_category ON templates(category);

-- ================================================
-- WEBHOOKS
-- ================================================

CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events JSONB DEFAULT '[]', -- message_sent, message_received, client_connected, etc
  headers JSONB DEFAULT '{}', -- custom headers
  is_active BOOLEAN DEFAULT TRUE,
  retry_count INT DEFAULT 3,
  timeout_seconds INT DEFAULT 30,
  secret_key VARCHAR(255) NOT NULL, -- for HMAC signature
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_webhooks_org_id ON webhooks(organization_id);
CREATE INDEX idx_webhooks_active ON webhooks(is_active);

CREATE TABLE webhook_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type VARCHAR(100),
  payload JSONB,
  status_code INT,
  response_time_ms INT,
  error_message TEXT,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_webhook_logs_webhook_id ON webhook_logs(webhook_id);
CREATE INDEX idx_webhook_logs_created_at ON webhook_logs(created_at DESC);

-- ================================================
-- ANALYTICS & METRICS
-- ================================================

CREATE TABLE message_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES whatsapp_clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  sent_count INT DEFAULT 0,
  delivered_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  read_count INT DEFAULT 0,
  average_response_time_seconds INT DEFAULT 0,
  inbound_count INT DEFAULT 0,
  outbound_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_metrics_client_id ON message_metrics(client_id);
CREATE INDEX idx_metrics_date ON message_metrics(date DESC);
CREATE UNIQUE INDEX idx_metrics_client_date ON message_metrics(client_id, date);

CREATE TABLE contact_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  first_response_time_seconds INT,
  total_messages INT DEFAULT 0,
  total_conversations INT DEFAULT 0,
  last_conversation_at TIMESTAMP,
  sentiment_score FLOAT, -- -1 to 1
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_contact_metrics_contact_id ON contact_metrics(contact_id);

-- ================================================
-- ANTI-BAN & SECURITY
-- ================================================

CREATE TABLE proxy_pool (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ip_address INET NOT NULL,
  port INT NOT NULL,
  protocol VARCHAR(20), -- http, https, socks5
  username VARCHAR(255),
  password_encrypted VARCHAR(500), -- encrypted
  country VARCHAR(100),
  status VARCHAR(50) DEFAULT 'active', -- active, inactive, blocked
  last_used TIMESTAMP,
  failure_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_proxy_pool_org_id ON proxy_pool(organization_id);
CREATE INDEX idx_proxy_pool_status ON proxy_pool(status);

CREATE TABLE browser_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255),
  user_agent TEXT,
  accept_language VARCHAR(100),
  timezone VARCHAR(50),
  platform VARCHAR(50),
  fingerprint JSONB, -- webgl, canvas, font data
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_browser_profiles_org_id ON browser_profiles(organization_id);

CREATE TABLE ban_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES whatsapp_clients(id) ON DELETE CASCADE,
  alert_type VARCHAR(50), -- rate_limit_warning, suspicious_activity, account_banned
  details JSONB,
  status VARCHAR(50) DEFAULT 'open', -- open, acknowledged, resolved
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ban_alerts_client_id ON ban_alerts(client_id);
CREATE INDEX idx_ban_alerts_status ON ban_alerts(status);

-- ================================================
-- AUDIT LOGS
-- ================================================

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  action VARCHAR(100),
  resource_type VARCHAR(50),
  resource_id VARCHAR(255),
  changes JSONB, -- what changed
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_org_id ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- ================================================
-- RATE LIMITING & THROTTLING
-- ================================================

CREATE TABLE rate_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES whatsapp_clients(id) ON DELETE CASCADE,
  bucket_name VARCHAR(50), -- per_minute, per_hour, per_day
  request_count INT DEFAULT 0,
  max_requests INT,
  window_start TIMESTAMP,
  window_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rate_limits_client_id ON rate_limits(client_id);
CREATE INDEX idx_rate_limits_window ON rate_limits(window_start, window_end);

-- ================================================
-- API KEYS & AUTHENTICATION
-- ================================================

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255),
  key_hash VARCHAR(255) NOT NULL,
  permissions JSONB DEFAULT '[]',
  last_used TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_api_keys_org_id ON api_keys(organization_id);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_active ON api_keys(is_active);

-- ================================================
-- TEAM & ROLES
-- ================================================

CREATE TABLE team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_clients JSONB DEFAULT '[]', -- array of client IDs
  assigned_contacts JSONB DEFAULT '[]', -- array of contact IDs
  permissions JSONB DEFAULT '[]',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_team_members_org_id ON team_members(organization_id);
CREATE INDEX idx_team_members_user_id ON team_members(user_id);

-- ================================================
-- FILE STORAGE
-- ================================================

CREATE TABLE file_uploads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES whatsapp_clients(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id),
  filename VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255),
  mime_type VARCHAR(100),
  file_size BIGINT,
  storage_path TEXT, -- S3 path or local path
  url TEXT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP
);

CREATE INDEX idx_file_uploads_client_id ON file_uploads(client_id);
CREATE INDEX idx_file_uploads_message_id ON file_uploads(message_id);

-- ================================================
-- COMPLIANCE & DATA PROTECTION
-- ================================================

CREATE TABLE data_retention_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_type VARCHAR(50), -- messages, contacts, logs
  retention_days INT,
  auto_delete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE gdpr_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id),
  request_type VARCHAR(50), -- delete, export, rectify
  status VARCHAR(50) DEFAULT 'pending', -- pending, processing, completed, rejected
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  details JSONB
);

CREATE INDEX idx_gdpr_requests_org_id ON gdpr_requests(organization_id);
CREATE INDEX idx_gdpr_requests_status ON gdpr_requests(status);

-- ================================================
-- VIEWS FOR COMMON QUERIES
-- ================================================

CREATE VIEW organization_stats AS
SELECT 
  o.id,
  o.name,
  COUNT(DISTINCT u.id) as total_users,
  COUNT(DISTINCT wc.id) as total_clients,
  COUNT(DISTINCT c.id) as total_contacts,
  COUNT(DISTINCT m.id) as total_messages
FROM organizations o
LEFT JOIN users u ON o.id = u.organization_id
LEFT JOIN whatsapp_clients wc ON o.id = wc.organization_id
LEFT JOIN contacts c ON o.id = c.organization_id
LEFT JOIN messages m ON wc.id = m.client_id
GROUP BY o.id, o.name;

CREATE VIEW client_stats AS
SELECT 
  wc.id,
  wc.client_id,
  COUNT(DISTINCT m.id) as total_messages,
  COUNT(DISTINCT CASE WHEN m.direction = 'inbound' THEN m.id END) as inbound_count,
  COUNT(DISTINCT CASE WHEN m.direction = 'outbound' THEN m.id END) as outbound_count,
  COUNT(DISTINCT CASE WHEN m.status = 'delivered' THEN m.id END) as delivered_count,
  COUNT(DISTINCT CASE WHEN m.status = 'read' THEN m.id END) as read_count
FROM whatsapp_clients wc
LEFT JOIN messages m ON wc.id = m.client_id
GROUP BY wc.id, wc.client_id;

-- ================================================
-- SECURITY: Create role for application
-- ================================================

-- Create app role with limited permissions (uncomment in production)
-- CREATE ROLE app_user WITH LOGIN PASSWORD 'secure_password';
-- GRANT CONNECT ON DATABASE whatsapp_service TO app_user;
-- GRANT USAGE ON SCHEMA public TO app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- ================================================
-- FUNCTIONS FOR COMMON OPERATIONS
-- ================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_whatsapp_clients_updated_at BEFORE UPDATE ON whatsapp_clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_automations_updated_at BEFORE UPDATE ON automations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================
-- COMMENTS FOR DOCUMENTATION
-- ================================================

COMMENT ON TABLE whatsapp_clients IS 'Stores WhatsApp client configurations per organization';
COMMENT ON TABLE messages IS 'Message history with delivery status and media support';
COMMENT ON TABLE webhooks IS 'Webhook configurations for real-time event notifications';
COMMENT ON TABLE proxy_pool IS 'IP proxy pool for anti-ban protection and rotation';
COMMENT ON TABLE browser_profiles IS 'Browser fingerprints for anti-detection';
COMMENT ON TABLE automations IS 'Automated message responses and workflows';

-- ================================================
-- CREATE INDEXES FOR PERFORMANCE
-- ================================================

-- Composite indexes for common queries
CREATE INDEX idx_messages_client_created ON messages(client_id, created_at DESC);
CREATE INDEX idx_messages_recipient_status ON messages(recipient, status);
CREATE INDEX idx_contacts_org_updated ON contacts(organization_id, updated_at DESC);
CREATE INDEX idx_campaigns_org_status ON campaigns(organization_id, status);

-- Partial indexes for frequently queried states
CREATE INDEX idx_clients_connected ON whatsapp_clients(organization_id) WHERE status = 'connected';
CREATE INDEX idx_messages_pending ON messages(client_id) WHERE status = 'pending';
CREATE INDEX idx_webhooks_active_org ON webhooks(organization_id) WHERE is_active = TRUE;
