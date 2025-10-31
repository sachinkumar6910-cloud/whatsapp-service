const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Logger class for centralized logging
class Logger {
  constructor() {
    this.logFile = path.join(logsDir, `whatsapp-service-${new Date().toISOString().split('T')[0]}.log`);
    this.metricsFile = path.join(logsDir, 'metrics.json');
    this.alerts = [];
    this.metrics = {
      uptime: Date.now(),
      totalClients: 0,
      connectedClients: 0,
      messagesSent: 0,
      messagesFailed: 0,
      qrCodesGenerated: 0,
      sessionRecoveries: 0,
      errors: 0,
      lastUpdated: Date.now()
    };
  }

  // Log levels
  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...data
    };

    // Console output with emojis
    const emoji = {
      'INFO': 'ℹ️',
      'WARN': '⚠️',
      'ERROR': '❌',
      'SUCCESS': '✅',
      'METRIC': '📊'
    }[level.toUpperCase()] || '📝';

    console.log(`${emoji} [${timestamp}] ${level.toUpperCase()}: ${message}`);

    // File logging
    try {
      const logLine = JSON.stringify(logEntry) + '\n';
      fs.appendFileSync(this.logFile, logLine);
    } catch (error) {
      console.error('❌ Failed to write to log file:', error);
    }

    // Track errors for alerting
    if (level.toUpperCase() === 'ERROR') {
      this.alerts.push({
        timestamp,
        message,
        data,
        resolved: false
      });
      this.metrics.errors++;
    }

    return logEntry;
  }

  info(message, data = {}) {
    return this.log('INFO', message, data);
  }

  warn(message, data = {}) {
    return this.log('WARN', message, data);
  }

  error(message, data = {}) {
    return this.log('ERROR', message, data);
  }

  success(message, data = {}) {
    return this.log('SUCCESS', message, data);
  }

  metric(message, data = {}) {
    this.log('METRIC', message, data);
  }

  // Update metrics
  updateMetrics(updates) {
    Object.assign(this.metrics, updates);
    this.metrics.lastUpdated = Date.now();

    // Save metrics to file
    try {
      fs.writeFileSync(this.metricsFile, JSON.stringify(this.metrics, null, 2));
    } catch (error) {
      this.error('Failed to save metrics', { error: error.message });
    }
  }

  // Get current metrics
  getMetrics() {
    return { ...this.metrics };
  }

  // Get alerts
  getAlerts(unresolvedOnly = true) {
    if (unresolvedOnly) {
      return this.alerts.filter(alert => !alert.resolved);
    }
    return [...this.alerts];
  }

  // Resolve alert
  resolveAlert(index) {
    if (this.alerts[index]) {
      this.alerts[index].resolved = true;
      this.alerts[index].resolvedAt = new Date().toISOString();
    }
  }

  // Clean old logs (keep last 30 days)
  cleanOldLogs() {
    try {
      const files = fs.readdirSync(logsDir);
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

      files.forEach(file => {
        if (file.endsWith('.log')) {
          const filePath = path.join(logsDir, file);
          const stats = fs.statSync(filePath);
          if (stats.mtime.getTime() < thirtyDaysAgo) {
            fs.unlinkSync(filePath);
            this.info('Cleaned old log file', { file });
          }
        }
      });
    } catch (error) {
      this.error('Failed to clean old logs', { error: error.message });
    }
  }
}

// Session recovery with exponential backoff
class SessionRecoveryManager {
  constructor(logger) {
    this.logger = logger;
    this.recoveryAttempts = new Map();
    this.maxRetries = 5;
    this.baseDelay = 1000; // 1 second
    this.maxDelay = 300000; // 5 minutes
  }

  // Calculate exponential backoff delay
  calculateDelay(attemptNumber) {
    const delay = Math.min(this.baseDelay * Math.pow(2, attemptNumber), this.maxDelay);
    // Add jitter to prevent thundering herd
    return delay + Math.random() * 1000;
  }

