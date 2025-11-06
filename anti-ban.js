// ================================================
// ADVANCED ANTI-BAN SYSTEM
// ================================================

const logger = require('./logger');
const db = require('./db');
const crypto = require('crypto');
const UserAgent = require('user-agents');

class AdvancedAntiBanManager {
  constructor() {
    this.messageQueues = new Map(); // Per-client queue
    this.rateLimits = new Map(); // Per-client rate limits
    this.activityPatterns = new Map(); // Simulate human behavior
    this.browserProfiles = new Map(); // Browser fingerprints
    this.proxyRotation = new Map(); // Proxy rotation state
  }

  // ================================================
  // 1. PROXY ROTATION & IP MANAGEMENT
  // ================================================

  /**
   * Get available proxy from pool
   */
  async getAvailableProxy(organizationId) {
    try {
      const result = await db.query(
        `SELECT * FROM proxy_pool 
         WHERE organization_id = $1 AND status = 'active'
         ORDER BY last_used ASC, failure_count ASC
         LIMIT 1`,
        [organizationId]
      );

      if (result.rows.length === 0) {
        logger.warn('No available proxies', { organizationId });
        return null;
      }

      const proxy = result.rows[0];
      
      // Update last used timestamp
      await db.query(
        `UPDATE proxy_pool SET last_used = NOW() WHERE id = $1`,
        [proxy.id]
      );

      // Decrypt password if exists
      if (proxy.password_encrypted) {
        proxy.password = db.decryptSensitive(proxy.password_encrypted);
      }

      return proxy;
    } catch (error) {
      logger.error('Error getting proxy', { organizationId, error: error.message });
      return null;
    }
  }

  /**
   * Add proxy to fail counter
   */
  async recordProxyFailure(proxyId) {
    await db.query(
      `UPDATE proxy_pool 
       SET failure_count = failure_count + 1,
           status = CASE WHEN failure_count >= 5 THEN 'blocked' ELSE status END
       WHERE id = $1`,
      [proxyId]
    );
  }

  /**
   * Rotate to next proxy
   */
  async rotateProxy(clientId, organizationId) {
    const currentProxy = await this.getAvailableProxy(organizationId);
    
    if (!currentProxy) {
      logger.warn('No proxy available for rotation', { clientId });
      return null;
    }

    this.proxyRotation.set(clientId, {
      proxyId: currentProxy.id,
      rotatedAt: Date.now(),
      ipAddress: currentProxy.ip_address
    });

    logger.info('Proxy rotated', { clientId, ip: currentProxy.ip_address });
    return currentProxy;
  }

  // ================================================
  // 2. BROWSER FINGERPRINTING & SPOOFING
  // ================================================

  /**
   * Generate randomized browser profile
   */
  async generateBrowserProfile(organizationId) {
    const userAgent = new UserAgent();
    
    const profile = {
      userAgent: userAgent.toString(),
      acceptLanguage: this._randomAcceptLanguage(),
      timezone: this._randomTimezone(),
      platform: userAgent.platform,
      webgl: this._generateWebGLData(),
      canvas: this._generateCanvasFingerprint(),
      fonts: this._generateFontList(),
      plugins: this._generatePluginList(),
      screenResolution: this._randomScreenResolution(),
      colorDepth: [16, 24, 32][Math.floor(Math.random() * 3)],
      deviceMemory: [4, 8, 16, 32][Math.floor(Math.random() * 4)]
    };

    // Save to database
    await db.query(
      `INSERT INTO browser_profiles (organization_id, fingerprint) 
       VALUES ($1, $2)`,
      [organizationId, JSON.stringify(profile)]
    );

    return profile;
  }

  /**
   * Get browser profile for client
   */
  async getBrowserProfile(clientId, organizationId) {
    let profile = this.browserProfiles.get(clientId);
    
    if (!profile) {
      profile = await this.generateBrowserProfile(organizationId);
      this.browserProfiles.set(clientId, profile);
    }
    
    return profile;
  }

  /**
   * Apply browser fingerprinting to Puppeteer
   */
  async applyBrowserFingerprinting(page, profile) {
    try {
      await page.evaluateOnNewDocument((fingerprint) => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined
        });

        Object.defineProperty(navigator, 'plugins', {
          get: () => fingerprint.plugins
        });

        Object.defineProperty(navigator, 'languages', {
          get: () => fingerprint.languages || ['en-US']
        });

        // Randomize canvas
        const canvas = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function() {
          if (this.width === 280 && this.height === 60) {
            const ctx = this.getContext('2d');
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < imageData.data.length; i += 4) {
              imageData.data[i] += Math.floor(Math.random() * 10);
            }
            ctx.putImageData(imageData, 0, 0);
          }
          return canvas.call(this);
        };

