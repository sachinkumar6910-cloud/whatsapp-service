const fs = require('fs');
const path = require('path');

class MessageTemplates {
  constructor(logger) {
    this.logger = logger;
    this.templates = {
      // Business-specific templates
      real_estate: {
        inquiry_response: {
          name: 'Property Inquiry Response',
          template: 'Thank you for your interest in {property_name}! I\'d be happy to schedule a viewing. What day works best for you?',
          variables: ['property_name'],
          category: 'inquiry'
        },
        price_discussion: {
          name: 'Price Discussion',
          template: 'The listed price is {price}. We can discuss financing options and current market conditions.',
          variables: ['price'],
          category: 'pricing'
        },
        viewing_confirmation: {
          name: 'Viewing Confirmation',
          template: 'Great! I\'ve scheduled your viewing of {property_name} for {date} at {time}. Address: {address}',
          variables: ['property_name', 'date', 'time', 'address'],
          category: 'scheduling'
        },
        offer_received: {
          name: 'Offer Received',
          template: 'Thank you for your offer of {offer_amount} for {property_name}. I\'ll present this to the seller and get back to you within 24 hours.',
          variables: ['offer_amount', 'property_name'],
          category: 'offers'
        }
      },

      healthcare: {
        appointment_booking: {
          name: 'Appointment Confirmation',
          template: 'Thank you for choosing us! Your appointment is confirmed for {date} at {time} with Dr. {doctor_name}.',
          variables: ['date', 'time', 'doctor_name'],
          category: 'appointments'
        },
        prescription_reminder: {
          name: 'Prescription Reminder',
          template: 'Hi {patient_name}, it\'s time to refill your {medication} prescription. Would you like us to process this?',
          variables: ['patient_name', 'medication'],
          category: 'prescriptions'
        },
        test_results: {
          name: 'Test Results Ready',
          template: 'Your test results are ready. Please schedule an appointment to discuss them. Call {phone} to book.',
          variables: ['phone'],
          category: 'results'
        },
        follow_up: {
          name: 'Follow-up Care',
          template: 'How are you feeling after your {procedure}? Please let us know if you need any assistance.',
          variables: ['procedure'],
          category: 'follow_up'
        }
      },

      retail: {
        order_confirmation: {
          name: 'Order Confirmation',
          template: 'Order #{order_id} confirmed! Total: {total}. Expected delivery: {delivery_date}',
          variables: ['order_id', 'total', 'delivery_date'],
          category: 'orders'
        },
        shipping_update: {
          name: 'Shipping Update',
          template: 'Your order #{order_id} has been shipped! Track it here: {tracking_link}',
          variables: ['order_id', 'tracking_link'],
          category: 'shipping'
        },
        return_request: {
          name: 'Return Request',
          template: 'We\'re sorry the item didn\'t meet your expectations. Please visit {return_center} for returns.',
          variables: ['return_center'],
          category: 'returns'
        },
        loyalty_offer: {
          name: 'Loyalty Offer',
          template: 'Thank you for being a valued customer! Here\'s {discount}% off your next purchase: {promo_code}',
          variables: ['discount', 'promo_code'],
          category: 'loyalty'
        }
      },

      education: {
        enrollment_confirmation: {
          name: 'Enrollment Confirmation',
          template: 'Welcome to {course_name}! Your enrollment is confirmed. Class starts {start_date}.',
          variables: ['course_name', 'start_date'],
          category: 'enrollment'
        },
        assignment_reminder: {
          name: 'Assignment Reminder',
          template: '{assignment_name} is due in {days_remaining} days. Need help? Contact your instructor.',
          variables: ['assignment_name', 'days_remaining'],
          category: 'assignments'
        },
        grade_notification: {
          name: 'Grade Notification',
          template: 'Your grade for {assignment_name} is now available: {grade}. Feedback: {feedback}',
          variables: ['assignment_name', 'grade', 'feedback'],
          category: 'grades'
        },
        exam_reminder: {
          name: 'Exam Reminder',
          template: 'Exam reminder: {exam_name} is scheduled for {date} at {time}. Study materials: {link}',
          variables: ['exam_name', 'date', 'time', 'link'],
          category: 'exams'
        }
      },

      hospitality: {
        booking_confirmation: {
          name: 'Booking Confirmation',
          template: 'Your reservation at {hotel_name} is confirmed! Check-in: {checkin_date}, Check-out: {checkout_date}',
          variables: ['hotel_name', 'checkin_date', 'checkout_date'],
          category: 'bookings'
        },
        checkin_reminder: {
          name: 'Check-in Reminder',
          template: 'Check-in reminder: Your room at {hotel_name} is ready. Please arrive by {time}.',
          variables: ['hotel_name', 'time'],
          category: 'checkin'
        },
        checkout_reminder: {
          name: 'Checkout Reminder',
          template: 'Checkout reminder: Please checkout by {time} tomorrow. Thank you for staying with us!',
          variables: ['time'],
          category: 'checkout'
        },
        feedback_request: {
          name: 'Feedback Request',
          template: 'How was your stay at {hotel_name}? Please rate us 1-5 stars and share your feedback.',
          variables: ['hotel_name'],
          category: 'feedback'
        }
      },

      // General business templates
      general: {
        welcome_message: {
          name: 'Welcome Message',
          template: 'Welcome to {business_name}! Thanks for choosing us. How can we help you today?',
          variables: ['business_name'],
          category: 'welcome'
        },
        support_acknowledgment: {
          name: 'Support Acknowledgment',
          template: 'Thank you for contacting {business_name}. We\'ve received your message and will respond within 24 hours.',
          variables: ['business_name'],
          category: 'support'
        },
        follow_up: {
          name: 'Follow-up Message',
          template: 'Hi {customer_name}, following up on our previous conversation. How can we assist you further?',
          variables: ['customer_name'],
          category: 'follow_up'
        },
        satisfaction_survey: {
          name: 'Satisfaction Survey',
          template: 'How satisfied are you with our service? Please rate us 1-5 stars. Your feedback helps us improve!',
          variables: [],
          category: 'feedback'
        }
      }
    };

    this.customTemplates = new Map(); // clientId -> custom templates
  }

