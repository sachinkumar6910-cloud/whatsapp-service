// ================================================
// ANALYTICS & REPORTING ENGINE
// ================================================

const logger = require('./logger');
const db = require('./db');

class AnalyticsManager {
  constructor() {
    this.cacheDuration = 5 * 60 * 1000; // 5 minutes cache
    this.metricsCache = new Map();
  }

  // ================================================
  // MESSAGE METRICS
  // ================================================

  /**
   * Record message metric
   */
  async recordMessageMetric(clientId, message) {
    try {
      const today = new Date().toISOString().split('T')[0];

      // Get or create daily metric
      let metric = await db.query(
        `SELECT id FROM message_metrics WHERE client_id = $1 AND date = $2`,
        [clientId, today]
      );

      const baseUpdate = {};

      if (message.direction === 'outbound') {
        baseUpdate['outbound_count'] = 'outbound_count + 1';

        if (message.status === 'sent') {
          baseUpdate['sent_count'] = 'sent_count + 1';
        } else if (message.status === 'delivered') {
          baseUpdate['delivered_count'] = 'delivered_count + 1';
        } else if (message.status === 'read') {
          baseUpdate['read_count'] = 'read_count + 1';
        } else if (message.status === 'failed') {
          // Count as sent but failed
          baseUpdate['sent_count'] = 'sent_count + 1';
          baseUpdate['failed_count'] = 'failed_count + 1';
        }
      } else if (message.direction === 'inbound') {
        baseUpdate['inbound_count'] = 'inbound_count + 1';
      }

      if (metric.rows.length > 0) {
        // Update existing metric
        const setClauses = [];
        for (const [key, value] of Object.entries(baseUpdate)) {
          setClauses.push(`${key} = ${value}`);
        }

        await db.query(
          `UPDATE message_metrics SET ${setClauses.join(', ')} 
           WHERE client_id = $1 AND date = $2`,
          [clientId, today]
        );
      } else {
        // Create new metric
        await db.query(
          `INSERT INTO message_metrics (client_id, date, sent_count, outbound_count, inbound_count) 
           VALUES ($1, $2, $3, $4, $5)`,
          [clientId, today, 
           message.direction === 'outbound' ? 1 : 0,
           message.direction === 'outbound' ? 1 : 0,
           message.direction === 'inbound' ? 1 : 0]
        );
      }

      // Invalidate cache
      this.metricsCache.delete(`metrics:${clientId}:${today}`);
    } catch (error) {
      logger.error('Error recording metric', { clientId, error: error.message });
    }
  }

  /**
   * Get daily metrics
   */
  async getDailyMetrics(clientId, date = null) {
    try {
      date = date || new Date().toISOString().split('T')[0];
      const cacheKey = `metrics:${clientId}:${date}`;

      // Check cache
      if (this.metricsCache.has(cacheKey)) {
        return this.metricsCache.get(cacheKey);
      }

      const result = await db.query(
        `SELECT * FROM message_metrics WHERE client_id = $1 AND date = $2`,
        [clientId, date]
      );

      const metrics = result.rows[0] || {
        sent_count: 0,
        delivered_count: 0,
        failed_count: 0,
        read_count: 0,
        inbound_count: 0,
        outbound_count: 0
      };

      // Cache
      this.metricsCache.set(cacheKey, metrics);
      setTimeout(() => this.metricsCache.delete(cacheKey), this.cacheDuration);

      return metrics;
    } catch (error) {
      logger.error('Error getting daily metrics', { clientId, date, error: error.message });
      throw error;
    }
  }

