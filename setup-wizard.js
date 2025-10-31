const fs = require('fs');
const path = require('path');

class SetupWizard {
  constructor(logger, clients, qrCodes, automationMarketplace) {
    this.logger = logger;
    this.clients = clients;
    this.qrCodes = qrCodes;
    this.automationMarketplace = automationMarketplace;
    this.setupSessions = new Map();
  }

  // Start setup wizard for a client
  startSetup(clientId, businessType = 'general') {
    const session = {
      clientId,
      step: 'welcome',
      businessType,
      completedSteps: [],
      data: {},
      startedAt: Date.now(),
      lastActivity: Date.now()
    };

    this.setupSessions.set(clientId, session);
    this.logger.info('Setup wizard started', { clientId, businessType });

    return {
      step: 'welcome',
      message: this.getWelcomeMessage(businessType),
      options: ['start_setup', 'skip_setup']
    };
  }

  // Process setup step
  processStep(clientId, userInput, userChoice = null) {
    const session = this.setupSessions.get(clientId);
    if (!session) {
      return { error: 'Setup session not found. Please start setup again.' };
    }

    session.lastActivity = Date.now();

    switch (session.step) {
      case 'welcome':
        return this.handleWelcome(session, userChoice);

      case 'business_info':
        return this.handleBusinessInfo(session, userInput);

      case 'whatsapp_setup':
        return this.handleWhatsAppSetup(session, userChoice);

      case 'automation_setup':
        return this.handleAutomationSetup(session, userChoice);

      case 'test_message':
        return this.handleTestMessage(session, userChoice);

      case 'complete':
        return this.handleComplete(session);

      default:
        return { error: 'Invalid setup step' };
    }
  }

  // Get current setup status
  getSetupStatus(clientId) {
    const session = this.setupSessions.get(clientId);
    if (!session) {
      return { active: false };
    }

    return {
      active: true,
      step: session.step,
      progress: this.calculateProgress(session),
      completedSteps: session.completedSteps,
      businessType: session.businessType
    };
  }

  // Calculate setup progress
  calculateProgress(session) {
    const totalSteps = 5;
    const completedSteps = session.completedSteps.length;
    return Math.round((completedSteps / totalSteps) * 100);
  }

  // Welcome step
  handleWelcome(session, choice) {
    if (choice === 'start_setup') {
      session.step = 'business_info';
      session.completedSteps.push('welcome');
      return {
        step: 'business_info',
        message: 'Great! Let\'s set up your WhatsApp integration. First, tell me about your business:\n\n1. 🏢 Real Estate\n2. 🏥 Healthcare/Medical\n3. 🛍️ Retail/E-commerce\n4. 📚 Education\n5. 🏨 Hospitality\n6. 💼 General Business\n\nReply with the number of your business type.',
        options: ['1', '2', '3', '4', '5', '6']
      };
    } else {
      session.step = 'complete';
      return {
        step: 'complete',
        message: 'Setup skipped. You can always start the setup later from your dashboard.',
        complete: true
      };
    }
  }

  // Business info step
  handleBusinessInfo(session, input) {
    const businessTypes = {
      '1': 'real_estate',
      '2': 'healthcare',
      '3': 'retail',
      '4': 'education',
      '5': 'hospitality',
      '6': 'general'
    };

    const businessType = businessTypes[input];
    if (!businessType) {
      return {
        step: 'business_info',
        message: 'Please select a valid option (1-6):',
        options: ['1', '2', '3', '4', '5', '6']
      };
    }

    session.businessType = businessType;
    session.data.businessType = businessType;
    session.step = 'whatsapp_setup';
    session.completedSteps.push('business_info');

    return {
      step: 'whatsapp_setup',
      message: `Perfect! Setting up for ${businessType.replace('_', ' ')} business.\n\nNow let's connect your WhatsApp. Click the button below to scan the QR code and connect your WhatsApp Business account.`,
      action: 'show_qr',
      options: ['qr_scanned', 'skip_qr']
    };
  }

  // WhatsApp setup step
  handleWhatsAppSetup(session, choice) {
    if (choice === 'qr_scanned') {
      // Check if client is actually connected
      const clientData = this.clients.get(session.clientId);
      if (clientData && clientData.status === 'connected') {
        session.step = 'automation_setup';
        session.completedSteps.push('whatsapp_setup');
        return {
          step: 'automation_setup',
          message: '✅ WhatsApp connected successfully!\n\nNow let\'s set up some useful automations for your business. These will help you respond faster and provide better customer service.',
          options: ['setup_automations', 'skip_automations']
        };
      } else {
        return {
          step: 'whatsapp_setup',
          message: 'Please scan the QR code first, then click "QR Scanned" to continue.',
          action: 'show_qr',
          options: ['qr_scanned', 'skip_qr']
        };
      }
    } else if (choice === 'skip_qr') {
      session.step = 'automation_setup';
      session.completedSteps.push('whatsapp_setup');
      return {
        step: 'automation_setup',
        message: 'WhatsApp setup skipped. You can connect it later from your dashboard.\n\nLet\'s set up some useful automations for your business.',
        options: ['setup_automations', 'skip_automations']
      };
    }
  }

