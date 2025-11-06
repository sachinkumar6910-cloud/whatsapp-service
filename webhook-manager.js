// ================================================
// WEBHOOK SYSTEM
// ================================================

const crypto = require('crypto');
const axios = require('axios');
const logger = require('./logger');
const db = require('./db');

class WebhookManager {
  constructor(maxRetries = 3, timeoutMs = 30000) {
    this.maxRetries = maxRetries;
    this.timeoutMs = timeoutMs;
    this.eventQueue = []; // Queue for webhook events
  }

  // ================================================
  // WEBHOOK MANAGEMENT
  // ================================================

  /**
   * Register webhook
   */
  async registerWebhook(organizationId, userId, url, events, customHeaders = {}) {
    try {
      // Validate webhook URL
      this._validateWebhookUrl(url);

      // Validate events
      const validEvents = [
        'message_sent',
        'message_received',
        'message_failed',
        'message_delivered',
        'message_read',
        'client_connected',
        'client_disconnected',
        'campaign_started',
        'campaign_completed',
        'automation_triggered',
        'contact_added',
        'contact_updated',
        'contact_removed'
      ];

      const invalidEvents = events.filter(e => !validEvents.includes(e));
      if (invalidEvents.length > 0) {
        throw new Error(`Invalid events: ${invalidEvents.join(', ')}`);
      }

      // Generate secret key for HMAC
      const secretKey = crypto.randomBytes(32).toString('hex');

      const result = await db.query(
        `INSERT INTO webhooks (organization_id, url, events, secret_key) 
         VALUES ($1, $2, $3, $4)
         RETURNING id, url, events, created_at`,
        [organizationId, url, JSON.stringify(events), secretKey]
      );

      logger.info('Webhook registered', { 
        organizationId, 
        webhookId: result.rows[0].id,
        events 
      });

      return {
        id: result.rows[0].id,
        url: result.rows[0].url,
        events: result.rows[0].events,
        secretKey, // Only return once
        createdAt: result.rows[0].created_at
      };
    } catch (error) {
      logger.error('Error registering webhook', { organizationId, error: error.message });
      throw error;
    }
  }