        // Randomize WebGL
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37445) {
            return 'Intel Inc.';
          }
          if (parameter === 37446) {
            return 'Intel Iris OpenGL Engine';
          }
          return getParameter.call(this, parameter);
        };
      }, profile);

      logger.info('Browser fingerprinting applied');
    } catch (error) {
      logger.error('Error applying fingerprinting', { error: error.message });
    }
  }

  // ================================================
  // 3. BEHAVIORAL SIMULATION
  // ================================================

  /**
   * Add human-like delays and patterns
   */
  async simulateHumanBehavior(clientId, action) {
    // Typing delay simulation: 60-100ms per character
    if (action === 'type') {
      const delay = this._randomDelay(60, 100);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Mouse movement simulation
    if (action === 'mouse') {
      const delay = this._randomDelay(100, 300);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Scroll behavior
    if (action === 'scroll') {
      const delay = this._randomDelay(200, 500);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Between messages: 2-5 seconds with occasional longer pauses
    if (action === 'message') {
      const delay = Math.random() < 0.1 
        ? this._randomDelay(5000, 15000) // 10% chance of longer pause
        : this._randomDelay(2000, 5000);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    return true;
  }

  // ================================================
  // 4. ADAPTIVE RATE LIMITING
  // ================================================

  /**
   * Initialize rate limiter for client
   */
  async initializeRateLimiter(clientId, organizationId) {
    const limiter = {
      clientId,
      limits: {
        perMinute: { max: 20, current: 0, window: Date.now() },
        perHour: { max: 100, current: 0, window: Date.now() },
        perDay: { max: 1000, current: 0, window: Date.now() }
      },
      suspiciousActivityCount: 0,
      adaptiveThreshold: 0.8 // 80% of limit triggers warning
    };

    this.rateLimits.set(clientId, limiter);
    return limiter;
  }

  /**
   * Check if message can be sent
   */
  async canSendMessage(clientId) {
    const limiter = this.rateLimits.get(clientId);
    
    if (!limiter) {
      return { allowed: true, reason: 'No limiter' };
    }

    const now = Date.now();

    // Check per-minute limit
    if (now - limiter.limits.perMinute.window > 60000) {
      limiter.limits.perMinute.current = 0;
      limiter.limits.perMinute.window = now;
    }

    // Check per-hour limit
    if (now - limiter.limits.perHour.window > 3600000) {
      limiter.limits.perHour.current = 0;
      limiter.limits.perHour.window = now;
    }

    // Check per-day limit
    if (now - limiter.limits.perDay.window > 86400000) {
      limiter.limits.perDay.current = 0;
      limiter.limits.perDay.window = now;
    }

    // Adaptive threshold check
    const minuteThreshold = limiter.limits.perMinute.max * limiter.adaptiveThreshold;
    const hourThreshold = limiter.limits.perHour.max * limiter.adaptiveThreshold;
    const dayThreshold = limiter.limits.perDay.max * limiter.adaptiveThreshold;

    if (limiter.limits.perMinute.current >= limiter.limits.perMinute.max) {
      return { allowed: false, reason: 'Per-minute limit exceeded', retryAfter: 60 };
    }

    if (limiter.limits.perHour.current >= limiter.limits.perHour.max) {
      return { allowed: false, reason: 'Per-hour limit exceeded', retryAfter: 3600 };
    }

    if (limiter.limits.perDay.current >= limiter.limits.perDay.max) {
      return { allowed: false, reason: 'Per-day limit exceeded', retryAfter: 86400 };
    }

    // Warning signals
    const warnings = [];
    if (limiter.limits.perMinute.current >= minuteThreshold) {
      warnings.push('Approaching per-minute limit');
    }
    if (limiter.limits.perHour.current >= hourThreshold) {
      warnings.push('Approaching per-hour limit');
    }
    if (limiter.limits.perDay.current >= dayThreshold) {
      warnings.push('Approaching per-day limit');
    }

    return { allowed: true, warnings };
  }

  /**
   * Record message send for rate limiting
   */
  recordMessageSend(clientId) {
    const limiter = this.rateLimits.get(clientId);
    if (limiter) {
      limiter.limits.perMinute.current++;
      limiter.limits.perHour.current++;
      limiter.limits.perDay.current++;
    }
  }

  // ================================================
  // 5. SESSION MANAGEMENT
  // ================================================

  /**
   * Create secure session
   */
  async createSession(clientId, organizationId, metadata = {}) {
    const sessionHash = crypto.randomBytes(32).toString('hex');
    const sessionData = {
      sessionHash,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      metadata,
      deviceFingerprint: crypto.createHash('sha256')
        .update(JSON.stringify(metadata))
        .digest('hex')
    };

    await db.query(
      `INSERT INTO sessions (client_id, session_hash, device_fingerprint, is_active) 
       VALUES ($1, $2, $3, true)`,
      [clientId, sessionHash, sessionData.deviceFingerprint]
    );

    return sessionData;
  }

  /**
   * Rotate session
   */
  async rotateSession(clientId) {
    // Invalidate old session
    await db.query(
      `UPDATE sessions SET is_active = false WHERE client_id = $1`,
      [clientId]
    );

    // Create new session
    return await this.createSession(clientId, null, {
      rotatedFrom: Date.now()
    });
  }

  // ================================================
  // 6. SUSPICIOUS ACTIVITY DETECTION
  // ================================================

  /**
   * Detect suspicious activity
   */
  async detectSuspiciousActivity(clientId, activity) {
    const limiter = this.rateLimits.get(clientId);
    
    if (!limiter) return false;

    const suspiciousPatterns = [
      activity.messagesSentInSequence > 10, // Too many messages too fast
      activity.failureRate > 0.3, // High failure rate
      activity.ipChangesInHour > 3, // Too many IP changes
      activity.geoLocationJump > 1000, // Geographic jump
      activity.unusualMessageContent // Spam keywords
    ];

    const isSuspicious = suspiciousPatterns.some(p => p);

    if (isSuspicious) {
      limiter.suspiciousActivityCount++;
      
      // Record ban alert
      await db.query(
        `INSERT INTO ban_alerts (client_id, alert_type, details, status) 
         VALUES ($1, $2, $3, 'open')`,
        [clientId, 'suspicious_activity', JSON.stringify(activity)]
      );

      logger.warn('Suspicious activity detected', { clientId, activity });

      // If multiple alerts, trigger protective measures
      if (limiter.suspiciousActivityCount > 3) {
        await this.triggerProtectiveMeasures(clientId);
      }
    }

    return isSuspicious;
  }

  /**
   * Trigger protective measures
   */
  async triggerProtectiveMeasures(clientId) {
    logger.warn('Triggering protective measures', { clientId });
    
    // Increase message delays
    const limiter = this.rateLimits.get(clientId);
    if (limiter) {
      limiter.limits.perMinute.max = Math.max(5, limiter.limits.perMinute.max / 2);
    }

    // Record alert
    await db.query(
      `INSERT INTO ban_alerts (client_id, alert_type, status) 
       VALUES ($1, 'protective_measures_activated', 'open')`,
      [clientId]
    );
  }

  // ================================================
  // HELPER METHODS
  // ================================================

  _randomDelay(min, max) {
    return Math.random() * (max - min) + min;
  }

  _randomAcceptLanguage() {
    const languages = [
      'en-US,en;q=0.9',
      'en-GB,en;q=0.8',
      'en-US,en;q=0.9,fr;q=0.8',
      'en-US,en;q=0.9,es;q=0.8'
    ];
    return languages[Math.floor(Math.random() * languages.length)];
  }

  _randomTimezone() {
    const timezones = [
      'America/New_York',
      'America/Chicago',
      'America/Los_Angeles',
      'Europe/London',
      'Europe/Paris',
      'Asia/Tokyo'
    ];
    return timezones[Math.floor(Math.random() * timezones.length)];
  }

  _randomScreenResolution() {
    const resolutions = [
      '1920x1080',
      '1366x768',
      '1440x900',
      '1536x864'
    ];
    return resolutions[Math.floor(Math.random() * resolutions.length)];
  }

  _generateWebGLData() {
    return {
      vendor: 'Intel Inc.',
      renderer: 'Intel Iris OpenGL Engine'
    };
  }

  _generateCanvasFingerprint() {
    return crypto.randomBytes(16).toString('hex');
  }

  _generateFontList() {
    return [
      'Arial', 'Helvetica', 'Times New Roman',
      'Courier New', 'Georgia', 'Palatino',
      'Garamond', 'Bookman', 'Comic Sans MS'
    ];
  }

  _generatePluginList() {
    return [
      { name: 'Chrome PDF Plugin', version: '1.0' },
      { name: 'Chrome PDF Viewer', version: '1.0' },
      { name: 'Native Client Executable', version: '1.0' }
    ];
  }
}

module.exports = AdvancedAntiBanManager;
