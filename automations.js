const fs = require('fs');
const path = require('path');

// Automation templates for common CRM use cases
const automationTemplates = {
  lead_capture: {
    id: 'lead_capture',
    name: 'Lead Capture & Qualification',
    description: 'Automatically capture leads from WhatsApp messages and qualify them based on keywords',
    category: 'lead_management',
    triggers: ['message_received'],
    actions: ['extract_contact_info', 'score_lead', 'notify_sales_team', 'send_auto_response'],
    template: {
      keywords: ['interested', 'price', 'quote', 'buy', 'purchase'],
      auto_response: 'Thanks for your interest! Our sales team will contact you within 24 hours.',
      lead_scoring: {
        high: ['urgent', 'budget', 'decision maker'],
        medium: ['interested', 'price'],
        low: ['just browsing', 'info']
      }
    }
  },

  appointment_reminder: {
    id: 'appointment_reminder',
    name: 'Appointment Reminders',
    description: 'Send automated reminders for upcoming appointments',
    category: 'scheduling',
    triggers: ['scheduled_time'],
    actions: ['send_reminder_message', 'confirm_appointment', 'follow_up'],
    template: {
      reminder_times: [24, 2, 0.5], // hours before appointment
      messages: {
        '24h': 'Reminder: You have an appointment tomorrow at {time}. Reply CONFIRM to confirm.',
        '2h': 'Appointment reminder: See you in 2 hours at {time}.',
        '30min': 'Appointment in 30 minutes at {time}. We\'re looking forward to seeing you!'
      },
      confirmation_required: true
    }
  },

  payment_reminder: {
    id: 'payment_reminder',
    name: 'Payment Reminders & Links',
    description: 'Send payment reminders with integrated payment links',
    category: 'payments',
    triggers: ['invoice_created', 'payment_due', 'scheduled_time'],
    actions: ['send_payment_link', 'send_reminder', 'mark_overdue'],
    template: {
      reminder_schedule: [7, 3, 1, 0], // days before/after due date
      payment_methods: ['razorpay', 'stripe', 'upi'],
      messages: {
        '7d': 'Payment due in 7 days. Pay now: {payment_link}',
        '3d': 'Payment due in 3 days. Avoid late fees: {payment_link}',
        '1d': 'Payment due tomorrow. Pay now: {payment_link}',
        'overdue': 'Payment is overdue. Pay immediately: {payment_link}'
      }
    }
  },

  customer_support: {
    id: 'customer_support',
    name: 'Customer Support Triage',
    description: 'Automatically triage customer support requests and route to appropriate agents',
    category: 'support',
    triggers: ['message_received'],
    actions: ['categorize_issue', 'route_to_agent', 'send_acknowledgment'],
    template: {
      categories: {
        billing: ['payment', 'invoice', 'charge', 'refund', 'billing'],
        technical: ['error', 'bug', 'not working', 'login', 'password'],
        sales: ['pricing', 'features', 'demo', 'quote'],
        general: ['help', 'support', 'question']
      },
      auto_responses: {
        billing: 'Our billing team will assist you shortly. For urgent payment issues, call {phone}.',
        technical: 'Our technical support team will help resolve this. Expected response time: 2 hours.',
        sales: 'Our sales team will contact you within 1 business day.',
        general: 'Thank you for contacting us. We\'ll respond within 4 hours.'
      }
    }
  },

  order_updates: {
    id: 'order_updates',
    name: 'Order Status Updates',
    description: 'Send automated order status updates and delivery notifications',
    category: 'ecommerce',
    triggers: ['order_status_change', 'scheduled_time'],
    actions: ['send_status_update', 'send_tracking_info', 'request_feedback'],
    template: {
      statuses: ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
      messages: {
        confirmed: 'Order #{order_id} confirmed! Processing will begin shortly.',
        processing: 'Your order #{order_id} is now being processed.',
        shipped: 'Order #{order_id} shipped! Tracking: {tracking_link}',
        delivered: 'Order #{order_id} delivered successfully! Please rate your experience.',
        cancelled: 'Order #{order_id} has been cancelled. Refund will be processed within 5-7 days.'
      },
      feedback_request: 'How was your experience? Rate us 1-5 stars.'
    }
  },

  marketing_campaigns: {
    id: 'marketing_campaigns',
    name: 'Marketing Campaigns',
    description: 'Run targeted marketing campaigns with personalized messages',
    category: 'marketing',
    triggers: ['campaign_scheduled', 'segment_criteria'],
    actions: ['send_personalized_message', 'track_responses', 'follow_up'],
    template: {
      campaign_types: ['promotional', 'newsletter', 'reengagement', 'birthday'],
      personalization: ['name', 'last_purchase', 'segment', 'location'],
      templates: {
        promotional: 'Hi {name}! Exclusive offer just for you: {offer}. Limited time!',
        newsletter: 'Hi {name}, here\'s what\'s new this month: {content}',
        reengagement: 'Hi {name}, we miss you! Here\'s {discount}% off your next purchase.',
        birthday: 'Happy Birthday {name}! Enjoy {birthday_offer} as our gift to you!'
      },
      compliance: {
        opt_out_message: 'Reply STOP to unsubscribe',
        frequency_limit: 'max 4 messages per month'
      }
    }
  }
};

