const fs = require('fs');
const path = require('path');

class AuditLogger {
  constructor(logger) {
    this.logger = logger;
    this.auditLogFile = path.join(__dirname, 'logs', 'audit.log');
    this.messageHistoryFile = path.join(__dirname, 'logs', 'message-history.json');
    this.auditLogs = [];
    this.messageHistory = new Map(); // clientId -> messages array
    this.maxMessagesPerClient = 1000; // Limit to prevent memory issues
    this.maxAuditEntries = 10000; // Limit audit log size

    // Ensure logs directory exists
    const logsDir = path.dirname(this.auditLogFile);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Load existing message history
    this.loadMessageHistory();
  }

  // Log audit event
  logAuditEvent(eventType, clientId, details, userId = null) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      eventType,
      clientId,
      userId,
      details,
      ip: details.ip || 'unknown',
      userAgent: details.userAgent || 'unknown'
    };

    this.auditLogs.push(auditEntry);

    // Keep only recent entries
    if (this.auditLogs.length > this.maxAuditEntries) {
      this.auditLogs = this.auditLogs.slice(-this.maxAuditEntries);
    }

    // Write to file
    try {
      const logLine = JSON.stringify(auditEntry) + '\n';
      fs.appendFileSync(this.auditLogFile, logLine);
    } catch (error) {
      this.logger.error('Failed to write audit log', { error: error.message });
    }

    this.logger.info('Audit event logged', { eventType, clientId });
  }

  // Log message event
  logMessage(clientId, direction, to, from, message, status = 'sent', metadata = {}) {
    const messageEntry = {
      id: this.generateMessageId(),
      timestamp: new Date().toISOString(),
      clientId,
      direction, // 'outbound' or 'inbound'
      to,
      from,
      message: message.substring(0, 1000), // Limit message length
      status,
      metadata,
      messageLength: message.length
    };

    // Add to in-memory history
    if (!this.messageHistory.has(clientId)) {
      this.messageHistory.set(clientId, []);
    }

    const clientMessages = this.messageHistory.get(clientId);
    clientMessages.push(messageEntry);

    // Keep only recent messages
    if (clientMessages.length > this.maxMessagesPerClient) {
      clientMessages.splice(0, clientMessages.length - this.maxMessagesPerClient);
    }

    // Save to file periodically (every 100 messages or so)
    if (clientMessages.length % 50 === 0) {
      this.saveMessageHistory();
    }

    // Audit log for message
    this.logAuditEvent('message_sent', clientId, {
      direction,
      to,
      messageLength: message.length,
      status
    });

    return messageEntry.id;
  }

  // Log authentication event
  logAuthEvent(clientId, event, success, details = {}) {
    this.logAuditEvent('authentication', clientId, {
      event,
      success,
      ...details
    });
  }

  // Log API access
  logApiAccess(clientId, endpoint, method, statusCode, responseTime, details = {}) {
    this.logAuditEvent('api_access', clientId, {
      endpoint,
      method,
      statusCode,
      responseTime,
      ...details
    });
  }

  // Log automation event
  logAutomationEvent(clientId, automationId, event, details = {}) {
    this.logAuditEvent('automation', clientId, {
      automationId,
      event,
      ...details
    });
  }

  // Log setup wizard event
  logSetupEvent(clientId, step, action, details = {}) {
    this.logAuditEvent('setup_wizard', clientId, {
      step,
      action,
      ...details
    });
  }

  // Get audit logs for client
  getAuditLogs(clientId, limit = 100, eventType = null) {
    let logs = this.auditLogs.filter(log => log.clientId === clientId);

    if (eventType) {
      logs = logs.filter(log => log.eventType === eventType);
    }

    return logs.slice(-limit);
  }

  // Get message history for client
  getMessageHistory(clientId, limit = 100, direction = null, dateFrom = null, dateTo = null) {
    const clientMessages = this.messageHistory.get(clientId) || [];

    let filtered = [...clientMessages];

    if (direction) {
      filtered = filtered.filter(msg => msg.direction === direction);
    }

    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      filtered = filtered.filter(msg => new Date(msg.timestamp) >= fromDate);
    }

    if (dateTo) {
      const toDate = new Date(dateTo);
      filtered = filtered.filter(msg => new Date(msg.timestamp) <= toDate);
    }

    return filtered.slice(-limit);
  }

  // Get message statistics
  getMessageStats(clientId, dateFrom = null, dateTo = null) {
    const messages = this.getMessageHistory(clientId, 10000, null, dateFrom, dateTo);

    const stats = {
      total: messages.length,
      outbound: messages.filter(m => m.direction === 'outbound').length,
      inbound: messages.filter(m => m.direction === 'inbound').length,
      failed: messages.filter(m => m.status === 'failed').length,
      avgMessageLength: 0,
      topContacts: {},
      hourlyDistribution: new Array(24).fill(0),
      dailyDistribution: {}
    };

    if (messages.length > 0) {
      stats.avgMessageLength = Math.round(
        messages.reduce((sum, m) => sum + m.messageLength, 0) / messages.length
      );

      // Top contacts
      const contactCount = {};
      messages.forEach(msg => {
        const contact = msg.direction === 'outbound' ? msg.to : msg.from;
        contactCount[contact] = (contactCount[contact] || 0) + 1;
      });

      stats.topContacts = Object.entries(contactCount)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

      // Hourly distribution
      messages.forEach(msg => {
        const hour = new Date(msg.timestamp).getHours();
        stats.hourlyDistribution[hour]++;
      });

      // Daily distribution
      messages.forEach(msg => {
        const date = msg.timestamp.split('T')[0];
        stats.dailyDistribution[date] = (stats.dailyDistribution[date] || 0) + 1;
      });
    }

    return stats;
  }

  // Export message history
  exportMessageHistory(clientId, format = 'json', dateFrom = null, dateTo = null) {
    const messages = this.getMessageHistory(clientId, 10000, null, dateFrom, dateTo);

    if (format === 'csv') {
      const csvHeader = 'Timestamp,Direction,To,From,Message,Status,MessageLength\n';
      const csvRows = messages.map(msg =>
        `"${msg.timestamp}","${msg.direction}","${msg.to}","${msg.from}","${msg.message.replace(/"/g, '""')}","${msg.status}",${msg.messageLength}`
      ).join('\n');

      return csvHeader + csvRows;
    }

    return JSON.stringify(messages, null, 2);
  }

  // Generate unique message ID
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Load message history from file
  loadMessageHistory() {
    try {
      if (fs.existsSync(this.messageHistoryFile)) {
        const data = JSON.parse(fs.readFileSync(this.messageHistoryFile, 'utf8'));
        // Convert back to Map
        for (const [clientId, messages] of Object.entries(data)) {
          this.messageHistory.set(clientId, messages);
        }
        this.logger.info('Loaded message history from file', { clients: Object.keys(data).length });
      }
    } catch (error) {
      this.logger.error('Failed to load message history', { error: error.message });
    }
  }

  // Save message history to file
  saveMessageHistory() {
    try {
      const data = Object.fromEntries(this.messageHistory);
      fs.writeFileSync(this.messageHistoryFile, JSON.stringify(data, null, 2));
      this.logger.info('Saved message history to file');
    } catch (error) {
      this.logger.error('Failed to save message history', { error: error.message });
    }
  }

  // Clean old message history (keep last 30 days)
  cleanOldHistory() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    for (const [clientId, messages] of this.messageHistory.entries()) {
      const filtered = messages.filter(msg =>
        new Date(msg.timestamp).getTime() > thirtyDaysAgo
      );

      if (filtered.length !== messages.length) {
        this.messageHistory.set(clientId, filtered);
        this.logger.info('Cleaned old message history', {
          clientId,
          removed: messages.length - filtered.length
        });
      }
    }

    this.saveMessageHistory();
  }

  // Get audit statistics
  getAuditStats(clientId = null, dateFrom = null, dateTo = null) {
    let logs = [...this.auditLogs];

    if (clientId) {
      logs = logs.filter(log => log.clientId === clientId);
    }

    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      logs = logs.filter(log => new Date(log.timestamp) >= fromDate);
    }

    if (dateTo) {
      const toDate = new Date(dateTo);
      logs = logs.filter(log => new Date(log.timestamp) <= toDate);
    }

    const stats = {
      total: logs.length,
      byEventType: {},
      byStatus: { success: 0, failure: 0 },
      recentActivity: logs.slice(-10)
    };

    logs.forEach(log => {
      stats.byEventType[log.eventType] = (stats.byEventType[log.eventType] || 0) + 1;

      // Determine success/failure based on event details
      if (log.details && log.details.success !== undefined) {
        stats.byStatus[log.details.success ? 'success' : 'failure']++;
      }
    });

    return stats;
  }
}

module.exports = { AuditLogger };