  // Schedule recovery attempt
  async scheduleRecovery(clientId, recoveryFunction) {
    const attempts = this.recoveryAttempts.get(clientId) || 0;

    if (attempts >= this.maxRetries) {
      this.logger.error('Max recovery attempts exceeded', { clientId, attempts });
      return false;
    }

    const delay = this.calculateDelay(attempts);
    this.recoveryAttempts.set(clientId, attempts + 1);

    this.logger.info('Scheduling session recovery', {
      clientId,
      attempt: attempts + 1,
      delay: Math.round(delay / 1000) + 's'
    });

    setTimeout(async () => {
      try {
        const success = await recoveryFunction();
        if (success) {
          this.logger.success('Session recovery successful', { clientId });
          this.recoveryAttempts.delete(clientId);
          this.logger.updateMetrics({ sessionRecoveries: this.logger.metrics.sessionRecoveries + 1 });
        } else {
          this.logger.warn('Session recovery failed, will retry', { clientId, attempt: attempts + 1 });
          // Schedule next attempt
          this.scheduleRecovery(clientId, recoveryFunction);
        }
      } catch (error) {
        this.logger.error('Session recovery error', { clientId, error: error.message });
        // Schedule next attempt
        this.scheduleRecovery(clientId, recoveryFunction);
      }
    }, delay);

    return true;
  }

  // Reset recovery attempts for successful connection
  resetAttempts(clientId) {
    if (this.recoveryAttempts.has(clientId)) {
      this.recoveryAttempts.delete(clientId);
      this.logger.info('Recovery attempts reset for successful connection', { clientId });
    }
  }
}

// Health check utilities
class HealthChecker {
  constructor(logger, clients, qrCodes) {
    this.logger = logger;
    this.clients = clients;
    this.qrCodes = qrCodes;
    this.lastHealthCheck = Date.now();
  }

  // Perform comprehensive health check
  async performHealthCheck() {
    const startTime = Date.now();
    const health = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      uptime: Date.now() - this.logger.metrics.uptime,
      clients: {
        total: this.clients.size,
        connected: 0,
        waitingForQr: 0,
        disconnected: 0,
        error: 0
      },
      qrCodes: this.qrCodes.size,
      alerts: this.logger.getAlerts().length,
      responseTime: 0
    };

    // Check each client status
    for (const [clientId, clientData] of this.clients.entries()) {
      try {
        const status = clientData.status;
        health.clients[status === 'connected' ? 'connected' : status === 'waiting_for_qr' ? 'waitingForQr' : status === 'disconnected' ? 'disconnected' : 'error']++;
      } catch (error) {
        health.clients.error++;
        this.logger.error('Health check error for client', { clientId, error: error.message });
      }
    }

    health.responseTime = Date.now() - startTime;
    this.lastHealthCheck = Date.now();

    // Update overall status
    if (health.clients.error > 0 || health.alerts > 0) {
      health.status = health.clients.error > health.clients.total * 0.5 ? 'critical' : 'warning';
    }

    this.logger.metric('Health check completed', health);
    return health;
  }

  // Get tenant-specific health
  getTenantHealth(clientId) {
    if (!this.clients.has(clientId)) {
      return { status: 'not_found', clientId };
    }

    const clientData = this.clients.get(clientId);
    const health = {
      clientId,
      status: clientData.status,
      connected: clientData.status === 'connected',
      hasQr: this.qrCodes.has(clientId),
      lastConnected: clientData.connectedAt,
      error: clientData.error,
      uptime: clientData.connectedAt ? Date.now() - clientData.connectedAt : 0
    };

    return health;
  }
}

// Anti-ban and rate limiting protection
class AntiBanManager {
  constructor(logger) {
    this.logger = logger;
    this.messageQueue = new Map(); // clientId -> queue of messages
    this.rateLimits = new Map(); // clientId -> rate limit info
    this.maxMessagesPerMinute = 30; // Conservative limit
    this.maxMessagesPerHour = 500;
    this.burstLimit = 5; // Messages per burst
    this.burstWindow = 10000; // 10 seconds
    this.suspiciousPatterns = [
      /spam|fake|scam|viagra|casino|lottery/i,
      /http:\/\/[^\s]+/g, // HTTP links (prefer HTTPS)
      /(.)\1{10,}/, // Repeated characters
      /ALL CAPS MESSAGE/,
      /📱|📞|💰|🎰|💊/ // Emojis associated with spam
    ];
  }