// Message templates for different industries
const messageTemplates = {
  real_estate: {
    inquiry_response: 'Thank you for your interest in {property_name}! I\'d be happy to schedule a viewing. What day works best for you?',
    price_discussion: 'The listed price is {price}. We can discuss financing options and current market conditions.',
    viewing_confirmation: 'Great! I\'ve scheduled your viewing of {property_name} for {date} at {time}. Address: {address}',
    offer_received: 'Thank you for your offer of {offer_amount} for {property_name}. I\'ll present this to the seller and get back to you within 24 hours.'
  },

  healthcare: {
    appointment_booking: 'Thank you for choosing us! Your appointment is confirmed for {date} at {time} with Dr. {doctor_name}.',
    prescription_reminder: 'Hi {patient_name}, it\'s time to refill your {medication} prescription. Would you like us to process this?',
    test_results: 'Your test results are ready. Please schedule an appointment to discuss them. Call {phone} to book.',
    follow_up: 'How are you feeling after your {procedure}? Please let us know if you need any assistance.'
  },

  retail: {
    order_confirmation: 'Order #{order_id} confirmed! Total: {total}. Expected delivery: {delivery_date}',
    shipping_update: 'Your order #{order_id} has been shipped! Track it here: {tracking_link}',
    return_request: 'We\'re sorry the item didn\'t meet your expectations. Please visit {return_center} for returns.',
    loyalty_offer: 'Thank you for being a valued customer! Here\'s {discount}% off your next purchase: {promo_code}'
  },

  education: {
    enrollment_confirmation: 'Welcome to {course_name}! Your enrollment is confirmed. Class starts {start_date}.',
    assignment_reminder: '{assignment_name} is due in {days_remaining} days. Need help? Contact your instructor.',
    grade_notification: 'Your grade for {assignment_name} is now available: {grade}. Feedback: {feedback}',
    exam_reminder: 'Exam reminder: {exam_name} is scheduled for {date} at {time}. Study materials: {link}'
  },

  hospitality: {
    booking_confirmation: 'Your reservation at {hotel_name} is confirmed! Check-in: {checkin_date}, Check-out: {checkout_date}',
    checkin_reminder: 'Check-in reminder: Your room at {hotel_name} is ready. Please arrive by {time}.',
    checkout_reminder: 'Checkout reminder: Please checkout by {time} tomorrow. Thank you for staying with us!',
    feedback_request: 'How was your stay at {hotel_name}? Please rate us 1-5 stars and share your feedback.'
  }
};

// Campaign templates
const campaignTemplates = {
  welcome_series: {
    name: 'Welcome Series',
    description: 'Onboard new customers with a 3-message welcome series',
    messages: [
      {
        delay: 0, // immediate
        message: 'Welcome to {business_name}! Thanks for choosing us. Reply HELP for assistance.'
      },
      {
        delay: 24 * 60 * 60 * 1000, // 1 day
        message: 'How are you finding our service so far? We\'re here to help with any questions.'
      },
      {
        delay: 7 * 24 * 60 * 60 * 1000, // 1 week
        message: 'It\'s been a week since you joined us! Here are some tips to get the most out of our service: {tips}'
      }
    ]
  },

  reengagement_campaign: {
    name: 'Reengagement Campaign',
    description: 'Win back inactive customers with special offers',
    target: 'inactive_30_days',
    messages: [
      {
        delay: 0,
        message: 'Hi {name}, we noticed you haven\'t visited us lately. We miss you! Here\'s a special offer just for you.'
      },
      {
        delay: 3 * 24 * 60 * 60 * 1000, // 3 days
        message: 'Still thinking about that offer? It expires soon. Don\'t miss out!'
      }
    ]
  },

  holiday_campaign: {
    name: 'Holiday Campaign',
    description: 'Seasonal greetings and offers',
    seasonal: true,
    messages: [
      {
        delay: 0,
        message: 'Happy Holidays from {business_name}! Wishing you joy and peace this season. 🎄'
      },
      {
        delay: 2 * 24 * 60 * 60 * 1000,
        message: 'Holiday Special: Get {discount}% off all services this week. Use code: HOLIDAY2025'
      }
    ]
  }
};

class AutomationMarketplace {
  constructor(logger) {
    this.logger = logger;
    this.activeAutomations = new Map();
    this.templates = {
      automations: automationTemplates,
      messages: messageTemplates,
      campaigns: campaignTemplates
    };
  }

  // Get all available templates
  getTemplates(category = null) {
    if (category) {
      return Object.values(this.templates[category] || {});
    }
    return this.templates;
  }

