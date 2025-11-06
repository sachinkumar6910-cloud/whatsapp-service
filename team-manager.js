// ================================================
// TEAM MANAGEMENT & ROLE-BASED ACCESS CONTROL
// ================================================

const logger = require('./logger');
const db = require('./db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class TeamManager {
  constructor() {
    // Define roles and their permissions
    this.roles = {
      admin: {
        permissions: [
          'manage_users',
          'manage_clients',
          'manage_automations',
          'manage_webhooks',
          'view_analytics',
          'manage_billing',
          'manage_settings',
          'send_messages',
          'view_messages',
          'manage_contacts',
          'manage_campaigns',
          'manage_templates',
          'export_data',
          'manage_roles',
          'access_audit_logs'
        ]
      },
      manager: {
        permissions: [
          'manage_clients',
          'manage_automations',
          'view_analytics',
          'send_messages',
          'view_messages',
          'manage_contacts',
          'manage_campaigns',
          'manage_templates',
          'export_data',
          'access_audit_logs'
        ]
      },
      agent: {
        permissions: [
          'send_messages',
          'view_messages',
          'manage_contacts',
          'view_analytics'
        ]
      },
      viewer: {
        permissions: [
          'view_messages',
          'view_analytics'
        ]
      }
    };
  }

  // ================================================
  // USER MANAGEMENT
  // ================================================

  /**
   * Create user
   */
  async createUser(organizationId, userData) {
    try {
      // Validate input
      if (!db.validateEmail(userData.email)) {
        throw new Error('Invalid email format');
      }

      // Check if user already exists
      const existing = await db.query(
        `SELECT id FROM users WHERE organization_id = $1 AND email = $2`,
        [organizationId, userData.email]
      );

      if (existing.rows.length > 0) {
        throw new Error('User with this email already exists');
      }

      // Hash password
      const passwordHash = await bcrypt.hash(userData.password, 10);

      // Default role
      const role = userData.role || 'agent';
      if (!this.roles[role]) {
        throw new Error(`Invalid role: ${role}`);
      }

      const result = await db.query(
        `INSERT INTO users (organization_id, email, password_hash, first_name, last_name, role, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')
         RETURNING id, email, first_name, last_name, role, created_at`,
        [organizationId, userData.email, passwordHash, userData.firstName, userData.lastName, role]
      );

      logger.info('User created', {
        organizationId,
        userId: result.rows[0].id,
        role
      });

      return result.rows[0];
    } catch (error) {
      logger.error('Error creating user', { organizationId, error: error.message });
      throw error;
    }
  }

  /**
   * Get user
   */
  async getUser(userId) {
    try {
      const result = await db.query(
        `SELECT id, organization_id, email, first_name, last_name, role, status, created_at, last_login
         FROM users WHERE id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Error getting user', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Update user
   */
  async updateUser(userId, updates) {
    try {
      const allowed = ['firstName', 'lastName', 'role', 'status'];
      const sanitized = {};

      for (const [key, value] of Object.entries(updates)) {
        if (allowed.includes(key)) {
          sanitized[key] = value;
        }
      }

      if (sanitized.role && !this.roles[sanitized.role]) {
        throw new Error(`Invalid role: ${sanitized.role}`);
      }

      const setClauses = [];
      const values = [];
      let paramCount = 1;

      for (const [key, value] of Object.entries(sanitized)) {
        const column = this._camelToSnake(key);
        setClauses.push(`${column} = $${paramCount++}`);
        values.push(value);
      }

      if (setClauses.length === 0) {
        return this.getUser(userId);
      }

      values.push(userId);
      const sql = `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramCount} RETURNING *`;

      await db.query(sql, values);
      logger.info('User updated', { userId });

      return await this.getUser(userId);
    } catch (error) {
      logger.error('Error updating user', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Delete user
   */
  async deleteUser(userId) {
    try {
      await db.query(
        `UPDATE users SET status = 'inactive' WHERE id = $1`,
        [userId]
      );

      logger.info('User deleted', { userId });
    } catch (error) {
      logger.error('Error deleting user', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Get organization users
   */
  async getOrganizationUsers(organizationId, options = {}) {
    try {
      let query = `SELECT id, email, first_name, last_name, role, status, last_login, created_at 
                   FROM users WHERE organization_id = $1`;

      const values = [organizationId];
      let paramCount = 2;

      if (options.role) {
        query += ` AND role = $${paramCount++}`;
        values.push(options.role);
      }

      if (options.status) {
        query += ` AND status = $${paramCount++}`;
        values.push(options.status);
      }

      query += ` ORDER BY created_at DESC`;

      if (options.limit) {
        query += ` LIMIT $${paramCount++}`;
        values.push(options.limit);
      }

      if (options.offset) {
        query += ` OFFSET $${paramCount++}`;
        values.push(options.offset);
      }

      const result = await db.query(query, values);
      return result.rows;
    } catch (error) {
      logger.error('Error getting organization users', { organizationId, error: error.message });
      throw error;
    }
  }

  // ================================================
  // AUTHENTICATION
  // ================================================

  /**
   * Authenticate user
   */
  async authenticateUser(email, password) {
    try {
      const result = await db.query(
        `SELECT id, organization_id, password_hash, role, status FROM users WHERE email = $1`,
        [email]
      );

      if (result.rows.length === 0) {
        throw new Error('Invalid email or password');
      }

      const user = result.rows[0];

      if (user.status !== 'active') {
        throw new Error('User account is inactive');
      }

      // Verify password
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        throw new Error('Invalid email or password');
      }

      // Update last login
      await db.query(
        `UPDATE users SET last_login = NOW() WHERE id = $1`,
        [user.id]
      );

      // Generate JWT token (implement as needed)
      const token = this._generateToken(user.id, user.organization_id);

      logger.info('User authenticated', { userId: user.id });

      return {
        userId: user.id,
        organizationId: user.organization_id,
        role: user.role,
        token
      };
    } catch (error) {
      logger.error('Authentication failed', { email, error: error.message });
      throw error;
    }
  }

  /**
   * Change password
   */
  async changePassword(userId, oldPassword, newPassword) {
    try {
      const result = await db.query(
        `SELECT password_hash FROM users WHERE id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      // Verify old password
      const valid = await bcrypt.compare(oldPassword, result.rows[0].password_hash);
      if (!valid) {
        throw new Error('Current password is incorrect');
      }

      // Hash new password
      const newHash = await bcrypt.hash(newPassword, 10);

      await db.query(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [newHash, userId]
      );

      logger.info('Password changed', { userId });
    } catch (error) {
      logger.error('Error changing password', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Reset password (admin)
   */
  async resetPassword(userId, newPassword) {
    try {
      const newHash = await bcrypt.hash(newPassword, 10);

      await db.query(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [newHash, userId]
      );

      logger.info('Password reset', { userId });
    } catch (error) {
      logger.error('Error resetting password', { userId, error: error.message });
      throw error;
    }
  }

  // ================================================
  // PERMISSIONS & AUTHORIZATION
  // ================================================

  /**
   * Check if user has permission
   */
  async hasPermission(userId, permission) {
    try {
      const user = await this.getUser(userId);
      const rolePermissions = this.roles[user.role].permissions;

      return rolePermissions.includes(permission);
    } catch (error) {
      logger.error('Error checking permission', { userId, permission, error: error.message });
      return false;
    }
  }

  /**
   * Check if user can access client
   */
  async canAccessClient(userId, clientId) {
    try {
      const user = await this.getUser(userId);

      // Admins can access all clients
      if (user.role === 'admin') {
        return true;
      }

      // Check team assignment
      const result = await db.query(
        `SELECT 1 FROM team_members 
         WHERE user_id = $1 AND assigned_clients::text LIKE $2`,
        [userId, `%"${clientId}"%`]
      );

      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error checking client access', { userId, clientId, error: error.message });
      return false;
    }
  }

  /**
   * Assign client to team member
   */
  async assignClientToMember(userId, clientId) {
    try {
      const result = await db.query(
        `SELECT assigned_clients FROM team_members WHERE user_id = $1`,
        [userId]
      );

      let assignedClients = result.rows.length > 0 ? result.rows[0].assigned_clients : [];
      
      if (!assignedClients.includes(clientId)) {
        assignedClients.push(clientId);

        await db.query(
          `INSERT INTO team_members (user_id, assigned_clients) VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET assigned_clients = $2`,
          [userId, JSON.stringify(assignedClients)]
        );
      }

      logger.info('Client assigned to team member', { userId, clientId });
    } catch (error) {
      logger.error('Error assigning client', { userId, clientId, error: error.message });
      throw error;
    }
  }

  /**
   * Remove client assignment from team member
   */
  async removeClientFromMember(userId, clientId) {
    try {
      const result = await db.query(
        `SELECT assigned_clients FROM team_members WHERE user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) return;

      let assignedClients = result.rows[0].assigned_clients;
      assignedClients = assignedClients.filter(id => id !== clientId);

      await db.query(
        `UPDATE team_members SET assigned_clients = $1 WHERE user_id = $2`,
        [JSON.stringify(assignedClients), userId]
      );

      logger.info('Client removed from team member', { userId, clientId });
    } catch (error) {
      logger.error('Error removing client', { userId, clientId, error: error.message });
      throw error;
    }
  }

  // ================================================
  // API KEY MANAGEMENT
  // ================================================

  /**
   * Generate API key
   */
  async generateApiKey(userId, name, permissions = []) {
    try {
      const key = crypto.randomBytes(32).toString('hex');
      const keyHash = await bcrypt.hash(key, 10);

      const result = await db.query(
        `INSERT INTO api_keys (user_id, name, key_hash, permissions)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, created_at`,
        [userId, name, keyHash, JSON.stringify(permissions)]
      );

      logger.info('API key generated', { userId, keyName: name });

      // Only return the key once (never store plain key in database)
      return {
        ...result.rows[0],
        key: key, // Only return this once
        message: 'Store this key securely. You will not be able to see it again.'
      };
    } catch (error) {
      logger.error('Error generating API key', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Verify API key
   */
  async verifyApiKey(keyToVerify) {
    try {
      const result = await db.query(
        `SELECT id, user_id, permissions, is_active, expires_at FROM api_keys 
         WHERE is_active = true`,
        []
      );

      for (const row of result.rows) {
        const valid = await bcrypt.compare(keyToVerify, row.key_hash);
        if (valid) {
          // Check expiration
          if (row.expires_at && new Date(row.expires_at) < new Date()) {
            continue; // Skip expired keys
          }

          // Update last used
          await db.query(
            `UPDATE api_keys SET last_used = NOW() WHERE id = $1`,
            [row.id]
          );

          return {
            userId: row.user_id,
            permissions: JSON.parse(row.permissions)
          };
        }
      }

      return null; // Key not found
    } catch (error) {
      logger.error('Error verifying API key', { error: error.message });
      return null;
    }
  }

  /**
   * List API keys for user
   */
  async listApiKeys(userId) {
    try {
      const result = await db.query(
        `SELECT id, name, permissions, is_active, last_used, created_at, expires_at
         FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
      );

      return result.rows.map(row => ({
        ...row,
        permissions: JSON.parse(row.permissions)
      }));
    } catch (error) {
      logger.error('Error listing API keys', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Revoke API key
   */
  async revokeApiKey(keyId) {
    try {
      await db.query(
        `UPDATE api_keys SET is_active = false WHERE id = $1`,
        [keyId]
      );

      logger.info('API key revoked', { keyId });
    } catch (error) {
      logger.error('Error revoking API key', { keyId, error: error.message });
      throw error;
    }
  }

  // ================================================
  // AUDIT & LOGGING
  // ================================================

  /**
   * Log action
   */
  async logAction(organizationId, userId, action, resourceType, resourceId, changes = {}) {
    try {
      await db.query(
        `INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id, changes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [organizationId, userId, action, resourceType, resourceId, JSON.stringify(changes)]
      );
    } catch (error) {
      logger.error('Error logging action', { error: error.message });
    }
  }

  /**
   * Get audit logs
   */
  async getAuditLogs(organizationId, options = {}) {
    try {
      let query = `SELECT * FROM audit_logs WHERE organization_id = $1`;
      const values = [organizationId];
      let paramCount = 2;

      if (options.userId) {
        query += ` AND user_id = $${paramCount++}`;
        values.push(options.userId);
      }

      if (options.action) {
        query += ` AND action = $${paramCount++}`;
        values.push(options.action);
      }

      if (options.resourceType) {
        query += ` AND resource_type = $${paramCount++}`;
        values.push(options.resourceType);
      }

      query += ` ORDER BY created_at DESC LIMIT 1000`;

      const result = await db.query(query, values);
      return result.rows;
    } catch (error) {
      logger.error('Error getting audit logs', { organizationId, error: error.message });
      throw error;
    }
  }

  // ================================================
  // HELPER METHODS
  // ================================================

  _camelToSnake(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  _generateToken(userId, organizationId) {
    // Placeholder for JWT token generation
    // Implement actual JWT signing with secret
    return Buffer.from(`${userId}:${organizationId}:${Date.now()}`).toString('base64');
  }
}

module.exports = TeamManager;
