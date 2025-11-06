// ================================================
// STRUCTURED LOGGING SYSTEM
// ================================================

const fs = require('fs');
const path = require('path');

class Logger {
  constructor(logDir = './logs') {
    this.logDir = logDir;
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };
    this.currentLevel = process.env.LOG_LEVEL || 'info';

    // Create log directory if not exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.logFile = path.join(logDir, `app-${new Date().toISOString().split('T')[0]}.log`);
  }

  /**
   * Format log entry
   */
  _formatLog(level, message, data = {}) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      pid: process.pid,
      ...data
    });
  }

  /**
   * Write to file
   */
  _writeToFile(logEntry) {
    try {
      fs.appendFileSync(this.logFile, logEntry + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  /**
   * Log error
   */
  error(message, data = {}) {
    if (this.levels[this.currentLevel] >= this.levels.error) {
      const logEntry = this._formatLog('ERROR', message, data);
      console.error('\x1b[31m%s\x1b[0m', logEntry); // Red
      this._writeToFile(logEntry);
    }
  }

  /**
   * Log warning
   */
  warn(message, data = {}) {
    if (this.levels[this.currentLevel] >= this.levels.warn) {
      const logEntry = this._formatLog('WARN', message, data);
      console.warn('\x1b[33m%s\x1b[0m', logEntry); // Yellow
      this._writeToFile(logEntry);
    }
  }

  /**
   * Log info
   */
  info(message, data = {}) {
    if (this.levels[this.currentLevel] >= this.levels.info) {
      const logEntry = this._formatLog('INFO', message, data);
      console.log('\x1b[36m%s\x1b[0m', logEntry); // Cyan
      this._writeToFile(logEntry);
    }
  }

  /**
   * Log debug
   */
  debug(message, data = {}) {
    if (this.levels[this.currentLevel] >= this.levels.debug) {
      const logEntry = this._formatLog('DEBUG', message, data);
      console.debug('\x1b[35m%s\x1b[0m', logEntry); // Magenta
      this._writeToFile(logEntry);
    }
  }

  /**
   * Log trace
   */
  trace(message, data = {}) {
    if (this.levels[this.currentLevel] >= this.levels.trace) {
      const logEntry = this._formatLog('TRACE', message, data);
      console.trace('\x1b[90m%s\x1b[0m', logEntry); // Gray
      this._writeToFile(logEntry);
    }
  }

  /**
   * Log success
   */
  success(message, data = {}) {
    const logEntry = this._formatLog('SUCCESS', message, data);
    console.log('\x1b[32m%s\x1b[0m', logEntry); // Green
    this._writeToFile(logEntry);
  }
}

module.exports = new Logger();