  /**
   * Update webhook
   */
  async updateWebhook(webhookId, updates) {
    try {
      if (updates.events) {
        updates.events = JSON.stringify(updates.events);
      }

      await db.query(
        `UPDATE webhooks SET 
         url = COALESCE($1, url),
         events = COALESCE($2, events),
         headers = COALESCE($3, headers),
         is_active = COALESCE($4, is_active)
         WHERE id = $5`,
        [updates.url, updates.events, updates.headers, updates.isActive, webhookId]
      );

      logger.info('Webhook updated', { webhookId });
    } catch (error) {
      logger.error('Error updating webhook', { webhookId, error: error.message });
      throw error;
    }
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(webhookId) {
    try {
      await db.query(
        `DELETE FROM webhooks WHERE id = $1`,
        [webhookId]
      );

      logger.info('Webhook deleted', { webhookId });
    } catch (error) {
      logger.error('Error deleting webhook', { webhookId, error: error.message });
      throw error;
    }
  }

  /**
   * Get webhooks for organization
   */
  async getWebhooks(organizationId) {
    try {
      const result = await db.query(
        `SELECT id, url, events, is_active, retry_count, created_at FROM webhooks 
         WHERE organization_id = $1 AND is_active = true`,
        [organizationId]
      );

      return result.rows.map(row => ({
        ...row,
        events: typeof row.events === 'string' ? JSON.parse(row.events) : row.events
      }));
    } catch (error) {
      logger.error('Error getting webhooks', { organizationId, error: error.message });
      throw error;
    }
  }

  // ================================================
  // WEBHOOK EVENT TRIGGERING
  // ================================================

  /**
   * Trigger webhook event
   */
  async triggerEvent(organizationId, eventType, payload) {
    try {
      const webhooks = await this.getWebhooks(organizationId);
      
      // Filter webhooks that listen to this event
      const activeWebhooks = webhooks.filter(w => 
        w.events.includes(eventType)
      );

      if (activeWebhooks.length === 0) {
        return; // No webhooks listening to this event
      }

      // Send to all webhooks asynchronously
      for (const webhook of activeWebhooks) {
        this._queueWebhookDelivery(webhook, eventType, payload);
      }
    } catch (error) {
      logger.error('Error triggering webhook event', { organizationId, error: error.message });
    }
  }

  /**
   * Queue webhook delivery
   */
  async _queueWebhookDelivery(webhook, eventType, payload) {
    const delivery = {
      webhookId: webhook.id,
      url: webhook.url,
      eventType,
      payload,
      secretKey: webhook.secret_key,
      retries: 0,
      maxRetries: this.maxRetries
    };

    this.eventQueue.push(delivery);
    
    // Process queue
    this._processQueue();
  }

  /**
   * Process webhook delivery queue
   */
  async _processQueue() {
    if (this.eventQueue.length === 0) return;

    const delivery = this.eventQueue.shift();

    try {
      await this._deliverWebhook(delivery);
    } catch (error) {
      // Retry logic
      if (delivery.retries < delivery.maxRetries) {
        delivery.retries++;
        
        // Exponential backoff: 2^n seconds
        const delay = Math.pow(2, delivery.retries) * 1000;
        setTimeout(() => {
          this.eventQueue.push(delivery);
          this._processQueue();
        }, delay);

        logger.warn('Webhook retry scheduled', {
          webhookId: delivery.webhookId,
          retry: delivery.retries,
          delay
        });
      } else {
        logger.error('Webhook delivery failed after retries', {
          webhookId: delivery.webhookId,
          eventType: delivery.eventType
        });

        // Record failed delivery
        await this._logWebhookDelivery(
          delivery.webhookId,
          delivery.eventType,
          delivery.payload,
          500,
          error.message,
          delivery.retries
        );
      }
    }

    // Continue processing queue
    if (this.eventQueue.length > 0) {
      setImmediate(() => this._processQueue());
    }
  }

  /**
   * Deliver webhook to endpoint
   */
  async _deliverWebhook(delivery) {
    const startTime = Date.now();

    try {
      // Generate HMAC signature
      const signature = this._generateSignature(
        delivery.payload,
        delivery.secretKey
      );

      // Prepare headers
      const headers = {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': delivery.eventType,
        'X-Webhook-Timestamp': Date.now().toString()
      };

      // Send webhook
      const response = await axios.post(delivery.url, delivery.payload, {
        headers,
        timeout: this.timeoutMs,
        validateStatus: () => true // Don't throw on any status code
      });

      const responseTime = Date.now() - startTime;

      // Log delivery
      await this._logWebhookDelivery(
        delivery.webhookId,
        delivery.eventType,
        delivery.payload,
        response.status,
        response.statusText,
        delivery.retries
      );

      if (response.status !== 200 && response.status !== 204) {
        throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
      }

      logger.info('Webhook delivered successfully', {
        webhookId: delivery.webhookId,
        eventType: delivery.eventType,
        responseTime
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Generate HMAC signature for webhook
   */
  _generateSignature(payload, secretKey) {
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload, signature, secretKey) {
    const expectedSignature = this._generateSignature(payload, secretKey);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  // ================================================
  // WEBHOOK LOGGING
  // ================================================

  /**
   * Log webhook delivery
   */
  async _logWebhookDelivery(webhookId, eventType, payload, statusCode, response, retryCount) {
    try {
      await db.query(
        `INSERT INTO webhook_logs (webhook_id, event_type, payload, status_code, response_time_ms, error_message, retry_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [webhookId, eventType, JSON.stringify(payload), statusCode, 0, response || null, retryCount]
      );
    } catch (error) {
      logger.error('Error logging webhook', { error: error.message });
    }
  }

  /**
   * Get webhook logs
   */
  async getWebhookLogs(webhookId, limit = 100) {
    try {
      const result = await db.query(
        `SELECT * FROM webhook_logs WHERE webhook_id = $1 
         ORDER BY created_at DESC LIMIT $2`,
        [webhookId, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting webhook logs', { error: error.message });
      throw error;
    }
  }

  // ================================================
  // WEBHOOK TESTING
  // ================================================

  /**
   * Test webhook
   */
  async testWebhook(webhookId) {
    try {
      const result = await db.query(
        `SELECT url, secret_key FROM webhooks WHERE id = $1`,
        [webhookId]
      );

      if (result.rows.length === 0) {
        throw new Error('Webhook not found');
      }

      const webhook = result.rows[0];
      const testPayload = {
        event: 'test',
        timestamp: Date.now(),
        message: 'This is a test webhook delivery'
      };

      await axios.post(webhook.url, testPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': this._generateSignature(testPayload, webhook.secret_key),
          'X-Webhook-Event': 'test'
        },
        timeout: this.timeoutMs
      });

      logger.info('Webhook test successful', { webhookId });
      return { success: true };
    } catch (error) {
      logger.error('Webhook test failed', { webhookId, error: error.message });
      throw error;
    }
  }

  // ================================================
  // VALIDATION
  // ================================================

  /**
   * Validate webhook URL
   */
  _validateWebhookUrl(url) {
    try {
      const parsedUrl = new URL(url);
      
      // Only allow HTTPS in production
      if (process.env.NODE_ENV === 'production' && parsedUrl.protocol !== 'https:') {
        throw new Error('Only HTTPS webhooks allowed in production');
      }

      // Disallow localhost in production
      if (process.env.NODE_ENV === 'production' && 
          (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1')) {
        throw new Error('Localhost webhooks not allowed in production');
      }

      return true;
    } catch (error) {
      throw new Error(`Invalid webhook URL: ${error.message}`);
    }
  }

  // ================================================
  // BULK OPERATIONS
  // ================================================

  /**
   * Broadcast event to all webhooks in organization
   */
  async broadcastEvent(organizationId, eventType, payload, filter = {}) {
    try {
      const webhooks = await this.getWebhooks(organizationId);
      
      let targetWebhooks = webhooks.filter(w => w.events.includes(eventType));

      // Apply filter
      if (filter.url) {
        targetWebhooks = targetWebhooks.filter(w => w.url.includes(filter.url));
      }

      logger.info('Broadcasting event', {
        organizationId,
        eventType,
        webhookCount: targetWebhooks.length
      });

      for (const webhook of targetWebhooks) {
        await this._queueWebhookDelivery(webhook, eventType, payload);
      }
    } catch (error) {
      logger.error('Error broadcasting event', { organizationId, error: error.message });
    }
  }

  /**
   * Clear failed webhooks
   */
  async clearFailedWebhooks(organizationId) {
    try {
      // Count failed deliveries for each webhook
      const result = await db.query(
        `SELECT webhook_id, COUNT(*) as failure_count 
         FROM webhook_logs 
         WHERE status_code NOT IN (200, 204) 
         AND created_at > NOW() - INTERVAL '24 hours'
         GROUP BY webhook_id
         HAVING COUNT(*) > 10`
      );

      // Disable webhooks with too many failures
      for (const row of result.rows) {
        await db.query(
          `UPDATE webhooks SET is_active = false, status = 'disabled_due_to_failures'
           WHERE id = $1`,
          [row.webhook_id]
        );

        logger.warn('Webhook disabled due to failures', { 
          webhookId: row.webhook_id,
          failures: row.failure_count 
        });
      }
    } catch (error) {
      logger.error('Error cleaning up failed webhooks', { error: error.message });
    }
  }
}

module.exports = WebhookManager;