  // Automation setup step
  handleAutomationSetup(session, choice) {
    if (choice === 'setup_automations') {
      // Activate recommended automations based on business type
      const recommendedAutomations = this.getRecommendedAutomations(session.businessType);

      for (const automationId of recommendedAutomations) {
        try {
          this.automationMarketplace.activateAutomation(session.clientId, automationId);
        } catch (error) {
          this.logger.error('Failed to activate recommended automation', {
            clientId: session.clientId,
            automationId,
            error: error.message
          });
        }
      }

      session.step = 'test_message';
      session.completedSteps.push('automation_setup');

      return {
        step: 'test_message',
        message: `✅ Automations activated!\n\nLet's test your setup by sending a test message. Click "Send Test" to send a message to yourself.`,
        options: ['send_test', 'skip_test']
      };
    } else {
      session.step = 'test_message';
      session.completedSteps.push('automation_setup');
      return {
        step: 'test_message',
        message: 'Automation setup skipped.\n\nLet\'s test your setup by sending a test message.',
        options: ['send_test', 'skip_test']
      };
    }
  }

  // Test message step
  handleTestMessage(session, choice) {
    if (choice === 'send_test') {
      session.step = 'complete';
      session.completedSteps.push('test_message');
      return {
        step: 'complete',
        message: '🎉 Setup complete! Your WhatsApp CRM is ready to use.\n\nYou can now:\n• Send messages from your dashboard\n• Set up additional automations\n• View analytics and reports\n\nWelcome to automated customer communication!',
        complete: true,
        action: 'send_test_message'
      };
    } else {
      session.step = 'complete';
      session.completedSteps.push('test_message');
      return {
        step: 'complete',
        message: '🎉 Setup complete! Your WhatsApp CRM is ready to use.\n\nYou can start sending messages and setting up automations from your dashboard.',
        complete: true
      };
    }
  }

  // Complete step
  handleComplete(session) {
    // Clean up session
    this.setupSessions.delete(session.clientId);

    return {
      step: 'complete',
      message: 'Setup is already complete. You can manage your settings from the dashboard.',
      complete: true
    };
  }

  // Get welcome message based on business type
  getWelcomeMessage(businessType) {
    const messages = {
      real_estate: '🏠 Welcome to WhatsApp CRM for Real Estate!\n\nI\'ll help you set up automated responses for property inquiries, schedule showings, and manage leads.',
      healthcare: '🏥 Welcome to WhatsApp CRM for Healthcare!\n\nI\'ll help you set up appointment reminders, prescription notifications, and patient communication.',
      retail: '🛍️ Welcome to WhatsApp CRM for Retail!\n\nI\'ll help you set up order updates, shipping notifications, and customer support.',
      education: '📚 Welcome to WhatsApp CRM for Education!\n\nI\'ll help you set up enrollment confirmations, assignment reminders, and student communication.',
      hospitality: '🏨 Welcome to WhatsApp CRM for Hospitality!\n\nI\'ll help you set up booking confirmations, check-in reminders, and guest services.',
      general: '💼 Welcome to WhatsApp CRM!\n\nI\'ll help you set up your business communication and automation.'
    };

    return messages[businessType] || messages.general;
  }

  // Get recommended automations based on business type
  getRecommendedAutomations(businessType) {
    const recommendations = {
      real_estate: ['lead_capture', 'appointment_reminder'],
      healthcare: ['appointment_reminder', 'customer_support'],
      retail: ['order_updates', 'payment_reminder'],
      education: ['appointment_reminder', 'customer_support'],
      hospitality: ['appointment_reminder', 'customer_support'],
      general: ['lead_capture', 'customer_support']
    };

    return recommendations[businessType] || recommendations.general;
  }

  // Clean up old sessions
  cleanupOldSessions() {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours

    for (const [clientId, session] of this.setupSessions.entries()) {
      if (session.lastActivity < cutoffTime) {
        this.setupSessions.delete(clientId);
        this.logger.info('Cleaned up old setup session', { clientId });
      }
    }
  }
}

module.exports = { SetupWizard };