  // Get templates for a business type
  getTemplates(businessType = 'general') {
    return {
      ...this.templates[businessType],
      ...this.templates.general
    };
  }

  // Get template by ID
  getTemplate(businessType, templateId) {
    const businessTemplates = this.templates[businessType] || {};
    const generalTemplates = this.templates.general;

    return businessTemplates[templateId] || generalTemplates[templateId] || null;
  }

  // Render template with variables
  renderTemplate(template, variables = {}) {
    let rendered = template.template;

    // Replace variables
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`{${key}}`, 'g');
      rendered = rendered.replace(regex, value);
    });

    // Check for missing variables
    const missingVars = template.variables.filter(variable => {
      return !variables[variable] && rendered.includes(`{${variable}}`);
    });

    if (missingVars.length > 0) {
      throw new Error(`Missing template variables: ${missingVars.join(', ')}`);
    }

    return rendered;
  }

  // Add custom template for client
  addCustomTemplate(clientId, templateId, template) {
    if (!this.customTemplates.has(clientId)) {
      this.customTemplates.set(clientId, {});
    }

    const clientTemplates = this.customTemplates.get(clientId);
    clientTemplates[templateId] = {
      ...template,
      custom: true,
      createdAt: Date.now()
    };

    this.logger.info('Custom template added', { clientId, templateId });
  }

  // Get custom templates for client
  getCustomTemplates(clientId) {
    return this.customTemplates.get(clientId) || {};
  }

  // Delete custom template
  deleteCustomTemplate(clientId, templateId) {
    const clientTemplates = this.customTemplates.get(clientId);
    if (clientTemplates && clientTemplates[templateId]) {
      delete clientTemplates[templateId];
      this.logger.info('Custom template deleted', { clientId, templateId });
      return true;
    }
    return false;
  }

  // Validate template variables
  validateTemplate(template, variables = {}) {
    try {
      this.renderTemplate(template, variables);
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
}

class CampaignManager {
  constructor(logger, auditLogger) {
    this.logger = logger;
    this.auditLogger = auditLogger;
    this.campaigns = new Map(); // campaignId -> campaign data
    this.activeCampaigns = new Map(); // clientId -> active campaigns
  }

  // Create a new campaign
  createCampaign(clientId, campaignData) {
    const campaign = {
      id: `camp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      clientId,
      ...campaignData,
      status: 'draft',
      createdAt: Date.now(),
      stats: {
        sent: 0,
        delivered: 0,
        responses: 0,
        conversions: 0
      }
    };

    this.campaigns.set(campaign.id, campaign);
    this.logger.info('Campaign created', { clientId, campaignId: campaign.id, name: campaign.name });

    return campaign;
  }

  // Start a campaign
  startCampaign(campaignId) {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    campaign.status = 'active';
    campaign.startedAt = Date.now();

    // Add to active campaigns
    if (!this.activeCampaigns.has(campaign.clientId)) {
      this.activeCampaigns.set(campaign.clientId, []);
    }
    this.activeCampaigns.get(campaign.clientId).push(campaign);

    this.logger.info('Campaign started', { campaignId, clientId: campaign.clientId });
    this.auditLogger.logAuditEvent('campaign_started', campaign.clientId, { campaignId, name: campaign.name });

    return campaign;
  }

  // Stop a campaign
  stopCampaign(campaignId) {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    campaign.status = 'stopped';
    campaign.stoppedAt = Date.now();

    // Remove from active campaigns
    const clientCampaigns = this.activeCampaigns.get(campaign.clientId) || [];
    const index = clientCampaigns.findIndex(c => c.id === campaignId);
    if (index > -1) {
      clientCampaigns.splice(index, 1);
    }

    this.logger.info('Campaign stopped', { campaignId, clientId: campaign.clientId });
    this.auditLogger.logAuditEvent('campaign_stopped', campaign.clientId, { campaignId, name: campaign.name });

    return campaign;
  }

  // Get campaigns for client
  getClientCampaigns(clientId, status = null) {
    const allCampaigns = Array.from(this.campaigns.values())
      .filter(campaign => campaign.clientId === clientId);

    if (status) {
      return allCampaigns.filter(campaign => campaign.status === status);
    }

    return allCampaigns;
  }

  // Get campaign by ID
  getCampaign(campaignId) {
    return this.campaigns.get(campaignId) || null;
  }

  // Update campaign stats
  updateCampaignStats(campaignId, updates) {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) {
      return false;
    }

    Object.assign(campaign.stats, updates);
    campaign.lastUpdated = Date.now();

    this.logger.metric('Campaign stats updated', { campaignId, stats: campaign.stats });
    return true;
  }

  // Process campaign messages (called by automation system)
  async processCampaignMessage(clientId, message, context) {
    const activeCampaigns = this.activeCampaigns.get(clientId) || [];

    for (const campaign of activeCampaigns) {
      // Check if message matches campaign criteria
      if (this.matchesCampaignCriteria(campaign, message, context)) {
        await this.executeCampaignAction(campaign, message, context);
      }
    }
  }

  // Check if message matches campaign criteria
  matchesCampaignCriteria(campaign, message, context) {
    // Implement campaign matching logic based on campaign type
    switch (campaign.type) {
      case 'welcome_series':
        return message.body.toLowerCase().includes('hello') ||
               message.body.toLowerCase().includes('hi');

      case 'reengagement':
        // Check if user hasn't interacted in X days
        const lastInteraction = context.lastActivity || 0;
        const daysSinceInteraction = (Date.now() - lastInteraction) / (1000 * 60 * 60 * 24);
        return daysSinceInteraction > (campaign.criteria?.inactive_days || 30);

      case 'follow_up':
        return campaign.criteria?.keywords?.some(keyword =>
          message.body.toLowerCase().includes(keyword.toLowerCase())
        );

      default:
        return false;
    }
  }

  // Execute campaign action
  async executeCampaignAction(campaign, message, context) {
    // This would integrate with the message sending system
    // For now, just log the action
    this.logger.info('Campaign action triggered', {
      campaignId: campaign.id,
      clientId: campaign.clientId,
      action: campaign.action
    });

    this.auditLogger.logAutomationEvent(campaign.clientId, campaign.id, 'campaign_triggered', {
      recipient: message.from,
      campaignName: campaign.name
    });

    // Update campaign stats
    this.updateCampaignStats(campaign.id, { triggers: (campaign.stats.triggers || 0) + 1 });
  }

  // Get campaign analytics
  getCampaignAnalytics(clientId, campaignId = null) {
    let campaigns = this.getClientCampaigns(clientId);

    if (campaignId) {
      campaigns = campaigns.filter(c => c.id === campaignId);
    }

    const analytics = {
      totalCampaigns: campaigns.length,
      activeCampaigns: campaigns.filter(c => c.status === 'active').length,
      completedCampaigns: campaigns.filter(c => c.status === 'completed').length,
      totalMessages: campaigns.reduce((sum, c) => sum + (c.stats.sent || 0), 0),
      totalResponses: campaigns.reduce((sum, c) => sum + (c.stats.responses || 0), 0),
      campaigns: campaigns.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        stats: c.stats,
        createdAt: c.createdAt,
        startedAt: c.startedAt
      }))
    };

    return analytics;
  }

  // Clean up old campaigns
  cleanupOldCampaigns() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    for (const [campaignId, campaign] of this.campaigns.entries()) {
      // Remove campaigns older than 30 days that are completed/stopped
      if (campaign.createdAt < thirtyDaysAgo &&
          ['completed', 'stopped'].includes(campaign.status)) {
        this.campaigns.delete(campaignId);
        this.logger.info('Cleaned up old campaign', { campaignId });
      }
    }
  }
}

module.exports = {
  MessageTemplates,
  CampaignManager
};