  // Get specific template
  getTemplate(type, id) {
    return this.templates[type]?.[id] || null;
  }

  // Activate automation for a client
  activateAutomation(clientId, automationId, config = {}) {
    const template = this.templates.automations[automationId];
    if (!template) {
      throw new Error(`Automation template ${automationId} not found`);
    }

    const automation = {
      id: `${clientId}_${automationId}_${Date.now()}`,
      clientId,
      templateId: automationId,
      config: { ...template.template, ...config },
      activatedAt: Date.now(),
      status: 'active',
      stats: {
        triggers: 0,
        actions: 0,
        lastTriggered: null
      }
    };

    this.activeAutomations.set(automation.id, automation);
    this.logger.info('Automation activated', { clientId, automationId, automationId: automation.id });

    return automation;
  }

  // Deactivate automation
  deactivateAutomation(automationId) {
    const automation = this.activeAutomations.get(automationId);
    if (automation) {
      automation.status = 'inactive';
      automation.deactivatedAt = Date.now();
      this.logger.info('Automation deactivated', { automationId });
      return true;
    }
    return false;
  }

  // Get client's active automations
  getClientAutomations(clientId) {
    return Array.from(this.activeAutomations.values())
      .filter(auto => auto.clientId === clientId && auto.status === 'active');
  }

  // Process message against automations
  async processMessage(clientId, message, context = {}) {
    const automations = this.getClientAutomations(clientId);
    const results = [];

    for (const automation of automations) {
      try {
        const result = await this.executeAutomation(automation, message, context);
        if (result.triggered) {
          results.push(result);
          automation.stats.triggers++;
          automation.stats.lastTriggered = Date.now();
        }
      } catch (error) {
        this.logger.error('Automation execution failed', {
          automationId: automation.id,
          error: error.message
        });
      }
    }

    return results;
  }

  // Execute automation logic
  async executeAutomation(automation, message, context) {
    const template = this.templates.automations[automation.templateId];
    const result = {
      automationId: automation.id,
      triggered: false,
      actions: []
    };

    // Check triggers
    for (const trigger of template.triggers) {
      switch (trigger) {
        case 'message_received':
          if (this.checkMessageTrigger(automation, message)) {
            result.triggered = true;
          }
          break;
        // Add other trigger types as needed
      }
    }

    // Execute actions if triggered
    if (result.triggered) {
      for (const action of template.actions) {
        try {
          const actionResult = await this.executeAction(automation, action, message, context);
          result.actions.push(actionResult);
          automation.stats.actions++;
        } catch (error) {
          this.logger.error('Action execution failed', {
            automationId: automation.id,
            action,
            error: error.message
          });
        }
      }
    }

    return result;
  }

  // Check if message triggers automation
  checkMessageTrigger(automation, message) {
    const config = automation.config;

    // Check keywords
    if (config.keywords) {
      const messageText = message.body.toLowerCase();
      return config.keywords.some(keyword =>
        messageText.includes(keyword.toLowerCase())
      );
    }

    return false;
  }

  // Execute automation action
  async executeAction(automation, action, message, context) {
    const config = automation.config;

    switch (action) {
      case 'send_auto_response':
        if (config.auto_response) {
          return {
            action: 'send_message',
            message: config.auto_response,
            to: message.from
          };
        }
        break;

      case 'extract_contact_info':
        return {
          action: 'extract_data',
          data: this.extractContactInfo(message)
        };

      case 'score_lead':
        return {
          action: 'score',
          score: this.scoreLead(message, config.lead_scoring)
        };

      default:
        return { action, status: 'not_implemented' };
    }
  }

  // Extract contact information from message
  extractContactInfo(message) {
    // Simple extraction - can be enhanced with NLP
    const text = message.body;
    const info = {
      name: null,
      phone: message.from,
      email: null,
      company: null
    };

    // Basic email extraction
    const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    if (emailMatch) {
      info.email = emailMatch[0];
    }

    return info;
  }

  // Score lead based on message content
  scoreLead(message, scoringConfig) {
    const text = message.body.toLowerCase();
    let score = 'low';

    // Check for high-value keywords
    if (scoringConfig.high.some(keyword => text.includes(keyword))) {
      score = 'high';
    } else if (scoringConfig.medium.some(keyword => text.includes(keyword))) {
      score = 'medium';
    }

    return score;
  }

  // Get automation statistics
  getAutomationStats(clientId = null) {
    let automations = Array.from(this.activeAutomations.values());

    if (clientId) {
      automations = automations.filter(auto => auto.clientId === clientId);
    }

    return automations.map(auto => ({
      id: auto.id,
      templateId: auto.templateId,
      status: auto.status,
      stats: auto.stats,
      activatedAt: auto.activatedAt
    }));
  }
}

module.exports = {
  AutomationMarketplace,
  automationTemplates,
  messageTemplates,
  campaignTemplates
};