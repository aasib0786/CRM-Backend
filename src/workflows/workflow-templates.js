/**
 * Pre-made Production Workflow Templates (Phase 4)
 * Real-estate & sales industry templates ready to deploy with 1-click.
 */

export const PREMADE_WORKFLOW_TEMPLATES = [
  {
    id: 'tpl_instant_welcome',
    name: 'New Lead Instant WhatsApp Welcome & Nurturing',
    description: 'Instantly greets new inquiries on WhatsApp, waits 2 hours, and sends project highlights if uncontacted.',
    category: 'Lead Capture & Greeting',
    trigger_type: 'lead_created',
    trigger_config: { sources: ['any'] },
    stop_on_reply: true,
    stop_on_agent_takeover: true,
    stop_on_stage_change: true,
    conditions: {
      all: [{ field: 'has_whatsapp_number', operator: 'equals', value: true }],
    },
    steps: [
      {
        id: 'step_1',
        type: 'send_whatsapp_text',
        title: 'Send Instant Welcome Message',
        config: {
          message: 'Hello {{lead.name}}! Thank you for inquiring about {{project.name}}. Our sales expert {{agent.name}} is reviewing your inquiry.',
          fallback_template: 'lead_welcome_v1',
        },
      },
      {
        id: 'step_2',
        type: 'wait',
        title: 'Wait 2 Hours',
        config: { duration: 2, unit: 'hours', respect_quiet_hours: true },
      },
      {
        id: 'step_3',
        type: 'if_else',
        title: 'Check if Still in New Inquiry Stage',
        config: {
          conditions: {
            all: [{ field: 'stage', operator: 'equals', value: 'New Inquiry' }],
          },
          then_step_id: 'step_4',
          else_step_id: 'step_end',
        },
      },
      {
        id: 'step_4',
        type: 'send_whatsapp_text',
        title: 'Send Project Brochure & Highlights',
        config: {
          message: 'Hi {{lead.name}}, here are the verified details and floor plans for {{project.name}}. Would you prefer a quick phone call or site visit this weekend?',
          fallback_template: 'project_brochure_v1',
        },
      },
      {
        id: 'step_end',
        type: 'end',
        title: 'End Flow',
      },
    ],
  },
  {
    id: 'tpl_3day_nurturing',
    name: '3-Day Multi-Touch Follow-up Sequence',
    description: 'Systematic multi-day WhatsApp + email follow-up ensuring no lead drops through the cracks.',
    category: 'Follow-up & Nurturing',
    trigger_type: 'lead_created',
    trigger_config: { sources: ['any'] },
    stop_on_reply: true,
    stop_on_agent_takeover: true,
    stop_on_stage_change: true,
    conditions: {
      all: [{ field: 'has_whatsapp_number', operator: 'equals', value: true }],
    },
    steps: [
      {
        id: 'step_1',
        type: 'send_whatsapp_text',
        title: 'Day 1: Instant Acknowledgment',
        config: {
          message: 'Hi {{lead.name}}, we received your inquiry regarding {{project.name}}. Senior Consultant {{agent.name}} has been assigned to assist you.',
          fallback_template: 'lead_welcome_v1',
        },
      },
      {
        id: 'step_2',
        type: 'wait',
        title: 'Wait 1 Day (24 Hours)',
        config: { duration: 24, unit: 'hours', respect_quiet_hours: true },
      },
      {
        id: 'step_3',
        type: 'send_email',
        title: 'Day 2: Send Detailed Email Overview',
        config: {
          subject: 'Information on {{project.name}} - Digi India CRM Pro',
          body: 'Dear {{lead.name}},\n\nFollowing up on your inquiry for {{project.name}}. We have attached the complete price list and unit availability.\n\nBest regards,\n{{agent.name}}\n{{company.name}}',
        },
      },
      {
        id: 'step_4',
        type: 'wait',
        title: 'Wait 2 Days (48 Hours)',
        config: { duration: 48, unit: 'hours', respect_quiet_hours: true },
      },
      {
        id: 'step_5',
        type: 'create_task',
        title: 'Day 3: Create Urgent Follow-up Call Task for Agent',
        config: {
          title: 'Direct Call Needed: {{lead.name}} (3-Day Inactive)',
          description: 'No response after 3-day WhatsApp and Email sequence. Call lead directly.',
          due_in_hours: 6,
        },
      },
      {
        id: 'step_6',
        type: 'end',
        title: 'Sequence Complete',
      },
    ],
  },
  {
    id: 'tpl_site_visit_reminder',
    name: 'Site Visit Confirmation & Directions Dispatch',
    description: 'Triggered when lead moves to "Site Visit". Sends directions, morning reminder, and post-visit follow-up.',
    category: 'Site Visits & Appointments',
    trigger_type: 'stage_changed',
    trigger_config: { to_stage: 'Site Visit' },
    stop_on_reply: false,
    stop_on_agent_takeover: false,
    stop_on_stage_change: true,
    conditions: {
      all: [{ field: 'has_whatsapp_number', operator: 'equals', value: true }],
    },
    steps: [
      {
        id: 'step_1',
        type: 'send_whatsapp_text',
        title: 'Send Site Visit Confirmation & Google Maps Link',
        config: {
          message: 'Congratulations {{lead.name}}! Your site visit for {{project.name}} has been scheduled. Our team will welcome you at the experience gallery.',
          fallback_template: 'site_visit_confirmed_v1',
        },
      },
      {
        id: 'step_2',
        type: 'notify_agent',
        title: 'Alert Assigned Sales Agent',
        config: {
          title: 'Site Visit Scheduled: {{lead.name}}',
          message: 'Lead {{lead.name}} moved to Site Visit stage for project {{project.name}}. Prepare the presentation kit.',
        },
      },
      {
        id: 'step_3',
        type: 'wait',
        title: 'Wait 24 Hours for Post-Visit Feedback',
        config: { duration: 24, unit: 'hours', respect_quiet_hours: true },
      },
      {
        id: 'step_4',
        type: 'send_whatsapp_text',
        title: 'Send Experience Feedback Message',
        config: {
          message: 'Hello {{lead.name}}, we hope you had a pleasant experience visiting {{project.name}}. Do you have any questions regarding the pricing or payment plans?',
          fallback_template: 'post_visit_followup_v1',
        },
      },
      {
        id: 'step_5',
        type: 'end',
        title: 'End Reminder Flow',
      },
    ],
  },
  {
    id: 'tpl_vip_hot_lead',
    name: 'High-Score VIP Buyer Fast Track',
    description: 'When lead score crosses 80+, tags lead as VIP, auto-assigns to senior sales executive, and triggers urgent notification.',
    category: 'Lead Scoring & Routing',
    trigger_type: 'score_crossed',
    trigger_config: { threshold: 80, direction: 'above' },
    stop_on_reply: false,
    stop_on_agent_takeover: false,
    stop_on_stage_change: false,
    conditions: {},
    steps: [
      {
        id: 'step_1',
        type: 'add_tag',
        title: 'Add VIP Hot Buyer Tag',
        config: { tag: 'VIP-Hot-Lead' },
      },
      {
        id: 'step_2',
        type: 'assign_agent',
        title: 'Round Robin to Senior Sales Team',
        config: { mode: 'round_robin' },
      },
      {
        id: 'step_3',
        type: 'notify_agent',
        title: 'Send High-Priority Agent Alert',
        config: {
          title: '🔥 High Priority VIP Lead: {{lead.name}} (Score: {{lead.score}})',
          message: 'Lead score crossed 80! Immediate 5-minute call response recommended for maximum conversion.',
        },
      },
      {
        id: 'step_4',
        type: 'send_whatsapp_text',
        title: 'Send VIP Dedicated Concierge Message',
        config: {
          message: 'Hello {{lead.name}}, thank you for your strong interest in {{project.name}}. Senior Consultant {{agent.name}} has been assigned as your dedicated concierge and will call you shortly.',
          fallback_template: 'vip_welcome_v1',
        },
      },
      {
        id: 'step_5',
        type: 'end',
        title: 'Fast Track Complete',
      },
    ],
  },
  {
    id: 'tpl_reengagement',
    name: 'Re-engagement for Cold / Inactive Leads',
    description: 'Re-activates dormant leads with special promotional incentives and clean stage re-categorization.',
    category: 'Re-engagement & Retention',
    trigger_type: 'stage_changed',
    trigger_config: { to_stage: 'Cold Lead' },
    stop_on_reply: true,
    stop_on_agent_takeover: true,
    stop_on_stage_change: true,
    conditions: {
      all: [{ field: 'has_whatsapp_number', operator: 'equals', value: true }],
    },
    steps: [
      {
        id: 'step_1',
        type: 'wait',
        title: 'Wait 7 Days Grace Period',
        config: { duration: 7, unit: 'days', respect_quiet_hours: true },
      },
      {
        id: 'step_2',
        type: 'send_whatsapp_template',
        title: 'Send Festive / Exclusive Incentive WhatsApp Template',
        config: {
          template_name: 'special_offer_reengagement',
          body_params: ['{{lead.name}}', '{{project.name}}'],
        },
      },
      {
        id: 'step_3',
        type: 'wait',
        title: 'Wait 3 Days for Customer Response',
        config: { duration: 3, unit: 'days', respect_quiet_hours: true },
      },
      {
        id: 'step_4',
        type: 'stop_bot',
        title: 'Pause AI Bot Conversation',
        config: {},
      },
      {
        id: 'step_5',
        type: 'end',
        title: 'Re-engagement Closed',
      },
    ],
  },
];
