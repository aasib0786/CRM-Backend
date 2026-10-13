-- ============================================================================
-- Migration: WhatsApp AI Sales Bot Database Schema
-- Tables: bot_settings, bot_conversations, bot_messages
-- ============================================================================

-- 1. Table: bot_settings (one row per company)
CREATE TABLE IF NOT EXISTS public.bot_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  is_active BOOLEAN DEFAULT false NOT NULL,
  display_name VARCHAR(100) DEFAULT 'Aria' NOT NULL,
  persona TEXT DEFAULT 'Senior Sales Consultant' NOT NULL,
  avatar_url TEXT,
  communication_style VARCHAR(50) DEFAULT 'professional' NOT NULL,
  primary_language VARCHAR(20) DEFAULT 'en' NOT NULL,
  greeting_template_name VARCHAR(100) DEFAULT 'sales_bot_greeting',
  active_sources JSONB DEFAULT '[]'::jsonb NOT NULL,
  qualification_questions JSONB DEFAULT '[
    {"id": "requirement", "question": "What kind of property or service are you looking for?", "required": true},
    {"id": "budget", "question": "What is your preferred budget range?", "required": true},
    {"id": "location", "question": "What is your preferred location?", "required": true},
    {"id": "timeline", "question": "When are you planning to make a decision?", "required": false}
  ]'::jsonb NOT NULL,
  handoff_keywords JSONB DEFAULT '["human", "agent", "executive", "representative", "call me", "talk to human", "manager", "connect"]'::jsonb NOT NULL,
  max_bot_turns INT DEFAULT 8 NOT NULL,
  working_hours JSONB DEFAULT '{
    "enabled": false,
    "timezone": "Asia/Kolkata",
    "start": "09:00",
    "end": "19:00",
    "days": [1, 2, 3, 4, 5, 6]
  }'::jsonb NOT NULL,
  out_of_hours_message TEXT DEFAULT 'Thank you for reaching out! Our team is currently offline. We have received your inquiry and our sales expert will connect with you during our working hours (9 AM - 7 PM).',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT uq_bot_settings_company UNIQUE (company_id),
  CONSTRAINT chk_bot_comm_style CHECK (communication_style IN ('friendly', 'professional', 'enthusiastic', 'concise')),
  CONSTRAINT chk_bot_primary_lang CHECK (primary_language IN ('en', 'hi', 'hinglish'))
);

-- 2. Table: bot_conversations (per lead bot conversation session)
CREATE TABLE IF NOT EXISTS public.bot_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'active' NOT NULL,
  turn_count INT DEFAULT 0 NOT NULL,
  collected_data JSONB DEFAULT '{}'::jsonb NOT NULL,
  last_user_message_at TIMESTAMPTZ,
  handed_off_at TIMESTAMPTZ,
  handoff_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT chk_bot_conv_status CHECK (status IN ('active', 'handed_off', 'paused', 'closed'))
);

-- 3. Table: bot_messages (inbound/outbound message log)
CREATE TABLE IF NOT EXISTS public.bot_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES public.bot_conversations(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  direction VARCHAR(20) NOT NULL,
  sender VARCHAR(20) NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text' NOT NULL,
  content TEXT,
  wa_message_id VARCHAR(255),
  tokens_used INT DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT chk_bot_msg_dir CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT chk_bot_msg_sender CHECK (sender IN ('bot', 'lead', 'agent')),
  CONSTRAINT chk_bot_msg_type CHECK (message_type IN ('template', 'text'))
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_bot_conv_comp_lead ON public.bot_conversations(company_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_bot_conv_comp_status ON public.bot_conversations(company_id, status);
CREATE INDEX IF NOT EXISTS idx_bot_msg_comp_conv ON public.bot_messages(company_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_bot_msg_comp_lead ON public.bot_messages(company_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_bot_msg_wa_id ON public.bot_messages(wa_message_id);
CREATE INDEX IF NOT EXISTS idx_bot_settings_comp ON public.bot_settings(company_id);

-- Seed default bot_settings for existing companies if not present
INSERT INTO public.bot_settings (company_id)
SELECT id FROM public.companies
ON CONFLICT (company_id) DO NOTHING;