  /**
   * Get metrics range
   */
  async getMetricsRange(clientId, startDate, endDate) {
    try {
      const result = await db.query(
        `SELECT date, sent_count, delivered_count, failed_count, read_count, inbound_count, outbound_count
         FROM message_metrics 
         WHERE client_id = $1 AND date BETWEEN $2 AND $3
         ORDER BY date DESC`,
        [clientId, startDate, endDate]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting metrics range', { clientId, startDate, endDate, error: error.message });
      throw error;
    }
  }

  // ================================================
  // CONTACT METRICS
  // ================================================

  /**
   * Update contact metrics
   */
  async updateContactMetrics(contactId, messageData) {
    try {
      const now = new Date();

      // Check if contact exists in contact_metrics
      const existing = await db.query(
        `SELECT id FROM contact_metrics WHERE contact_id = $1`,
        [contactId]
      );

      if (existing.rows.length > 0) {
        await db.query(
          `UPDATE contact_metrics 
           SET total_messages = total_messages + 1,
               last_conversation_at = NOW()
           WHERE contact_id = $1`,
          [contactId]
        );
      } else {
        await db.query(
          `INSERT INTO contact_metrics (contact_id, total_messages, last_conversation_at)
           VALUES ($1, 1, NOW())`,
          [contactId]
        );
      }

      // Update contact's last contacted
      await db.query(
        `UPDATE contacts SET last_contacted_at = NOW(), message_count = message_count + 1
         WHERE id = $1`,
        [contactId]
      );
    } catch (error) {
      logger.error('Error updating contact metrics', { contactId, error: error.message });
    }
  }

  /**
   * Get contact metrics
   */
  async getContactMetrics(contactId) {
    try {
      const result = await db.query(
        `SELECT * FROM contact_metrics WHERE contact_id = $1`,
        [contactId]
      );

      if (result.rows.length === 0) {
        return {
          totalMessages: 0,
          totalConversations: 0,
          lastConversationAt: null,
          sentimentScore: 0
        };
      }

      return {
        totalMessages: result.rows[0].total_messages,
        totalConversations: result.rows[0].total_conversations,
        firstResponseTime: result.rows[0].first_response_time_seconds,
        lastConversationAt: result.rows[0].last_conversation_at,
        sentimentScore: result.rows[0].sentiment_score
      };
    } catch (error) {
      logger.error('Error getting contact metrics', { contactId, error: error.message });
      throw error;
    }
  }

  // ================================================
  // DELIVERY METRICS
  // ================================================

  /**
   * Get delivery rate
   */
  async getDeliveryRate(clientId, startDate, endDate) {
    try {
      const result = await db.query(
        `SELECT 
           COUNT(CASE WHEN status IN ('delivered', 'read') THEN 1 END) as delivered,
           COUNT(*) as total
         FROM messages 
         WHERE client_id = $1 
         AND direction = 'outbound'
         AND created_at BETWEEN $2 AND $3`,
        [clientId, startDate, endDate]
      );

      const { delivered, total } = result.rows[0];
      return total > 0 ? ((delivered / total) * 100).toFixed(2) : 0;
    } catch (error) {
      logger.error('Error calculating delivery rate', { clientId, error: error.message });
      throw error;
    }
  }

  /**
   * Get read rate
   */
  async getReadRate(clientId, startDate, endDate) {
    try {
      const result = await db.query(
        `SELECT 
           COUNT(CASE WHEN status = 'read' THEN 1 END) as read,
           COUNT(CASE WHEN status IN ('delivered', 'read') THEN 1 END) as delivered
         FROM messages 
         WHERE client_id = $1 
         AND direction = 'outbound'
         AND created_at BETWEEN $2 AND $3`,
        [clientId, startDate, endDate]
      );

      const { read, delivered } = result.rows[0];
      return delivered > 0 ? ((read / delivered) * 100).toFixed(2) : 0;
    } catch (error) {
      logger.error('Error calculating read rate', { clientId, error: error.message });
      throw error;
    }
  }

  /**
   * Get average response time
   */
  async getAverageResponseTime(clientId, startDate, endDate) {
    try {
      // Find average time between outbound and inbound messages
      const result = await db.query(
        `SELECT 
           AVG(EXTRACT(EPOCH FROM (inbound.created_at - outbound.created_at)))::int as avg_response_seconds
         FROM messages outbound
         JOIN messages inbound ON outbound.client_id = inbound.client_id 
           AND outbound.recipient = inbound.sender
           AND inbound.created_at > outbound.created_at
           AND inbound.direction = 'inbound'
         WHERE outbound.client_id = $1
         AND outbound.direction = 'outbound'
         AND outbound.created_at BETWEEN $2 AND $3
         AND inbound.created_at < outbound.created_at + INTERVAL '24 hours'`,
        [clientId, startDate, endDate]
      );

      return result.rows[0].avg_response_seconds || 0;
    } catch (error) {
      logger.error('Error calculating response time', { clientId, error: error.message });
      throw error;
    }
  }

  // ================================================
  // CAMPAIGN ANALYTICS
  // ================================================

  /**
   * Get campaign analytics
   */
  async getCampaignAnalytics(campaignId) {
    try {
      const result = await db.query(
        `SELECT 
           c.id,
           c.name,
           c.recipients_count,
           c.sent_count,
           c.delivered_count,
           c.failed_count,
           c.read_count,
           c.status,
           c.created_at,
           c.started_at,
           c.completed_at,
           ROUND((c.delivered_count::float / NULLIF(c.sent_count, 0)) * 100, 2) as delivery_rate,
           ROUND((c.read_count::float / NULLIF(c.delivered_count, 0)) * 100, 2) as read_rate,
           ROUND((c.failed_count::float / NULLIF(c.sent_count, 0)) * 100, 2) as failure_rate
         FROM campaigns c
         WHERE c.id = $1`,
        [campaignId]
      );

      if (result.rows.length === 0) {
        throw new Error('Campaign not found');
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Error getting campaign analytics', { campaignId, error: error.message });
      throw error;
    }
  }

  /**
   * Get top performing campaigns
   */
  async getTopCampaigns(clientId, limit = 10) {
    try {
      const result = await db.query(
        `SELECT 
           id,
           name,
           sent_count,
           delivered_count,
           read_count,
           ROUND((delivered_count::float / NULLIF(sent_count, 0)) * 100, 2) as delivery_rate,
           ROUND((read_count::float / NULLIF(delivered_count, 0)) * 100, 2) as read_rate
         FROM campaigns
         WHERE client_id = $1
         ORDER BY delivered_count DESC
         LIMIT $2`,
        [clientId, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting top campaigns', { clientId, error: error.message });
      throw error;
    }
  }

  // ================================================
  // CONTACT STATISTICS
  // ================================================

  /**
   * Get most active contacts
   */
  async getMostActiveContacts(organizationId, limit = 20) {
    try {
      const result = await db.query(
        `SELECT 
           id,
           phone_number,
           name,
           message_count,
           last_contacted_at
         FROM contacts
         WHERE organization_id = $1
         ORDER BY message_count DESC
         LIMIT $2`,
        [organizationId, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting active contacts', { organizationId, error: error.message });
      throw error;
    }
  }

  /**
   * Get contact segments
   */
  async getContactSegments(organizationId) {
    try {
      const result = await db.query(
        `SELECT 
           name,
           COUNT(*) as contact_count,
           AVG(c.message_count) as avg_messages
         FROM segments s
         LEFT JOIN contacts c ON s.organization_id = c.organization_id
         WHERE s.organization_id = $1
         GROUP BY s.id, s.name`,
        [organizationId]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting contact segments', { organizationId, error: error.message });
      throw error;
    }
  }

  // ================================================
  // ORGANIZATION STATISTICS
  // ================================================

  /**
   * Get organization dashboard stats
   */
  async getOrganizationStats(organizationId) {
    try {
      const result = await db.query(
        `SELECT 
           (SELECT COUNT(*) FROM whatsapp_clients WHERE organization_id = $1) as total_clients,
           (SELECT COUNT(*) FROM contacts WHERE organization_id = $1) as total_contacts,
           (SELECT COUNT(*) FROM users WHERE organization_id = $1) as total_users,
           (SELECT COUNT(*) FROM campaigns WHERE organization_id = $1) as total_campaigns,
           (SELECT COUNT(*) FROM messages m 
            JOIN whatsapp_clients wc ON m.client_id = wc.id 
            WHERE wc.organization_id = $1) as total_messages,
           (SELECT COUNT(*) FROM messages m 
            JOIN whatsapp_clients wc ON m.client_id = wc.id 
            WHERE wc.organization_id = $1 AND m.direction = 'outbound') as messages_sent,
           (SELECT COUNT(*) FROM messages m 
            JOIN whatsapp_clients wc ON m.client_id = wc.id 
            WHERE wc.organization_id = $1 AND m.direction = 'inbound') as messages_received`,
        [organizationId]
      );

      return result.rows[0];
    } catch (error) {
      logger.error('Error getting organization stats', { organizationId, error: error.message });
      throw error;
    }
  }

  /**
   * Get organization trends
   */
  async getOrganizationTrends(organizationId, days = 30) {
    try {
      const result = await db.query(
        `SELECT 
           m.date,
           SUM(m.sent_count) as sent_count,
           SUM(m.delivered_count) as delivered_count,
           SUM(m.failed_count) as failed_count,
           SUM(m.read_count) as read_count,
           SUM(m.inbound_count) as inbound_count,
           SUM(m.outbound_count) as outbound_count
         FROM message_metrics m
         JOIN whatsapp_clients wc ON m.client_id = wc.id
         WHERE wc.organization_id = $1 AND m.date > CURRENT_DATE - INTERVAL '1 day' * $2
         GROUP BY m.date
         ORDER BY m.date ASC`,
        [organizationId, days]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting organization trends', { organizationId, error: error.message });
      throw error;
    }
  }

  // ================================================
  // EXPORT FUNCTIONALITY
  // ================================================

  /**
   * Export messages to CSV
   */
  async exportMessagesCSV(clientId, startDate, endDate) {
    try {
      const result = await db.query(
        `SELECT 
           created_at,
           direction,
           recipient,
           message_body,
           status,
           message_type
         FROM messages 
         WHERE client_id = $1 
         AND created_at BETWEEN $2 AND $3
         ORDER BY created_at DESC`,
        [clientId, startDate, endDate]
      );

      // Convert to CSV format
      const headers = ['Date', 'Direction', 'Recipient', 'Message', 'Status', 'Type'];
      const rows = result.rows.map(r => [
        new Date(r.created_at).toISOString(),
        r.direction,
        r.recipient,
        `"${r.message_body.replace(/"/g, '""')}"`, // Escape quotes
        r.status,
        r.message_type
      ]);

      const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
      return csv;
    } catch (error) {
      logger.error('Error exporting messages', { clientId, error: error.message });
      throw error;
    }
  }

  /**
   * Export campaign report
   */
  async exportCampaignReport(campaignId) {
    try {
      const campaign = await this.getCampaignAnalytics(campaignId);
      
      const report = {
        campaignName: campaign.name,
        status: campaign.status,
        createdAt: campaign.created_at,
        startedAt: campaign.started_at,
        completedAt: campaign.completed_at,
        metrics: {
          totalRecipients: campaign.recipients_count,
          sent: campaign.sent_count,
          delivered: campaign.delivered_count,
          failed: campaign.failed_count,
          read: campaign.read_count,
          deliveryRate: campaign.delivery_rate,
          readRate: campaign.read_rate,
          failureRate: campaign.failure_rate
        }
      };

      return JSON.stringify(report, null, 2);
    } catch (error) {
      logger.error('Error exporting campaign report', { campaignId, error: error.message });
      throw error;
    }
  }
}

module.exports = AnalyticsManager;