  // Check if message should be blocked
  shouldBlockMessage(clientId, message) {
    // Check for suspicious content
    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(message)) {
        this.logger.warn('Message blocked - suspicious content', { clientId, pattern: pattern.toString() });
        return { blocked: true, reason: 'suspicious_content' };
      }
    }

    // Check rate limits
    const now = Date.now();
    const rateLimit = this.rateLimits.get(clientId) || {
      minuteCount: 0,
      hourCount: 0,
      burstCount: 0,
      minuteStart: now,
      hourStart: now,
      burstStart: now
    };

    // Reset counters if time windows have passed
    if (now - rateLimit.minuteStart > 60000) {
      rateLimit.minuteCount = 0;
      rateLimit.minuteStart = now;
    }
    if (now - rateLimit.hourStart > 3600000) {
      rateLimit.hourCount = 0;
      rateLimit.hourStart = now;
    }
    if (now - rateLimit.burstStart > this.burstWindow) {
      rateLimit.burstCount = 0;
      rateLimit.burstStart = now;
    }

    // Check limits
    if (rateLimit.minuteCount >= this.maxMessagesPerMinute) {
      return { blocked: true, reason: 'rate_limit_minute' };
    }
    if (rateLimit.hourCount >= this.maxMessagesPerHour) {
      return { blocked: true, reason: 'rate_limit_hour' };
    }
    if (rateLimit.burstCount >= this.burstLimit) {
      return { blocked: true, reason: 'rate_limit_burst' };
    }

    return { blocked: false };
  }

  // Record message for rate limiting
  recordMessage(clientId) {
    const now = Date.now();
    const rateLimit = this.rateLimits.get(clientId) || {
      minuteCount: 0,
      hourCount: 0,
      burstCount: 0,
      minuteStart: now,
      hourStart: now,
      burstStart: now
    };

    rateLimit.minuteCount++;
    rateLimit.hourCount++;
    rateLimit.burstCount++;

    this.rateLimits.set(clientId, rateLimit);
  }

  // Queue message for delayed sending (anti-ban measure)
  async queueMessage(clientId, to, message, sendFunction) {
    const check = this.shouldBlockMessage(clientId, message);
    if (check.blocked) {
      throw new Error(`Message blocked: ${check.reason}`);
    }

    // Add random delay to appear more human-like (1-5 seconds)
    const delay = 1000 + Math.random() * 4000;

    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          this.recordMessage(clientId);
          const result = await sendFunction(to, message);
          this.logger.metric('Message sent successfully', { clientId, to });
          resolve(result);
        } catch (error) {
          this.logger.error('Message send failed', { clientId, to, error: error.message });
          reject(error);
        }
      }, delay);
    });
  }

  // Get rate limit status for client
  getRateLimitStatus(clientId) {
    const rateLimit = this.rateLimits.get(clientId);
    if (!rateLimit) {
      return { minuteCount: 0, hourCount: 0, burstCount: 0 };
    }

    const now = Date.now();
    return {
      minuteCount: rateLimit.minuteCount,
      hourCount: rateLimit.hourCount,
      burstCount: rateLimit.burstCount,
      minuteRemaining: Math.max(0, 60 - Math.floor((now - rateLimit.minuteStart) / 1000)),
      hourRemaining: Math.max(0, 3600 - Math.floor((now - rateLimit.hourStart) / 1000)),
      burstRemaining: Math.max(0, this.burstWindow - (now - rateLimit.burstStart))
    };
  }
}

module.exports = {
  Logger,
  SessionRecoveryManager,
  HealthChecker,
  AntiBanManager
};