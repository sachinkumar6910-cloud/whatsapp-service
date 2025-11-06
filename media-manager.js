// ================================================
// MEDIA MESSAGE SUPPORT
// ================================================

const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const crypto = require('crypto');
const logger = require('./logger');
const db = require('./db');

class MediaManager {
  constructor(storageDir = './uploads') {
    this.storageDir = storageDir;
    this.maxFileSize = 100 * 1024 * 1024; // 100MB
    this.allowedMimeTypes = {
      image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      video: ['video/mp4', 'video/quicktime', 'video/x-msvideo'],
      audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'],
      document: ['application/pdf', 'application/msword', 
                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                 'application/vnd.ms-excel',
                 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    };

    // Create storage directory if not exists
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
  }

  // ================================================
  // FILE UPLOAD & STORAGE
  // ================================================

  /**
   * Upload file from buffer
   */
  async uploadFile(buffer, originalFilename, mimeType, clientId, organizationId) {
    try {
      // Validate file
      this._validateFile(buffer, mimeType);

      // Generate safe filename
      const fileHash = crypto.randomBytes(16).toString('hex');
      const ext = mime.extension(mimeType) || 'bin';
      const safeFilename = `${fileHash}.${ext}`;

      // Create organized storage path: /uploads/org/{orgId}/client/{clientId}/
      const clientStoragePath = path.join(this.storageDir, organizationId, clientId);
      if (!fs.existsSync(clientStoragePath)) {
        fs.mkdirSync(clientStoragePath, { recursive: true });
      }

      const filepath = path.join(clientStoragePath, safeFilename);

      // Write file
      fs.writeFileSync(filepath, buffer);

      // Store metadata in database
      const result = await db.query(
        `INSERT INTO file_uploads 
         (client_id, filename, original_filename, mime_type, file_size, storage_path) 
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, filename, storage_path`,
        [clientId, safeFilename, originalFilename, mimeType, buffer.length, filepath]
      );

      logger.info('File uploaded', { 
        filename: safeFilename, 
        size: buffer.length, 
        mimeType 
      });

      return {
        id: result.rows[0].id,
        filename: result.rows[0].filename,
        originalFilename,
        mimeType,
        size: buffer.length,
        storagePath: result.rows[0].storage_path
      };
    } catch (error) {
      logger.error('File upload failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Get file metadata
   */
  async getFile(fileId) {
    try {
      const result = await db.query(
        `SELECT * FROM file_uploads WHERE id = $1`,
        [fileId]
      );

      if (result.rows.length === 0) {
        throw new Error('File not found');
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Error getting file', { fileId, error: error.message });
      throw error;
    }
  }

  /**
   * Download file
   */
  async downloadFile(fileId) {
    try {
      const file = await this.getFile(fileId);
      
      // Check file exists
      if (!fs.existsSync(file.storage_path)) {
        throw new Error('File not found on disk');
      }

      const buffer = fs.readFileSync(file.storage_path);
      return {
        buffer,
        filename: file.original_filename,
        mimeType: file.mime_type
      };
    } catch (error) {
      logger.error('Error downloading file', { fileId, error: error.message });
      throw error;
    }
  }

  /**
   * Delete file
   */
  async deleteFile(fileId) {
    try {
      const file = await this.getFile(fileId);

      // Delete from disk
      if (fs.existsSync(file.storage_path)) {
        fs.unlinkSync(file.storage_path);
      }

      // Delete from database
      await db.query(
        `DELETE FROM file_uploads WHERE id = $1`,
        [fileId]
      );

      logger.info('File deleted', { fileId });
    } catch (error) {
      logger.error('Error deleting file', { fileId, error: error.message });
      throw error;
    }
  }

  // ================================================
  // MEDIA MESSAGE SENDING
  // ================================================

  /**
   * Send image message
   */
  async sendImageMessage(client, to, imagePath, caption = '') {
    try {
      const { MessageMedia } = require('whatsapp-web.js');
      
      // Read file
      const buffer = fs.readFileSync(imagePath);
      const mimeType = mime.lookup(imagePath) || 'image/jpeg';
      
      // Create message media
      const media = new MessageMedia(
        mimeType,
        buffer.toString('base64'),
        path.basename(imagePath)
      );

      const response = await client.sendMessage(to, media, { caption });
      return response;
    } catch (error) {
      logger.error('Error sending image', { to, error: error.message });
      throw error;
    }
  }

  /**
   * Send video message
   */
  async sendVideoMessage(client, to, videoPath, caption = '') {
    try {
      const { MessageMedia } = require('whatsapp-web.js');
      
      const buffer = fs.readFileSync(videoPath);
      const mimeType = 'video/mp4';
      
      const media = new MessageMedia(
        mimeType,
        buffer.toString('base64'),
        path.basename(videoPath)
      );

      const response = await client.sendMessage(to, media, { caption });
      return response;
    } catch (error) {
      logger.error('Error sending video', { to, error: error.message });
      throw error;
    }
  }

  /**
   * Send document message
   */
  async sendDocumentMessage(client, to, documentPath, filename = '') {
    try {
      const { MessageMedia } = require('whatsapp-web.js');
      
      const buffer = fs.readFileSync(documentPath);
      const mimeType = mime.lookup(documentPath) || 'application/octet-stream';
      
      const media = new MessageMedia(
        mimeType,
        buffer.toString('base64'),
        filename || path.basename(documentPath)
      );

      const response = await client.sendMessage(to, media);
      return response;
    } catch (error) {
      logger.error('Error sending document', { to, error: error.message });
      throw error;
    }
  }

  /**
   * Send audio message
   */
  async sendAudioMessage(client, to, audioPath, isVoiceMessage = true) {
    try {
      const { MessageMedia } = require('whatsapp-web.js');
      
      const buffer = fs.readFileSync(audioPath);
      const mimeType = mime.lookup(audioPath) || 'audio/mpeg';
      
      const media = new MessageMedia(
        mimeType,
        buffer.toString('base64'),
        path.basename(audioPath)
      );

      const options = isVoiceMessage ? { sendAudioAsVoice: true } : {};
      const response = await client.sendMessage(to, media, options);
      return response;
    } catch (error) {
      logger.error('Error sending audio', { to, error: error.message });
      throw error;
    }
  }

  // ================================================
  // MEDIA STREAMING
  // ================================================

  /**
   * Get file stream for download
   */
  getFileStream(fileId) {
    try {
      const file = this.getFileSync(fileId);
      
      if (!fs.existsSync(file.storage_path)) {
        throw new Error('File not found');
      }

      return fs.createReadStream(file.storage_path);
    } catch (error) {
      logger.error('Error creating file stream', { fileId, error: error.message });
      throw error;
    }
  }

  /**
   * Stream file to client (for downloads)
   */
  streamFileToResponse(fileId, response) {
    try {
      const file = this.getFileSync(fileId);
      
      if (!fs.existsSync(file.storage_path)) {
        return response.status(404).json({ error: 'File not found' });
      }

      response.setHeader('Content-Type', file.mime_type);
      response.setHeader('Content-Disposition', 
        `attachment; filename="${file.original_filename}"`);

      const stream = fs.createReadStream(file.storage_path);
      stream.pipe(response);
    } catch (error) {
      logger.error('Error streaming file', { fileId, error: error.message });
      response.status(500).json({ error: 'Error streaming file' });
    }
  }

  // ================================================
  // MEDIA PROCESSING & OPTIMIZATION
  // ================================================

  /**
   * Get media info (dimensions, duration, etc)
   */
  async getMediaInfo(filepath, mimeType) {
    try {
      const stats = fs.statSync(filepath);
      
      const mediaInfo = {
        filename: path.basename(filepath),
        size: stats.size,
        mimeType,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime
      };

      // TODO: Add ffprobe for video duration, audio duration, image dimensions
      
      return mediaInfo;
    } catch (error) {
      logger.error('Error getting media info', { error: error.message });
      throw error;
    }
  }

  /**
   * Compress image before sending
   */
  async compressImage(inputPath, outputPath, quality = 80) {
    // TODO: Use sharp library for image compression
    // This is a placeholder for the actual implementation
    logger.info('Image compression not yet implemented');
    return inputPath;
  }

  /**
   * Compress video before sending
   */
  async compressVideo(inputPath, outputPath) {
    // TODO: Use ffmpeg for video compression
    // This is a placeholder for the actual implementation
    logger.info('Video compression not yet implemented');
    return inputPath;
  }

  // ================================================
  // VALIDATION
  // ================================================

  /**
   * Validate file before upload
   */
  _validateFile(buffer, mimeType) {
    // Check file size
    if (buffer.length > this.maxFileSize) {
      throw new Error(`File size exceeds maximum of ${this.maxFileSize / 1024 / 1024}MB`);
    }

    // Check mime type
    const isAllowed = Object.values(this.allowedMimeTypes)
      .flat()
      .includes(mimeType);

    if (!isAllowed) {
      throw new Error(`MIME type ${mimeType} is not allowed`);
    }

    // Check file magic bytes (file signature)
    this._validateMagicBytes(buffer, mimeType);
  }

  /**
   * Validate file magic bytes
   */
  _validateMagicBytes(buffer, mimeType) {
    const signatures = {
      'image/jpeg': Buffer.from([0xFF, 0xD8, 0xFF]),
      'image/png': Buffer.from([0x89, 0x50, 0x4E, 0x47]),
      'image/gif': Buffer.from([0x47, 0x49, 0x46]),
      'application/pdf': Buffer.from([0x25, 0x50, 0x44, 0x46]),
      'video/mp4': null, // Complex signature, skip
      'audio/mpeg': Buffer.from([0xFF, 0xFB])
    };

    const signature = signatures[mimeType];
    if (!signature) return; // Skip validation if no signature

    const fileSignature = buffer.slice(0, signature.length);
    if (!fileSignature.equals(signature)) {
      logger.warn('Invalid file signature', { mimeType });
      throw new Error('Invalid file format');
    }
  }

  // ================================================
  // DATABASE HELPER
  // ================================================

  /**
   * Get file sync (for internal use)
   */
  getFileSync(fileId) {
    // This is a synchronous wrapper - in production, use async version
    // Placeholder for synchronous file lookup
    return {
      id: fileId,
      storage_path: path.join(this.storageDir, 'file'),
      mime_type: 'application/octet-stream',
      original_filename: 'file'
    };
  }

  // ================================================
  // CLEANUP & MAINTENANCE
  // ================================================

  /**
   * Clean up expired files
   */
  async cleanupExpiredFiles() {
    try {
      const result = await db.query(
        `SELECT * FROM file_uploads WHERE expires_at IS NOT NULL AND expires_at < NOW()`
      );

      for (const file of result.rows) {
        await this.deleteFile(file.id);
      }

      logger.info('Cleaned up expired files', { count: result.rows.length });
    } catch (error) {
      logger.error('Error cleaning up files', { error: error.message });
    }
  }

  /**
   * Get storage usage
   */
  async getStorageUsage(organizationId) {
    try {
      const result = await db.query(
        `SELECT SUM(file_size) as total_size FROM file_uploads 
         WHERE client_id IN (
           SELECT id FROM whatsapp_clients WHERE organization_id = $1
         )`,
        [organizationId]
      );

      return result.rows[0].total_size || 0;
    } catch (error) {
      logger.error('Error getting storage usage', { error: error.message });
      throw error;
    }
  }
}

module.exports = MediaManager;
