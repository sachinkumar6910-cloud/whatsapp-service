require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const logger = require('./logger');

// ================================================
// DATABASE CONNECTION POOL WITH SECURITY
// ================================================

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'whatsapp_service',
  max: 20, // Maximum connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // SSL for production
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: true,
    ca: process.env.DB_SSL_CA
  } : false,
  // Connection timeout
  statement_timeout: 30000
});

// Handle pool errors
pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', { error: err });
  process.exit(-1);
});

// ================================================
// PREPARED STATEMENTS & SQL INJECTION PREVENTION
// ================================================

/**
 * Parameterized query execution
 * @param {string} text - SQL query with $1, $2 placeholders
 * @param {array} values - Parameter values
 * @returns {Promise}
 */
async function query(text, values = []) {
  const start = Date.now();
  try {
    // Validate input
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid SQL query');
    }
    
    // Ensure values is an array
    if (!Array.isArray(values)) {
      throw new Error('Query values must be an array');
    }

    // Log query in development
    if (process.env.NODE_ENV === 'development') {
      logger.debug('Database query', { query: text, values });
    }

    const result = await pool.query(text, values);
    const duration = Date.now() - start;

    if (duration > 5000) {
      logger.warn('Slow query detected', { query: text, duration });
    }

    return result;
  } catch (error) {
    logger.error('Database query error', { 
      query: text, 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

/**
 * Transaction execution
 * @param {Function} callback - Transaction callback
 */
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Transaction failed', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Parameterized query builder to prevent SQL injection
 */
class QueryBuilder {
  constructor(table) {
    this.table = table;
    this.queryParts = [];
    this.values = [];
    this.paramCount = 0;
  }

  select(columns = '*') {
    this.queryParts.push(`SELECT ${columns} FROM ${this._sanitizeIdentifier(this.table)}`);
    return this;
  }

  insert(data) {
    const columns = Object.keys(data);
    const placeholders = columns.map((_, i) => `$${++this.paramCount}`);
    this.values.push(...Object.values(data));
    this.queryParts.push(
      `INSERT INTO ${this._sanitizeIdentifier(this.table)} (${columns.join(',')}) VALUES (${placeholders.join(',')})`
    );
    return this;
  }

  update(data) {
    const setClause = Object.keys(data)
      .map(key => `${this._sanitizeIdentifier(key)} = $${++this.paramCount}`)
      .join(',');
    this.values.push(...Object.values(data));
    this.queryParts.push(`UPDATE ${this._sanitizeIdentifier(this.table)} SET ${setClause}`);
    return this;
  }

  where(conditions) {
    if (typeof conditions === 'object') {
      const whereClause = Object.entries(conditions)
        .map(([key, value]) => {
          this.values.push(value);
          return `${this._sanitizeIdentifier(key)} = $${++this.paramCount}`;
        })
        .join(' AND ');
      this.queryParts.push(`WHERE ${whereClause}`);
    }
    return this;
  }

  limit(n) {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error('Invalid limit value');
    }
    this.queryParts.push(`LIMIT ${n}`);
    return this;
  }

  offset(n) {
    if (!Number.isInteger(n) || n < 0) {
      throw new Error('Invalid offset value');
    }
    this.queryParts.push(`OFFSET ${n}`);
    return this;
  }

  orderBy(column, direction = 'ASC') {
    direction = direction.toUpperCase();
    if (!['ASC', 'DESC'].includes(direction)) {
      throw new Error('Invalid sort direction');
    }
    this.queryParts.push(`ORDER BY ${this._sanitizeIdentifier(column)} ${direction}`);
    return this;
  }

  async execute() {
    const sql = this.queryParts.join(' ');
    return await query(sql, this.values);
  }

  _sanitizeIdentifier(identifier) {
    // Remove any potentially dangerous characters
    if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
      throw new Error(`Invalid identifier: ${identifier}`);
    }
    return `"${identifier}"`;
  }

  build() {
    return {
      sql: this.queryParts.join(' '),
      values: this.values
    };
  }
}

// ================================================
// ENCRYPTION UTILITIES FOR SENSITIVE DATA
// ================================================

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = Buffer.from(process.env.DB_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex'), 'hex');

function encryptSensitive(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decryptSensitive(encryptedText) {
  try {
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    logger.error('Decryption failed', { error: error.message });
    throw new Error('Decryption failed');
  }
}

// ================================================
// INPUT VALIDATION & SANITIZATION
// ================================================

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePhone(phone) {
  // International phone format validation
  const phoneRegex = /^\d{10,15}@[gc]\.us$/;
  return phoneRegex.test(phone);
}

function sanitizeString(str, maxLength = 255) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLength).trim();
}

function sanitizeJSON(obj) {
  // Deep sanitize JSON objects
  if (Array.isArray(obj)) {
    return obj.map(sanitizeJSON);
  }
  if (typeof obj === 'object' && obj !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (!/^[a-zA-Z0-9_$]+$/.test(key)) {
        logger.warn('Invalid JSON key detected', { key });
        continue;
      }
      sanitized[key] = sanitizeJSON(value);
    }
    return sanitized;
  }
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  return obj;
}

// ================================================
// DATABASE HELPER FUNCTIONS
// ================================================

async function findById(table, id) {
  const result = await new QueryBuilder(table)
    .select()
    .where({ id })
    .execute();
  return result.rows[0];
}

async function findAll(table, options = {}) {
  let qb = new QueryBuilder(table).select();
  
  if (options.where) {
    qb = qb.where(options.where);
  }
  if (options.limit) {
    qb = qb.limit(options.limit);
  }
  if (options.offset) {
    qb = qb.offset(options.offset);
  }
  if (options.orderBy) {
    qb = qb.orderBy(options.orderBy.column, options.orderBy.direction);
  }
  
  const result = await qb.execute();
  return result.rows;
}

async function insert(table, data) {
  const sanitized = sanitizeJSON(data);
  const result = await new QueryBuilder(table)
    .insert(sanitized)
    .execute();
  return result.rows[0];
}

async function update(table, id, data) {
  const sanitized = sanitizeJSON(data);
  const result = await new QueryBuilder(table)
    .update(sanitized)
    .where({ id })
    .execute();
  return result.rowCount > 0;
}

async function deleteRecord(table, id) {
  const result = await query(
    `DELETE FROM "${table}" WHERE id = $1`,
    [id]
  );
  return result.rowCount > 0;
}

// ================================================
// RATE LIMITING IN DATABASE
// ================================================

async function checkRateLimit(clientId, action, limit, windowSeconds) {
  const result = await query(
    `SELECT COUNT(*) as count FROM audit_logs 
     WHERE client_id = $1 AND action = $2 
     AND created_at > NOW() - INTERVAL '1 second' * $3`,
    [clientId, action, windowSeconds]
  );
  
  const count = parseInt(result.rows[0].count);
  return count < limit;
}

async function recordAction(clientId, action, details) {
  await query(
    `INSERT INTO audit_logs (client_id, action, details, created_at) 
     VALUES ($1, $2, $3, NOW())`,
    [clientId, action, JSON.stringify(details)]
  );
}

// ================================================
// EXPORTS
// ================================================

module.exports = {
  pool,
  query,
  transaction,
  QueryBuilder,
  encryptSensitive,
  decryptSensitive,
  validateEmail,
  validatePhone,
  sanitizeString,
  sanitizeJSON,
  findById,
  findAll,
  insert,
  update,
  deleteRecord,
  checkRateLimit,
  recordAction
};
