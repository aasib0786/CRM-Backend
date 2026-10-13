import "dotenv/config";
import connectDB from './pool.js';

export const initDb = async () => {
  try {
    console.log("⚡ Checking and initializing CRM Database Tables...");

    await connectDB.query(`
      CREATE TABLE IF NOT EXISTS public.activities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        user_name VARCHAR(150),
        lead_name VARCHAR(150),
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        metadata JSONB DEFAULT '{}'::jsonb
      );

      CREATE TABLE IF NOT EXISTS public.calls (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_name VARCHAR(150) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        direction VARCHAR(20) DEFAULT 'outbound',
        duration VARCHAR(20) DEFAULT '00:00',
        duration_seconds INT DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Completed',
        outcome VARCHAR(100) DEFAULT 'Connected',
        purpose VARCHAR(100) DEFAULT 'Follow-up',
        agent VARCHAR(150),
        recording_url TEXT,
        notes TEXT,
        user_id UUID,
        lead_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.scheduled_calls (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_name VARCHAR(150) NOT NULL,
        company VARCHAR(150),
        phone VARCHAR(50) NOT NULL,
        scheduled_time TIMESTAMPTZ NOT NULL,
        purpose VARCHAR(100) DEFAULT 'Follow-up',
        agent VARCHAR(150),
        notes TEXT,
        status VARCHAR(50) DEFAULT 'Scheduled',
        lead_id UUID,
        user_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.whatsapp_chats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_name VARCHAR(150) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        avatar TEXT,
        unread_count INT DEFAULT 0,
        last_message TEXT,
        last_message_time TIMESTAMPTZ DEFAULT NOW(),
        channel VARCHAR(50) DEFAULT 'WhatsApp',
        status VARCHAR(50) DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_id UUID REFERENCES public.whatsapp_chats(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        sender VARCHAR(20) DEFAULT 'me',
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        status VARCHAR(20) DEFAULT 'sent',
        media_url TEXT,
        media_type VARCHAR(50),
        wamid TEXT
      );

      CREATE TABLE IF NOT EXISTS public.campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(200) NOT NULL,
        type VARCHAR(50) DEFAULT 'Email',
        channel VARCHAR(50) DEFAULT 'Email',
        status VARCHAR(50) DEFAULT 'Draft',
        target_audience VARCHAR(100) DEFAULT 'All Leads',
        leads_count INT DEFAULT 0,
        sent_count INT DEFAULT 0,
        open_rate NUMERIC(5, 2) DEFAULT 0.00,
        click_rate NUMERIC(5, 2) DEFAULT 0.00,
        conversion_rate NUMERIC(5, 2) DEFAULT 0.00,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        scheduled_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS public.campaign_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
        total_sent INT DEFAULT 0,
        delivered INT DEFAULT 0,
        opened INT DEFAULT 0,
        clicked INT DEFAULT 0,
        unsubscribed INT DEFAULT 0,
        bounced INT DEFAULT 0,
        cost NUMERIC(12, 2) DEFAULT 0.00,
        revenue NUMERIC(12, 2) DEFAULT 0.00
      );

      CREATE TABLE IF NOT EXISTS public.quotations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_number VARCHAR(100) NOT NULL UNIQUE,
        client_name VARCHAR(200) NOT NULL,
        client_email VARCHAR(200),
        total_amount NUMERIC(12, 2) DEFAULT 0.00,
        discount NUMERIC(12, 2) DEFAULT 0.00,
        tax NUMERIC(12, 2) DEFAULT 0.00,
        status VARCHAR(50) DEFAULT 'Draft',
        valid_until DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        items JSONB DEFAULT '[]'::jsonb
      );

      CREATE TABLE IF NOT EXISTS public.integration_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR(100) DEFAULT 'default',
        provider VARCHAR(30) NOT NULL,
        account_name VARCHAR(150) NOT NULL,
        webhook_key VARCHAR(64) UNIQUE NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        allowed_domains TEXT[] DEFAULT '{}',
        last_received_at TIMESTAMPTZ,
        created_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_int_acc_company ON public.integration_accounts(company_id, provider);
      CREATE INDEX IF NOT EXISTS idx_int_acc_webhook_key ON public.integration_accounts(webhook_key);

      CREATE TABLE IF NOT EXISTS public.notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type VARCHAR(50) DEFAULT 'general',
        title VARCHAR(255) NOT NULL,
        description TEXT,
        lead_id UUID,
        lead_name VARCHAR(150),
        read BOOLEAN DEFAULT false,
        scheduled_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company_id VARCHAR(100) DEFAULT 'default';
      ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS activity_id VARCHAR(100);
    `);

    // Fix legacy column types if present
    await connectDB.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      ALTER TABLE IF EXISTS public.project_inventory DROP CONSTRAINT IF EXISTS project_inventory_project_id_fkey;
      ALTER TABLE IF EXISTS public.project_tasks DROP CONSTRAINT IF EXISTS project_tasks_project_id_fkey;
      ALTER TABLE IF EXISTS public.lead_activities DROP CONSTRAINT IF EXISTS lead_activities_lead_id_fkey;

      DO $$
      BEGIN
        -- 1. projects.id & selling_type_id (ensure native UUID)
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'projects' AND column_name = 'id' AND data_type != 'uuid'
        ) THEN
          UPDATE public.projects SET id = gen_random_uuid() WHERE id IS NULL OR id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
          ALTER TABLE public.projects ALTER COLUMN id DROP DEFAULT;
          ALTER TABLE public.projects ALTER COLUMN id TYPE UUID USING id::uuid;
          ALTER TABLE public.projects ALTER COLUMN id SET DEFAULT gen_random_uuid();
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'projects' AND column_name = 'selling_type_id' AND data_type != 'uuid'
        ) THEN
          UPDATE public.projects SET selling_type_id = NULL WHERE selling_type_id IS NOT NULL AND selling_type_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
          ALTER TABLE public.projects ALTER COLUMN selling_type_id DROP DEFAULT;
          ALTER TABLE public.projects ALTER COLUMN selling_type_id TYPE UUID USING (CASE WHEN selling_type_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN selling_type_id::uuid ELSE NULL END);
        END IF;

        -- 2. selling_types.id (ensure native UUID)
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'selling_types' AND column_name = 'id' AND data_type != 'uuid'
        ) THEN
          UPDATE public.selling_types SET id = gen_random_uuid() WHERE id IS NULL OR id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
          ALTER TABLE public.selling_types ALTER COLUMN id DROP DEFAULT;
          ALTER TABLE public.selling_types ALTER COLUMN id TYPE UUID USING id::uuid;
          ALTER TABLE public.selling_types ALTER COLUMN id SET DEFAULT gen_random_uuid();
        END IF;

        -- 3. inventory_fields.id (ensure native UUID)
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'inventory_fields' AND column_name = 'id' AND data_type != 'uuid'
        ) THEN
          UPDATE public.inventory_fields SET id = gen_random_uuid() WHERE id IS NULL OR id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
          ALTER TABLE public.inventory_fields ALTER COLUMN id DROP DEFAULT;
          ALTER TABLE public.inventory_fields ALTER COLUMN id TYPE UUID USING id::uuid;
          ALTER TABLE public.inventory_fields ALTER COLUMN id SET DEFAULT gen_random_uuid();
        END IF;

        -- 4. project_inventory.id & project_id (ensure native UUID)
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'project_inventory' AND column_name = 'id' AND data_type != 'uuid'
        ) THEN
          UPDATE public.project_inventory SET id = gen_random_uuid() WHERE id IS NULL OR id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
          ALTER TABLE public.project_inventory ALTER COLUMN id DROP DEFAULT;
          ALTER TABLE public.project_inventory ALTER COLUMN id TYPE UUID USING id::uuid;
          ALTER TABLE public.project_inventory ALTER COLUMN id SET DEFAULT gen_random_uuid();
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'project_inventory' AND column_name = 'project_id' AND data_type != 'uuid'
        ) THEN
          UPDATE public.project_inventory SET project_id = NULL WHERE project_id IS NOT NULL AND project_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
          ALTER TABLE public.project_inventory ALTER COLUMN project_id DROP DEFAULT;
          ALTER TABLE public.project_inventory ALTER COLUMN project_id TYPE UUID USING (CASE WHEN project_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN project_id::uuid ELSE NULL END);
        END IF;

        -- 5. project_tasks.project_id (ensure native UUID)
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'project_tasks' AND column_name = 'project_id' AND data_type != 'uuid'
        ) THEN
          UPDATE public.project_tasks SET project_id = NULL WHERE project_id IS NOT NULL AND project_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
          ALTER TABLE public.project_tasks ALTER COLUMN project_id DROP DEFAULT;
          ALTER TABLE public.project_tasks ALTER COLUMN project_id TYPE UUID USING (CASE WHEN project_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN project_id::uuid ELSE NULL END);
        END IF;

        -- 6. custom_industry_templates.id & industry_templates.id (ensure VARCHAR(100))
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'custom_industry_templates' AND column_name = 'id' AND data_type = 'uuid'
        ) THEN
          ALTER TABLE public.custom_industry_templates ALTER COLUMN id TYPE VARCHAR(100) USING id::text;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'industry_templates' AND column_name = 'id' AND data_type = 'uuid'
        ) THEN
          ALTER TABLE public.industry_templates ALTER COLUMN id TYPE VARCHAR(100) USING id::text;
        END IF;

        -- 7. inventory_fields column rename & additions
        IF EXISTS (
          SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_fields'
        ) THEN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'inventory_fields' AND column_name = 'order'
          ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'inventory_fields' AND column_name = 'sort_order'
          ) THEN
            ALTER TABLE public.inventory_fields RENAME COLUMN "order" TO sort_order;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'inventory_fields' AND column_name = 'sort_order'
          ) THEN
            ALTER TABLE public.inventory_fields ADD COLUMN sort_order BIGINT DEFAULT 1;
          ELSE
            ALTER TABLE public.inventory_fields ALTER COLUMN sort_order TYPE BIGINT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'inventory_fields' AND column_name = 'created_at'
          ) THEN
            ALTER TABLE public.inventory_fields ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'inventory_fields' AND column_name = 'updated_at'
          ) THEN
            ALTER TABLE public.inventory_fields ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
          END IF;

          -- Clean up any existing duplicates
          DELETE FROM public.inventory_fields WHERE id::text NOT IN (
            SELECT MIN(id::text) FROM public.inventory_fields GROUP BY LOWER(TRIM(label))
          );
        END IF;

        -- 8. leads.id & related foreign keys (convert integer to UUID)
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'leads' AND column_name = 'id' AND data_type != 'uuid'
        ) THEN
          CREATE EXTENSION IF NOT EXISTS "pgcrypto";
          CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

          -- a. Add temporary new_id UUID column to leads and populate with UUIDs
          ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS new_id UUID DEFAULT gen_random_uuid();
          UPDATE public.leads SET new_id = gen_random_uuid() WHERE new_id IS NULL;

          -- b. Add new_lead_id to lead_activities and map to new_id
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_activities') THEN
            ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS new_lead_id UUID;
            UPDATE public.lead_activities la 
            SET new_lead_id = l.new_id 
            FROM public.leads l 
            WHERE la.lead_id::text = l.id::text;
            
            ALTER TABLE public.lead_activities DROP CONSTRAINT IF EXISTS lead_activities_lead_id_fkey;
            ALTER TABLE public.lead_activities DROP COLUMN IF EXISTS lead_id;
            ALTER TABLE public.lead_activities RENAME COLUMN new_lead_id TO lead_id;
          END IF;

          -- c. Add new_lead_id to notifications and map to new_id
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
            ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS new_lead_id UUID;
            UPDATE public.notifications n 
            SET new_lead_id = l.new_id 
            FROM public.leads l 
            WHERE n.lead_id::text = l.id::text;

            ALTER TABLE public.notifications DROP COLUMN IF EXISTS lead_id;
            ALTER TABLE public.notifications RENAME COLUMN new_lead_id TO lead_id;
          END IF;

          -- d. Update text/UUID lead_id references in other tables
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'whatsapp_chats') THEN
            UPDATE public.whatsapp_chats c 
            SET lead_id = l.new_id::text 
            FROM public.leads l 
            WHERE c.lead_id = l.id::text;
          END IF;

          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'quotations') THEN
            UPDATE public.quotations q 
            SET lead_id = l.new_id::text 
            FROM public.leads l 
            WHERE q.lead_id = l.id::text;
          END IF;

          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activities') THEN
            UPDATE public.activities a 
            SET lead_id = l.new_id::text 
            FROM public.leads l 
            WHERE a.lead_id = l.id::text;
          END IF;

          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'projects') THEN
            UPDATE public.projects p 
            SET lead_id = l.new_id 
            FROM public.leads l 
            WHERE p.lead_id::text = l.id::text;
          END IF;

          -- e. Drop old id and promote new_id to primary key
          ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_pkey CASCADE;
          ALTER TABLE public.leads DROP COLUMN id;
          ALTER TABLE public.leads RENAME COLUMN new_id TO id;
          ALTER TABLE public.leads ADD PRIMARY KEY (id);
          ALTER TABLE public.leads ALTER COLUMN id SET DEFAULT gen_random_uuid();

          -- f. Re-link foreign key on lead_activities
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_activities') THEN
            ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
          END IF;
        END IF;

        -- Ensure lead_activities.lead_id is UUID
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'lead_activities' AND column_name = 'lead_id' AND data_type != 'uuid'
        ) THEN
          ALTER TABLE public.lead_activities DROP CONSTRAINT IF EXISTS lead_activities_lead_id_fkey;
          ALTER TABLE public.lead_activities ALTER COLUMN lead_id TYPE UUID USING (
            CASE WHEN lead_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
                 THEN lead_id::text::uuid 
                 ELSE NULL END
          );
          ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
        END IF;

        -- Ensure notifications.lead_id is UUID
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'notifications' AND column_name = 'lead_id' AND data_type != 'uuid'
        ) THEN
          ALTER TABLE public.notifications ALTER COLUMN lead_id TYPE UUID USING (
            CASE WHEN lead_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
                 THEN lead_id::text::uuid 
                 ELSE NULL END
          );
        END IF;
      END $$;

      -- Re-add foreign key constraints
      ALTER TABLE IF EXISTS public.project_inventory ADD CONSTRAINT project_inventory_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
      ALTER TABLE IF EXISTS public.project_tasks ADD CONSTRAINT project_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

      -- Ensure all columns exist on projects
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'properties';
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS selling_type_id UUID;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Active';
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS color VARCHAR(50) DEFAULT 'indigo';
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS leads INT DEFAULT 0;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS interested INT DEFAULT 0;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS booked INT DEFAULT 0;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS progress INT DEFAULT 0;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS budget NUMERIC(12, 2) DEFAULT 0.00;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS spent NUMERIC(12, 2) DEFAULT 0.00;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS client_name VARCHAR(200);
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS lead_id UUID;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS start_date DATE;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS due_date DATE;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS team_members JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS documents JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS tasks_count INT DEFAULT 0;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS completed_tasks INT DEFAULT 0;
      ALTER TABLE IF EXISTS public.projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

      -- Ensure all columns exist on selling_types
      ALTER TABLE IF EXISTS public.selling_types ADD COLUMN IF NOT EXISTS name VARCHAR(200);
      ALTER TABLE IF EXISTS public.selling_types ADD COLUMN IF NOT EXISTS color VARCHAR(50) DEFAULT 'indigo';
      ALTER TABLE IF EXISTS public.selling_types ADD COLUMN IF NOT EXISTS inventory_field_ids JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE IF EXISTS public.selling_types ADD COLUMN IF NOT EXISTS track_inventory BOOLEAN DEFAULT true;
      ALTER TABLE IF EXISTS public.selling_types ADD COLUMN IF NOT EXISTS item_label VARCHAR(100) DEFAULT 'Unit';
      ALTER TABLE IF EXISTS public.selling_types ADD COLUMN IF NOT EXISTS identifier_field VARCHAR(100) DEFAULT 'Unit Number';
      ALTER TABLE IF EXISTS public.selling_types ADD COLUMN IF NOT EXISTS available_status VARCHAR(100) DEFAULT 'Available';
      ALTER TABLE IF EXISTS public.selling_types ADD COLUMN IF NOT EXISTS sold_status VARCHAR(100) DEFAULT 'Sold';
      ALTER TABLE IF EXISTS public.selling_types ADD COLUMN IF NOT EXISTS progress_label VARCHAR(100) DEFAULT 'Units sold';
      ALTER TABLE IF EXISTS public.selling_types ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

      -- Ensure all columns exist on leads
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS name VARCHAR(200);
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS company VARCHAR(200);
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS email VARCHAR(200);
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS source VARCHAR(100) DEFAULT 'Manual';
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS stage VARCHAR(100) DEFAULT 'New Inquiry';
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS priority VARCHAR(50) DEFAULT 'Medium';
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS assigned VARCHAR(150);
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS industry VARCHAR(100);
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS value VARCHAR(100) DEFAULT '₹0';
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS score INT DEFAULT 50;
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS score_factors JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS project_id VARCHAR(100);
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS extra_fields JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

      -- Ensure company, phone, email allow NULL or default to empty string
      ALTER TABLE IF EXISTS public.leads ALTER COLUMN company DROP NOT NULL;
      ALTER TABLE IF EXISTS public.leads ALTER COLUMN company SET DEFAULT '';
      ALTER TABLE IF EXISTS public.leads ALTER COLUMN phone DROP NOT NULL;
      ALTER TABLE IF EXISTS public.leads ALTER COLUMN phone SET DEFAULT '';
      ALTER TABLE IF EXISTS public.leads ALTER COLUMN email DROP NOT NULL;
      ALTER TABLE IF EXISTS public.leads ALTER COLUMN email SET DEFAULT '';

      -- Ensure all columns exist on activities
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS type VARCHAR(100) DEFAULT 'note';
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS title VARCHAR(255) DEFAULT '';
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS user_name VARCHAR(150) DEFAULT 'System';
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS user_initials VARCHAR(10) DEFAULT 'SY';
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS action VARCHAR(150) DEFAULT '';
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS lead_name VARCHAR(255) DEFAULT '';
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS lead_id VARCHAR(100);
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS detail TEXT DEFAULT '';
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS time_block VARCHAR(50) DEFAULT 'Morning';
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

      -- Ensure all columns exist on calls
      ALTER TABLE IF EXISTS public.calls ADD COLUMN IF NOT EXISTS agent VARCHAR(150);
      ALTER TABLE IF EXISTS public.calls ADD COLUMN IF NOT EXISTS purpose VARCHAR(100) DEFAULT 'Follow-up';
      ALTER TABLE IF EXISTS public.calls ADD COLUMN IF NOT EXISTS duration_seconds INT DEFAULT 0;

      -- Ensure all columns exist on pipeline_stages
      ALTER TABLE IF EXISTS public.pipeline_stages ADD COLUMN IF NOT EXISTS name VARCHAR(200);
      ALTER TABLE IF EXISTS public.pipeline_stages ADD COLUMN IF NOT EXISTS color VARCHAR(50) DEFAULT 'bg-gray-400';
      ALTER TABLE IF EXISTS public.pipeline_stages ADD COLUMN IF NOT EXISTS required BOOLEAN DEFAULT false;
      ALTER TABLE IF EXISTS public.pipeline_stages ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 1;
      ALTER TABLE IF EXISTS public.pipeline_stages ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
      ALTER TABLE IF EXISTS public.pipeline_stages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE IF EXISTS public.pipeline_stages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

      -- Ensure all columns exist on custom_fields
      ALTER TABLE IF EXISTS public.custom_fields ADD COLUMN IF NOT EXISTS label VARCHAR(200);
      ALTER TABLE IF EXISTS public.custom_fields ADD COLUMN IF NOT EXISTS type VARCHAR(100) DEFAULT 'Text Input';
      ALTER TABLE IF EXISTS public.custom_fields ADD COLUMN IF NOT EXISTS required BOOLEAN DEFAULT false;
      ALTER TABLE IF EXISTS public.custom_fields ADD COLUMN IF NOT EXISTS show_in_list BOOLEAN DEFAULT false;
      ALTER TABLE IF EXISTS public.custom_fields ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
      ALTER TABLE IF EXISTS public.custom_fields ADD COLUMN IF NOT EXISTS options JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE IF EXISTS public.custom_fields ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'lead';
      ALTER TABLE IF EXISTS public.custom_fields ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 1;
      ALTER TABLE IF EXISTS public.custom_fields ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE IF EXISTS public.custom_fields ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

      -- Ensure all columns exist on lead_sources
      ALTER TABLE IF EXISTS public.lead_sources ADD COLUMN IF NOT EXISTS name VARCHAR(200);
      ALTER TABLE IF EXISTS public.lead_sources ADD COLUMN IF NOT EXISTS color VARCHAR(50) DEFAULT '#64748b';
      ALTER TABLE IF EXISTS public.lead_sources ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
      ALTER TABLE IF EXISTS public.lead_sources ADD COLUMN IF NOT EXISTS priority VARCHAR(50) DEFAULT 'Low';
      ALTER TABLE IF EXISTS public.lead_sources ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 1;
      ALTER TABLE IF EXISTS public.lead_sources ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE IF EXISTS public.lead_sources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

      -- Ensure all columns exist on quotations
      ALTER TABLE IF EXISTS public.quotations ADD COLUMN IF NOT EXISTS lead_id VARCHAR(100);
      ALTER TABLE IF EXISTS public.quotations ADD COLUMN IF NOT EXISTS client_company VARCHAR(200);
      ALTER TABLE IF EXISTS public.quotations ADD COLUMN IF NOT EXISTS client_phone VARCHAR(100);
      ALTER TABLE IF EXISTS public.quotations ADD COLUMN IF NOT EXISTS agent VARCHAR(150);
      ALTER TABLE IF EXISTS public.quotations ADD COLUMN IF NOT EXISTS terms TEXT DEFAULT '';
      ALTER TABLE IF EXISTS public.quotations ADD COLUMN IF NOT EXISTS quote_date DATE DEFAULT CURRENT_DATE;
      ALTER TABLE IF EXISTS public.quotations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

      -- Quotation Templates table
      CREATE TABLE IF NOT EXISTS public.quotation_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        description TEXT DEFAULT '',
        created_by VARCHAR(150) DEFAULT 'Admin',
        items JSONB DEFAULT '[]'::jsonb,
        item_count INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Ensure all columns exist on whatsapp_chats
      ALTER TABLE IF EXISTS public.whatsapp_chats ADD COLUMN IF NOT EXISTS assigned_agent VARCHAR(150);
      ALTER TABLE IF EXISTS public.whatsapp_chats ADD COLUMN IF NOT EXISTS assigned_agent_id VARCHAR(100);
      ALTER TABLE IF EXISTS public.whatsapp_chats ADD COLUMN IF NOT EXISTS stage VARCHAR(100) DEFAULT 'New Inquiry';
      ALTER TABLE IF EXISTS public.whatsapp_chats ADD COLUMN IF NOT EXISTS lead_id VARCHAR(100);
      ALTER TABLE IF EXISTS public.whatsapp_chats ADD COLUMN IF NOT EXISTS deal_value VARCHAR(100) DEFAULT '₹0';
      ALTER TABLE IF EXISTS public.whatsapp_chats ADD COLUMN IF NOT EXISTS assignment_history JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE IF EXISTS public.whatsapp_chats ADD COLUMN IF NOT EXISTS reassign_reason TEXT;
      ALTER TABLE IF EXISTS public.whatsapp_chats ADD COLUMN IF NOT EXISTS reassigned_from VARCHAR(150);
      ALTER TABLE IF EXISTS public.whatsapp_chats ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE IF EXISTS public.whatsapp_chats ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;

      -- Ensure all columns exist on whatsapp_messages
      ALTER TABLE IF EXISTS public.whatsapp_messages ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT true;
      ALTER TABLE IF EXISTS public.whatsapp_messages ADD COLUMN IF NOT EXISTS sender_name VARCHAR(150);
      ALTER TABLE IF EXISTS public.whatsapp_messages ADD COLUMN IF NOT EXISTS wamid TEXT;
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_wamid ON public.whatsapp_messages(wamid);

      CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        category VARCHAR(100) DEFAULT 'Marketing',
        language VARCHAR(50) DEFAULT 'en',
        status VARCHAR(50) DEFAULT 'Approved',
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.whatsapp_quick_replies (
        id SERIAL PRIMARY KEY,
        shortcut VARCHAR(100) NOT NULL,
        title VARCHAR(150) NOT NULL,
        message TEXT NOT NULL,
        category VARCHAR(100) DEFAULT 'General',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Ensure all columns exist on activities
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS user_initials VARCHAR(10);
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS action VARCHAR(150);
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS lead_name VARCHAR(150);
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS lead_id VARCHAR(100);
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS detail TEXT;
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS time_block VARCHAR(50);
      ALTER TABLE IF EXISTS public.activities ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
    `);

    await connectDB.query(`
      CREATE TABLE IF NOT EXISTS public.projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(200) NOT NULL,
        category VARCHAR(100) DEFAULT 'properties',
        selling_type_id UUID,
        status VARCHAR(50) DEFAULT 'Active',
        color VARCHAR(50) DEFAULT 'indigo',
        description TEXT,
        leads INT DEFAULT 0,
        interested INT DEFAULT 0,
        booked INT DEFAULT 0,
        progress INT DEFAULT 0,
        budget NUMERIC(12, 2) DEFAULT 0.00,
        spent NUMERIC(12, 2) DEFAULT 0.00,
        client_name VARCHAR(200),
        lead_id UUID,
        custom_fields JSONB DEFAULT '{}'::jsonb,
        start_date DATE,
        due_date DATE,
        team_members JSONB DEFAULT '[]'::jsonb,
        tasks_count INT DEFAULT 0,
        completed_tasks INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.project_inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.selling_types (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(200) NOT NULL,
        color VARCHAR(50) DEFAULT 'indigo',
        inventory_field_ids JSONB DEFAULT '[]'::jsonb,
        track_inventory BOOLEAN DEFAULT true,
        item_label VARCHAR(100) DEFAULT 'Unit',
        identifier_field VARCHAR(100) DEFAULT 'Unit Number',
        available_status VARCHAR(100) DEFAULT 'Available',
        sold_status VARCHAR(100) DEFAULT 'Sold',
        progress_label VARCHAR(100) DEFAULT 'Units sold',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.inventory_fields (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        label VARCHAR(200) NOT NULL,
        field_key VARCHAR(100) NOT NULL,
        type VARCHAR(100) DEFAULT 'Text Input',
        required BOOLEAN DEFAULT false,
        show_in_list BOOLEAN DEFAULT true,
        show_in_form BOOLEAN DEFAULT true,
        active BOOLEAN DEFAULT true,
        options JSONB DEFAULT '[]'::jsonb,
        sort_order INT DEFAULT 1,
        placeholder VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.project_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        status VARCHAR(50) DEFAULT 'To Do',
        priority VARCHAR(50) DEFAULT 'Medium',
        assigned_to VARCHAR(150),
        due_date DATE
      );

      CREATE TABLE IF NOT EXISTS public.lead_capture_forms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(200) NOT NULL,
        description TEXT,
        fields JSONB DEFAULT '[]'::jsonb,
        submissions_count INT DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Active',
        redirect_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE IF EXISTS public.lead_capture_forms ADD COLUMN IF NOT EXISTS submit_button_text VARCHAR(100) DEFAULT 'Submit Inquiry';
      ALTER TABLE IF EXISTS public.lead_capture_forms ADD COLUMN IF NOT EXISTS success_message TEXT DEFAULT 'Thank you! We''ll contact you shortly.';
      ALTER TABLE IF EXISTS public.lead_capture_forms ADD COLUMN IF NOT EXISTS privacy_policy_checkbox BOOLEAN DEFAULT true;
      ALTER TABLE IF EXISTS public.lead_capture_forms ADD COLUMN IF NOT EXISTS project_id UUID;

      CREATE TABLE IF NOT EXISTS public.lead_capture_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form_id UUID REFERENCES public.lead_capture_forms(id) ON DELETE CASCADE,
        form_title VARCHAR(200),
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        status VARCHAR(50) DEFAULT 'New',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.integrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(150) NOT NULL,
        category VARCHAR(100),
        status VARCHAR(50) DEFAULT 'Disconnected',
        icon VARCHAR(100),
        description TEXT,
        config JSONB DEFAULT '{}'::jsonb,
        connected_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS public.workflows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(200) NOT NULL,
        description TEXT,
        trigger_type VARCHAR(100),
        actions JSONB DEFAULT '[]'::jsonb,
        is_active BOOLEAN DEFAULT true,
        last_run TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.ai_bot_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bot_name VARCHAR(100) DEFAULT 'AI Assistant',
        tone VARCHAR(50) DEFAULT 'Professional',
        system_prompt TEXT,
        auto_reply_enabled BOOLEAN DEFAULT true,
        transfer_to_human BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.knowledge_base (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(250) NOT NULL,
        category VARCHAR(100) DEFAULT 'General',
        content TEXT NOT NULL,
        tags JSONB DEFAULT '[]'::jsonb,
        status VARCHAR(50) DEFAULT 'Published',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.teams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(150) NOT NULL,
        leader_id UUID,
        leader_name VARCHAR(150),
        member_ids JSONB DEFAULT '[]'::jsonb,
        member_names JSONB DEFAULT '[]'::jsonb,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(200) NOT NULL,
        company VARCHAR(200),
        phone VARCHAR(50),
        email VARCHAR(200),
        source VARCHAR(100) DEFAULT 'Manual',
        stage VARCHAR(100) DEFAULT 'New Inquiry',
        priority VARCHAR(50) DEFAULT 'Medium',
        assigned VARCHAR(150),
        industry VARCHAR(100),
        value VARCHAR(100) DEFAULT '₹0',
        score INT DEFAULT 50,
        score_factors JSONB DEFAULT '[]'::jsonb,
        tags JSONB DEFAULT '[]'::jsonb,
        notes TEXT,
        last_activity TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.lead_activities (
        id SERIAL PRIMARY KEY,
        lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
        type VARCHAR(100) NOT NULL,
        description TEXT,
        performed_by VARCHAR(150),
        activity_date DATE,
        activity_time VARCHAR(50),
        scheduled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS next_activity_at TIMESTAMPTZ;
      ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS scheduled_activity_type VARCHAR(100);

      ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS activity_date DATE;
      ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS activity_time VARCHAR(50);
      ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

      UPDATE public.leads l
      SET last_activity = sub.max_act,
          next_activity_at = sub.max_act
      FROM (
        SELECT lead_id, MAX(COALESCE(scheduled_at, created_at)) as max_act
        FROM public.lead_activities
        GROUP BY lead_id
      ) sub
      WHERE l.id = sub.lead_id AND (l.last_activity IS NULL OR sub.max_act > l.last_activity);

      CREATE TABLE IF NOT EXISTS public.notifications (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50) DEFAULT 'lead',
        title VARCHAR(255) NOT NULL,
        description TEXT,
        lead_id UUID,
        lead_name VARCHAR(200),
        activity_id INT,
        scheduled_at TIMESTAMPTZ DEFAULT NOW(),
        read BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company_id VARCHAR(100);

      CREATE TABLE IF NOT EXISTS public.integration_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR(100),
        provider VARCHAR(30) NOT NULL,
        account_name VARCHAR(150) NOT NULL,
        webhook_key VARCHAR(64) UNIQUE NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        allowed_domains TEXT[] DEFAULT '{}',
        last_received_at TIMESTAMPTZ,
        created_by VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_int_acc_company ON public.integration_accounts(company_id, provider);
      CREATE INDEX IF NOT EXISTS idx_int_acc_webhook_key ON public.integration_accounts(webhook_key);

      CREATE TABLE IF NOT EXISTS public.pipeline_stages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(200) NOT NULL,
        color VARCHAR(50) DEFAULT 'bg-gray-400',
        required BOOLEAN DEFAULT false,
        sort_order INT DEFAULT 1,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_name_idx ON public.pipeline_stages (name);

      CREATE TABLE IF NOT EXISTS public.industry_active_selection (
        id INT PRIMARY KEY DEFAULT 1,
        selection_type VARCHAR(50) DEFAULT 'builtin',
        selection_key VARCHAR(100) DEFAULT 'real-estate',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.industry_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        icon VARCHAR(100) DEFAULT 'ri-building-4-line',
        icon_bg VARCHAR(100) DEFAULT 'bg-indigo-100',
        icon_color VARCHAR(100) DEFAULT 'text-indigo-600',
        pipeline_summary TEXT,
        stages JSONB DEFAULT '[]'::jsonb,
        fields JSONB DEFAULT '[]'::jsonb,
        inventory_fields JSONB DEFAULT '[]'::jsonb,
        is_custom BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE IF EXISTS public.industry_templates ADD COLUMN IF NOT EXISTS inventory_fields JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE IF EXISTS public.industry_templates ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT false;

      CREATE TABLE IF NOT EXISTS public.custom_industry_templates (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        icon VARCHAR(100) DEFAULT 'ri-building-line',
        icon_bg VARCHAR(100) DEFAULT 'bg-indigo-100',
        icon_color VARCHAR(100) DEFAULT 'text-indigo-600',
        stages INT DEFAULT 0,
        fields INT DEFAULT 0,
        pipeline TEXT,
        is_active BOOLEAN DEFAULT false,
        stage_list JSONB DEFAULT '[]'::jsonb,
        field_list JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.stage_extra_fields (
        id SERIAL PRIMARY KEY,
        stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
        label VARCHAR(200) NOT NULL,
        type VARCHAR(100) DEFAULT 'Text Input',
        required BOOLEAN DEFAULT false,
        options JSONB DEFAULT '[]'::jsonb,
        sort_order INT DEFAULT 1,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.custom_fields (
        id SERIAL PRIMARY KEY,
        label VARCHAR(200) NOT NULL,
        type VARCHAR(100) DEFAULT 'Text Input',
        required BOOLEAN DEFAULT false,
        show_in_list BOOLEAN DEFAULT false,
        active BOOLEAN DEFAULT true,
        options JSONB DEFAULT '[]'::jsonb,
        category VARCHAR(50) NOT NULL DEFAULT 'lead',
        sort_order INT DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.lead_sources (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        color VARCHAR(50) DEFAULT '#64748b',
        active BOOLEAN DEFAULT true,
        priority VARCHAR(50) DEFAULT 'Low',
        sort_order INT DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.lead_scoring_config (
        id INT PRIMARY KEY DEFAULT 1,
        method VARCHAR(50) DEFAULT 'automatic',
        factors JSONB DEFAULT '[]'::jsonb,
        thresholds JSONB DEFAULT '[]'::jsonb,
        actions JSONB DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.assignment_rules_config (
        id INT PRIMARY KEY DEFAULT 1,
        method VARCHAR(50) DEFAULT 'round_robin',
        rules JSONB DEFAULT '[]'::jsonb,
        escalation_rules JSONB DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.ai_agent_settings (
        id INT PRIMARY KEY DEFAULT 1,
        master_enabled BOOLEAN DEFAULT true,
        bot_name VARCHAR(100) DEFAULT 'Aria',
        persona TEXT DEFAULT 'Senior Sales Consultant',
        tone VARCHAR(50) DEFAULT 'professional',
        language VARCHAR(50) DEFAULT 'en-IN',
        sources JSONB DEFAULT '[]'::jsonb,
        config JSONB DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.knowledge_base_articles (
        id VARCHAR(100) PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        category VARCHAR(100) DEFAULT 'FAQ',
        active BOOLEAN DEFAULT true,
        used_count INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- =========================================================
      -- WhatsApp AI Sales Bot Tables (Phase 1)
      -- =========================================================
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

      CREATE INDEX IF NOT EXISTS idx_bot_conv_comp_lead ON public.bot_conversations(company_id, lead_id);
      CREATE INDEX IF NOT EXISTS idx_bot_conv_comp_status ON public.bot_conversations(company_id, status);
      CREATE INDEX IF NOT EXISTS idx_bot_msg_comp_conv ON public.bot_messages(company_id, conversation_id);
      CREATE INDEX IF NOT EXISTS idx_bot_msg_comp_lead ON public.bot_messages(company_id, lead_id);
      CREATE INDEX IF NOT EXISTS idx_bot_msg_wa_id ON public.bot_messages(wa_message_id);
      CREATE INDEX IF NOT EXISTS idx_bot_settings_comp ON public.bot_settings(company_id);
    `);

    // Seed default bot_settings for existing companies if not present
    await connectDB.query(`
      INSERT INTO public.bot_settings (company_id)
      SELECT id FROM public.companies
      ON CONFLICT (company_id) DO NOTHING;
    `).catch(() => {});


    // Seed default pipeline stages if empty
    const stagesCountRes = await connectDB.query(`SELECT COUNT(*) FROM public.pipeline_stages`);
    if (parseInt(stagesCountRes.rows[0].count, 10) === 0) {
      const defaultStages = [
        { name: "New Inquiry", color: "bg-gray-400", required: true, sort_order: 1 },
        { name: "Site Visit Scheduled", color: "bg-blue-500", required: false, sort_order: 2 },
        { name: "Site Visit Done", color: "bg-indigo-500", required: false, sort_order: 3 },
        { name: "Proposal Sent", color: "bg-amber-500", required: false, sort_order: 4 },
        { name: "Negotiation", color: "bg-orange-500", required: false, sort_order: 5 },
        { name: "Booking Done", color: "bg-green-500", required: false, sort_order: 6 },
        { name: "Lost", color: "bg-red-400", required: false, sort_order: 7 },
      ];
      for (const st of defaultStages) {
        await connectDB.query(
          `INSERT INTO public.pipeline_stages (name, color, required, sort_order, is_active) VALUES ($1, $2, $3, $4, true)`,
          [st.name, st.color, st.required, st.sort_order]
        );
      }
    }

    // Seed default leads if empty
    const leadsCountRes = await connectDB.query(`SELECT COUNT(*) FROM public.leads`);
    if (parseInt(leadsCountRes.rows[0].count, 10) === 0) {
      const initialLeads = [
        { name: "Vikram Mehta", company: "TechVentures Inc", phone: "9876543210", email: "vikram@techventures.com", source: "IndiaMart", stage: "Negotiation", priority: "High", assigned: "Rajesh Kumar", industry: "Real Estate", value: "₹24,500", score: 87 },
        { name: "Anita Desai", company: "Nexus Capital", phone: "9845123456", email: "anita@nexuscap.com", source: "JustDial", stage: "Proposal Sent", priority: "Medium", assigned: "Priya Sharma", industry: "SaaS", value: "₹18,000", score: 72 },
        { name: "Suresh Nair", company: "Apex Logistics", phone: "9712345678", email: "suresh@apexlogistics.com", source: "IndiaMart", stage: "New Inquiry", priority: "High", assigned: "Rajesh Kumar", industry: "Manufacturing", value: "₹45,000", score: 78 },
        { name: "Kavita Joshi", company: "GreenLeaf Organics", phone: "9632145870", email: "kavita@greenleaf.in", source: "Website", stage: "Site Visit Done", priority: "Medium", assigned: "Amit Patel", industry: "Retail", value: "₹12,200", score: 65 },
        { name: "Rahul Verma", company: "Skyline Infra", phone: "9521478963", email: "rahul@skylineinfra.com", source: "TradeIndia", stage: "Site Visit Scheduled", priority: "Low", assigned: "Sneha Rao", industry: "Construction", value: "₹85,000", score: 54 },
        { name: "Deepika Singh", company: "Aura Healthcare", phone: "9415263780", email: "deepika@aurahealth.org", source: "JustDial", stage: "Proposal Sent", priority: "Medium", assigned: "Priya Sharma", industry: "Healthcare", value: "₹32,000", score: 71 },
        { name: "Sunita Rao", company: "Zenith EduTech", phone: "9201364875", email: "sunita@zenithedu.com", source: "Website", stage: "Site Visit Done", priority: "High", assigned: "Rajesh Kumar", industry: "Education", value: "₹15,000", score: 84 },
        { name: "Manoj Tiwari", company: "Global Traders", phone: "9854123670", email: "manoj@globaltraders.co", source: "Social Media", stage: "New Inquiry", priority: "Low", assigned: "Amit Patel", industry: "Retail", value: "₹9,500", score: 48 },
        { name: "Pooja Hegde", company: "Prime Realty", phone: "9123456789", email: "pooja@primerealty.in", source: "WhatsApp", stage: "Booking Done", priority: "High", assigned: "Sneha Rao", industry: "Real Estate", value: "₹1,20,000", score: 95 },
        { name: "Rohan Kapoor", company: "Vanguard Tech", phone: "9012345678", email: "rohan@vanguardtech.io", source: "Manual", stage: "Lost", priority: "Low", assigned: "Rajesh Kumar", industry: "SaaS", value: "₹5,000", score: 32 }
      ];

      for (const l of initialLeads) {
        const res = await connectDB.query(
          `INSERT INTO public.leads (name, company, phone, email, source, stage, priority, assigned, industry, value, score, score_factors, tags, notes, last_activity, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW(), NOW()) RETURNING id`,
          [l.name, l.company, l.phone, l.email, l.source, l.stage, l.priority, l.assigned, l.industry, l.value, l.score, JSON.stringify([]), JSON.stringify([]), ""]
        );
        const leadId = res.rows[0].id;
        await connectDB.query(
          `INSERT INTO public.lead_activities (lead_id, type, description, performed_by) VALUES ($1, $2, $3, $4)`,
          [leadId, 'created', 'Lead initialized in CRM', l.assigned || 'System']
        );
      }
    }

    // Seed default inventory fields if empty
    const ifCount = await connectDB.query(`SELECT COUNT(*) FROM public.inventory_fields`);
    if (parseInt(ifCount.rows[0].count, 10) === 0) {
      const defaultInventoryFields = [
        { id: "aaaaaaaa-1111-4aaa-aaaa-111111111111", label: "Unit Number", field_key: "unitNo", type: "Text Input", required: true, show_in_list: true, show_in_form: true, active: true, options: [], sort_order: 1, placeholder: "e.g. A-101" },
        { id: "aaaaaaaa-2222-4aaa-aaaa-222222222222", label: "Type", field_key: "type", type: "Dropdown", required: true, show_in_list: true, show_in_form: true, active: true, options: ["2BHK", "3BHK", "Villa", "Plot", "Commercial"], sort_order: 2, placeholder: "" },
        { id: "aaaaaaaa-3333-4aaa-aaaa-333333333333", label: "Floor", field_key: "floor", type: "Number Input", required: false, show_in_list: false, show_in_form: true, active: true, options: [], sort_order: 3, placeholder: "e.g. 1" },
        { id: "aaaaaaaa-4444-4aaa-aaaa-444444444444", label: "Area (sqft)", field_key: "area", type: "Number Input", required: false, show_in_list: true, show_in_form: true, active: true, options: [], sort_order: 4, placeholder: "e.g. 950" },
        { id: "aaaaaaaa-5555-4aaa-aaaa-555555555555", label: "Price", field_key: "price", type: "Currency", required: true, show_in_list: true, show_in_form: true, active: true, options: [], sort_order: 5, placeholder: "e.g. 1.8 Cr" },
        { id: "aaaaaaaa-6666-4aaa-aaaa-666666666666", label: "Status", field_key: "status", type: "Dropdown", required: true, show_in_list: true, show_in_form: true, active: true, options: ["Available", "Booked", "Sold", "On Hold"], sort_order: 6, placeholder: "" },
        { id: "aaaaaaaa-7777-4aaa-aaaa-777777777777", label: "Buyer Name", field_key: "buyer", type: "Text Input", required: false, show_in_list: false, show_in_form: true, active: true, options: [], sort_order: 7, placeholder: "e.g. Vikram Mehta" },
      ];
      for (const f of defaultInventoryFields) {
        await connectDB.query(
          `INSERT INTO public.inventory_fields (id, label, field_key, type, required, show_in_list, show_in_form, active, options, sort_order, placeholder, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [f.id, f.label, f.field_key, f.type, f.required, f.show_in_list, f.show_in_form, f.active, JSON.stringify(f.options), f.sort_order, f.placeholder]
        );
      }
    }

    // Seed default selling types if empty
    const stCount = await connectDB.query(`SELECT COUNT(*) FROM public.selling_types`);
    if (parseInt(stCount.rows[0].count, 10) === 0) {
      const defaultSellingTypes = [
        {
          id: "11111111-1111-4111-a111-111111111111", name: "Residential Property", color: "indigo",
          inventory_field_ids: ["aaaaaaaa-1111-4aaa-aaaa-111111111111", "aaaaaaaa-2222-4aaa-aaaa-222222222222", "aaaaaaaa-3333-4aaa-aaaa-333333333333", "aaaaaaaa-4444-4aaa-aaaa-444444444444", "aaaaaaaa-5555-4aaa-aaaa-555555555555", "aaaaaaaa-6666-4aaa-aaaa-666666666666", "aaaaaaaa-7777-4aaa-aaaa-777777777777"],
          track_inventory: true, item_label: "Unit", identifier_field: "Unit Number",
          available_status: "Available", sold_status: "Sold", progress_label: "Units sold",
        },
        {
          id: "22222222-2222-4222-a222-222222222222", name: "Commercial Property", color: "amber",
          inventory_field_ids: ["aaaaaaaa-1111-4aaa-aaaa-111111111111", "aaaaaaaa-2222-4aaa-aaaa-222222222222", "aaaaaaaa-5555-4aaa-aaaa-555555555555", "aaaaaaaa-6666-4aaa-aaaa-666666666666"],
          track_inventory: true, item_label: "Unit", identifier_field: "Unit Number",
          available_status: "Available", sold_status: "Sold", progress_label: "Units sold",
        },
        {
          id: "33333333-3333-4333-a333-333333333333", name: "Plot / Land", color: "green",
          inventory_field_ids: ["aaaaaaaa-1111-4aaa-aaaa-111111111111", "aaaaaaaa-4444-4aaa-aaaa-444444444444", "aaaaaaaa-5555-4aaa-aaaa-555555555555", "aaaaaaaa-6666-4aaa-aaaa-666666666666"],
          track_inventory: true, item_label: "Plot", identifier_field: "Unit Number",
          available_status: "Available", sold_status: "Sold", progress_label: "Plots sold",
        },
        {
          id: "44444444-4444-4444-a444-444444444444", name: "Courses & Batches", color: "amber",
          inventory_field_ids: ["aaaaaaaa-1111-4aaa-aaaa-111111111111", "aaaaaaaa-2222-4aaa-aaaa-222222222222", "aaaaaaaa-5555-4aaa-aaaa-555555555555", "aaaaaaaa-6666-4aaa-aaaa-666666666666"],
          track_inventory: true, item_label: "Seat", identifier_field: "Unit Number",
          available_status: "Available", sold_status: "Enrolled", progress_label: "Seats filled",
        },
        {
          id: "55555555-5555-4555-a555-555555555555", name: "Products", color: "green",
          inventory_field_ids: ["aaaaaaaa-1111-4aaa-aaaa-111111111111", "aaaaaaaa-2222-4aaa-aaaa-222222222222", "aaaaaaaa-5555-4aaa-aaaa-555555555555", "aaaaaaaa-6666-4aaa-aaaa-666666666666"],
          track_inventory: true, item_label: "Product", identifier_field: "Unit Number",
          available_status: "In Stock", sold_status: "Out of Stock", progress_label: "Stock status",
        },
        {
          id: "66666666-6666-4666-a666-666666666666", name: "Packages & Services", color: "pink",
          inventory_field_ids: ["aaaaaaaa-1111-4aaa-aaaa-111111111111", "aaaaaaaa-4444-4aaa-aaaa-444444444444", "aaaaaaaa-5555-4aaa-aaaa-555555555555", "aaaaaaaa-6666-4aaa-aaaa-666666666666"],
          track_inventory: true, item_label: "Slot", identifier_field: "Unit Number",
          available_status: "Available", sold_status: "Booked", progress_label: "Slots booked",
        },
        {
          id: "77777777-7777-4777-a777-777777777777", name: "Plans & Licenses", color: "purple",
          inventory_field_ids: ["aaaaaaaa-1111-4aaa-aaaa-111111111111", "aaaaaaaa-5555-4aaa-aaaa-555555555555", "aaaaaaaa-6666-4aaa-aaaa-666666666666"],
          track_inventory: true, item_label: "Plan", identifier_field: "Unit Number",
          available_status: "Active", sold_status: "Active Clients", progress_label: "Client adoption",
        },
        {
          id: "88888888-8888-4888-a888-888888888888", name: "Custom", color: "teal",
          inventory_field_ids: ["aaaaaaaa-1111-4aaa-aaaa-111111111111", "aaaaaaaa-4444-4aaa-aaaa-444444444444", "aaaaaaaa-5555-4aaa-aaaa-555555555555", "aaaaaaaa-6666-4aaa-aaaa-666666666666"],
          track_inventory: true, item_label: "Service", identifier_field: "Unit Number",
          available_status: "Available", sold_status: "Booked", progress_label: "Services booked",
        },
      ];
      for (const st of defaultSellingTypes) {
        await connectDB.query(
          `INSERT INTO public.selling_types (id, name, color, inventory_field_ids, track_inventory, item_label, identifier_field, available_status, sold_status, progress_label)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [st.id, st.name, st.color, JSON.stringify(st.inventory_field_ids), st.track_inventory, st.item_label, st.identifier_field, st.available_status, st.sold_status, st.progress_label]
        );
      }
    }

    // Seed default projects if not present
    const initialProjects = [
      {
        id: "11111111-1111-4bbb-bbbb-111111111111", name: "Bandra West Complex", category: "properties", selling_type_id: "11111111-1111-4111-a111-111111111111", status: "Active", color: "indigo",
        description: "Premium residential complex in Mumbai's most sought-after neighborhood.", leads: 234, interested: 43, booked: 16, progress: 33,
        custom_fields: { location: "Bandra West, Mumbai", priceFrom: "₹1.8 Cr", priceTo: "₹2.4 Cr", totalUnits: "48", reraNumber: "P51800045678", possession: "December 2026" }
      },
      {
        id: "22222222-2222-4bbb-bbbb-222222222222", name: "Industrial Pump Series X", category: "products", selling_type_id: "55555555-5555-4555-a555-555555555555", status: "Active", color: "green",
        description: "High-performance industrial pump series designed for manufacturing and chemical processing plants.", leads: 156, interested: 28, booked: 18, progress: 25,
        custom_fields: { productCategory: "Industrial Equipment", totalSKUs: "8", priceFrom: "₹45,000", priceTo: "₹2,80,000", moq: "5", leadTime: "7-10 days" }
      },
      {
        id: "33333333-3333-4bbb-bbbb-333333333333", name: "MBA Batch July 2026", category: "courses", selling_type_id: "44444444-4444-4444-a444-444444444444", status: "Active", color: "amber",
        description: "A comprehensive 2-year MBA program designed for working professionals and fresh graduates.", leads: 189, interested: 37, booked: 37, progress: 62,
        custom_fields: { courseName: "MBA General Management", totalSeats: "60", fee: "₹2,40,000", startDate: "2026-07-15", endDate: "2028-06-30", mode: "Offline" }
      },
      {
        id: "44444444-4444-4bbb-bbbb-444444444444", name: "CRM Pro Software", category: "plans", selling_type_id: "77777777-7777-4777-a777-777777777777", status: "Active", color: "purple",
        description: "A powerful CRM platform built for sales teams to manage leads, automate follow-ups, and close deals faster.", leads: 89, interested: 12, booked: 34, progress: 68,
        custom_fields: { planTier: "Basic, Professional, Enterprise", priceMonth: "₹999", priceYear: "₹9,999", maxUsers: "50", trialDays: "14" }
      },
      {
        id: "55555555-5555-4bbb-bbbb-555555555555", name: "Wellness Packages 2026", category: "packages", selling_type_id: "66666666-6666-4666-a666-666666666666", status: "Active", color: "pink",
        description: "Comprehensive health and wellness packages designed for corporates, families, and individuals.", leads: 179, interested: 22, booked: 18, progress: 30,
        custom_fields: { serviceCategory: "Health Checkup & Wellness", priceFrom: "₹1,500", priceTo: "₹25,000", duration: "30-90 mins", slotsAvailable: "120", validity: "1 year" }
      },
      {
        id: "66666666-6666-4bbb-bbbb-666666666666", name: "Consulting Services Hub", category: "custom", selling_type_id: "88888888-8888-4888-a888-888888888888", status: "Active", color: "teal",
        description: "A flexible consulting service line for business strategy, digital transformation, and operational excellence.", leads: 98, interested: 14, booked: 7, progress: 18,
        custom_fields: {}
      }
    ];
    for (const p of initialProjects) {
      await connectDB.query(
        `INSERT INTO public.projects (id, name, category, selling_type_id, status, color, description, leads, interested, booked, progress, custom_fields)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.name, p.category, p.selling_type_id, p.status, p.color, p.description, p.leads, p.interested, p.booked, p.progress, JSON.stringify(p.custom_fields)]
      );
    }

    // Seed default project inventory if empty
    const invCountRes = await connectDB.query(`SELECT COUNT(*) FROM public.project_inventory`).catch(() => ({ rows: [{ count: '0' }] }));
    if (parseInt(invCountRes.rows[0].count, 10) === 0) {
      const defaultInventoryMap = {
        "11111111-1111-4bbb-bbbb-111111111111": [
          { id: "cccccccc-0001-4ccc-cccc-000000000001", unitNo: "A-101", type: "2BHK", floor: "1", area: "950", price: "₹1.8 Cr", status: "Available", buyer: "" },
          { id: "cccccccc-0002-4ccc-cccc-000000000002", unitNo: "A-102", type: "2BHK", floor: "1", area: "950", price: "₹1.85 Cr", status: "Booked", buyer: "Vikram Mehta", leadName: "Vikram Mehta" },
          { id: "cccccccc-0003-4ccc-cccc-000000000003", unitNo: "A-103", type: "2BHK", floor: "1", area: "975", price: "₹1.9 Cr", status: "Available", buyer: "" },
          { id: "cccccccc-0004-4ccc-cccc-000000000004", unitNo: "B-201", type: "3BHK", floor: "2", area: "1350", price: "₹2.1 Cr", status: "Sold", buyer: "Kavita Joshi", leadName: "Kavita Joshi" },
          { id: "cccccccc-0005-4ccc-cccc-000000000005", unitNo: "B-202", type: "3BHK", floor: "2", area: "1350", price: "₹2.15 Cr", status: "Available", buyer: "" },
          { id: "cccccccc-0006-4ccc-cccc-000000000006", unitNo: "C-301", type: "2BHK", floor: "3", area: "950", price: "₹1.95 Cr", status: "On Hold", buyer: "Sunita Rao", leadName: "Sunita Rao" },
          { id: "cccccccc-0007-4ccc-cccc-000000000007", unitNo: "C-302", type: "2BHK", floor: "3", area: "950", price: "₹1.9 Cr", status: "Available", buyer: "" },
          { id: "cccccccc-0008-4ccc-cccc-000000000008", unitNo: "D-401", type: "3BHK", floor: "4", area: "1400", price: "₹2.2 Cr", status: "Booked", buyer: "Rahul Verma", leadName: "Rahul Verma" },
          { id: "cccccccc-0009-4ccc-cccc-000000000009", unitNo: "D-402", type: "3BHK", floor: "4", area: "1400", price: "₹2.2 Cr", status: "Available", buyer: "" },
          { id: "cccccccc-0010-4ccc-cccc-000000000010", unitNo: "E-501", type: "2BHK", floor: "5", area: "950", price: "₹2.0 Cr", status: "Available", buyer: "" },
          { id: "cccccccc-0011-4ccc-cccc-000000000011", unitNo: "E-502", type: "2BHK", floor: "5", area: "975", price: "₹2.05 Cr", status: "Sold", buyer: "Deepika Singh", leadName: "Deepika Singh" },
          { id: "cccccccc-0012-4ccc-cccc-000000000012", unitNo: "F-601", type: "3BHK", floor: "6", area: "1425", price: "₹2.25 Cr", status: "Available", buyer: "" }
        ],
        "22222222-2222-4bbb-bbbb-222222222222": [
          { id: "cccccccc-0021-4ccc-cccc-000000000021", unitNo: "IPX-450", type: "Centrifugal", area: "120", price: "₹45,000", status: "Available", buyer: "" },
          { id: "cccccccc-0022-4ccc-cccc-000000000022", unitNo: "IPX-750", type: "Submersible", area: "85", price: "₹78,500", status: "Available", buyer: "" },
          { id: "cccccccc-0023-4ccc-cccc-000000000023", unitNo: "IPX-1500", type: "Industrial", area: "3", price: "₹1,25,000", status: "Booked", buyer: "Suresh Nair", leadName: "Suresh Nair" }
        ],
        "33333333-3333-4bbb-bbbb-333333333333": [
          { id: "cccccccc-0031-4ccc-cccc-000000000031", unitNo: "MBA-JUL-01", type: "General Management", area: "30 Seats", price: "₹2,40,000", status: "Sold", buyer: "Sunita Rao", leadName: "Sunita Rao" },
          { id: "cccccccc-0032-4ccc-cccc-000000000032", unitNo: "MBA-JUL-02", type: "Executive Online", area: "30 Seats", price: "₹1,80,000", status: "Available", buyer: "" }
        ],
        "44444444-4444-4bbb-bbbb-444444444444": [
          { id: "cccccccc-0041-4ccc-cccc-000000000041", unitNo: "BASIC-TIER", type: "5 Users", area: "Cloud", price: "₹999/mo", status: "Sold", buyer: "Anita Desai", leadName: "Anita Desai" },
          { id: "cccccccc-0042-4ccc-cccc-000000000042", unitNo: "PRO-TIER", type: "25 Users", area: "Cloud", price: "₹4,999/mo", status: "Available", buyer: "" }
        ],
        "55555555-5555-4bbb-bbbb-555555555555": [
          { id: "cccccccc-0051-4ccc-cccc-000000000051", unitNo: "HLTH-BASIC", type: "Health Check", area: "30 mins", price: "₹1,500", status: "Available", buyer: "" },
          { id: "cccccccc-0052-4ccc-cccc-000000000052", unitNo: "HLTH-EXEC", type: "Executive", area: "60 mins", price: "₹5,000", status: "Sold", buyer: "Deepika Singh", leadName: "Deepika Singh" }
        ],
        "66666666-6666-4bbb-bbbb-666666666666": [
          { id: "cccccccc-0061-4ccc-cccc-000000000061", unitNo: "CONS-01", type: "Strategy Audit", area: "2 Weeks", price: "₹1,50,000", status: "Available", buyer: "" }
        ]
      };

      for (const [projId, items] of Object.entries(defaultInventoryMap)) {
        const checkProj = await connectDB.query(`SELECT id FROM public.projects WHERE id = $1`, [projId]).catch(() => ({ rows: [] }));
        if (checkProj.rows && checkProj.rows.length > 0) {
          for (const item of items) {
            await connectDB.query(
              `INSERT INTO public.project_inventory (id, project_id, data, created_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (id) DO NOTHING`,
              [item.id, projId, JSON.stringify(item)]
            );
          }
        }
      }
    }

    // Seed default project tasks if empty
    const taskCountRes = await connectDB.query(`SELECT COUNT(*) FROM public.project_tasks`).catch(() => ({ rows: [{ count: '0' }] }));
    if (parseInt(taskCountRes.rows[0].count, 10) === 0) {
      const defaultTasks = [
        { project_id: "11111111-1111-4bbb-bbbb-111111111111", title: "Site visit preparation with client", status: "In Progress", priority: "High", assigned_to: "Rajesh Kumar", due_date: "2026-08-20" },
        { project_id: "11111111-1111-4bbb-bbbb-111111111111", title: "Complete RERA documentation verification", status: "Completed", priority: "Medium", assigned_to: "Priya Sharma", due_date: "2026-08-15" },
        { project_id: "11111111-1111-4bbb-bbbb-111111111111", title: "Publish updated unit availability brochure", status: "To Do", priority: "Low", assigned_to: "Amit Patel", due_date: "2026-08-25" },
      ];
      for (const t of defaultTasks) {
        const checkProj = await connectDB.query(`SELECT id FROM public.projects WHERE id = $1`, [t.project_id]).catch(() => ({ rows: [] }));
        if (checkProj.rows && checkProj.rows.length > 0) {
          await connectDB.query(
            `INSERT INTO public.project_tasks (project_id, title, status, priority, assigned_to, due_date)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [t.project_id, t.title, t.status, t.priority, t.assigned_to, t.due_date]
          );
        }
      }
    }

    // Seed default industry active selection if empty
    const selCount = await connectDB.query(`SELECT COUNT(*) FROM public.industry_active_selection`);
    if (parseInt(selCount.rows[0].count, 10) === 0) {
      await connectDB.query(
        `INSERT INTO public.industry_active_selection (id, selection_type, selection_key, updated_at)
         VALUES (1, 'builtin', 'real-estate', NOW())
         ON CONFLICT (id) DO NOTHING`
      );
    }

    // Seed default industry templates if empty
    const indTmplCount = await connectDB.query(`SELECT COUNT(*) FROM public.industry_templates`).catch(() => ({ rows: [{ count: '0' }] }));
    if (parseInt(indTmplCount.rows[0].count, 10) === 0) {
      const defaultIndTemplates = [
        {
          name: "Real Estate",
          icon: "ri-building-4-line",
          icon_bg: "bg-indigo-100",
          icon_color: "text-indigo-600",
          pipeline_summary: "New Lead → Site Visit → Proposal → Negotiation → Booking → Documentation → Closed Won",
          stages: [
            { id: 1, name: "New Lead", color: "#22c55e", required: true },
            { id: 2, name: "Site Visit Scheduled", color: "#3b82f6", required: true },
            { id: 3, name: "Site Visit Done", color: "#6366f1", required: true },
            { id: 4, name: "Proposal Sent", color: "#f59e0b", required: true },
            { id: 5, name: "Negotiation", color: "#f97316", required: false },
            { id: 6, name: "Booking Done", color: "#a855f7", required: false },
            { id: 7, name: "Documentation", color: "#14b8a6", required: false },
            { id: 8, name: "Closed Won", color: "#16a34a", required: false },
            { id: 9, name: "Lost", color: "#ef4444", required: false }
          ],
          fields: [
            { id: 1, label: "Property Type", type: "Dropdown", required: true, options: ["2BHK", "3BHK", "Villa", "Plot", "Commercial"] },
            { id: 2, label: "Budget Range", type: "Dropdown", required: true, options: ["Below 30L", "30-50L", "50L-1Cr", "Above 1Cr"] },
            { id: 3, label: "Preferred Location", type: "Text Input", required: false },
            { id: 4, label: "Possession Timeline", type: "Dropdown", required: false, options: ["Ready to move", "1-2 years", "2-3 years", "3+ years"] },
            { id: 5, label: "Loan Required", type: "Toggle", required: false },
            { id: 6, label: "Site Visit Date", type: "Date", required: false }
          ],
          inventory_fields: [
            { id: 1, label: "Unit Number", field_key: "unitNo", type: "Text Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 1, placeholder: "e.g. A-101", options: [] },
            { id: 2, label: "Type", field_key: "type", type: "Dropdown", required: true, show_in_list: true, show_in_form: true, active: true, order: 2, placeholder: "", options: ["2BHK", "3BHK", "Villa", "Plot", "Commercial"] },
            { id: 3, label: "Floor", field_key: "floor", type: "Number Input", required: false, show_in_list: false, show_in_form: true, active: true, order: 3, placeholder: "e.g. 1", options: [] },
            { id: 4, label: "Area (sqft)", field_key: "area", type: "Number Input", required: false, show_in_list: true, show_in_form: true, active: true, order: 4, placeholder: "e.g. 950", options: [] },
            { id: 5, label: "Price", field_key: "price", type: "Currency", required: true, show_in_list: true, show_in_form: true, active: true, order: 5, placeholder: "e.g. 1.8 Cr", options: [] },
            { id: 6, label: "Status", field_key: "status", type: "Dropdown", required: true, show_in_list: true, show_in_form: true, active: true, order: 6, placeholder: "", options: ["Available", "Booked", "Sold", "On Hold"] }
          ]
        },
        {
          name: "Manufacturing",
          icon: "ri-building-2-line",
          icon_bg: "bg-amber-100",
          icon_color: "text-amber-600",
          pipeline_summary: "Inquiry → Sample → Quote → PO → Production → Quality Check → Delivery",
          stages: [
            { id: 1, name: "Inquiry", color: "#22c55e", required: true },
            { id: 2, name: "Sample Request", color: "#3b82f6", required: false },
            { id: 3, name: "Quote Sent", color: "#6366f1", required: true },
            { id: 4, name: "Purchase Order", color: "#f59e0b", required: false },
            { id: 5, name: "Production", color: "#a855f7", required: false },
            { id: 6, name: "Quality Check", color: "#14b8a6", required: false },
            { id: 7, name: "Delivery / Dispatch", color: "#16a34a", required: false }
          ],
          fields: [
            { id: 1, label: "Product Category", type: "Dropdown", required: true, options: ["Raw Material", "Finished Goods", "Components", "Packaging"] },
            { id: 2, label: "Order Quantity", type: "Number", required: true },
            { id: 3, label: "Delivery Timeline", type: "Dropdown", required: false, options: ["Immediate", "15 days", "30 days", "60+ days"] },
            { id: 4, label: "Payment Terms", type: "Dropdown", required: false, options: ["100% Advance", "50-50", "Net 30", "Letter of Credit"] },
            { id: 5, label: "Sample Required", type: "Toggle", required: false }
          ],
          inventory_fields: [
            { id: 1, label: "Item Code / SKU", field_key: "itemCode", type: "Text Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 1, placeholder: "e.g. SKU-101", options: [] },
            { id: 2, label: "Product Category", field_key: "category", type: "Dropdown", required: true, show_in_list: true, show_in_form: true, active: true, order: 2, placeholder: "", options: ["Raw Material", "Finished Goods", "Components"] },
            { id: 3, label: "Batch Size", field_key: "batchSize", type: "Number Input", required: false, show_in_list: true, show_in_form: true, active: true, order: 3, placeholder: "e.g. 500", options: [] },
            { id: 4, label: "Unit Cost (₹)", field_key: "unitCost", type: "Number Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 4, placeholder: "e.g. 250", options: [] },
            { id: 5, label: "Stock Quantity", field_key: "stockQty", type: "Number Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 5, placeholder: "e.g. 1200", options: [] },
            { id: 6, label: "Warehouse Location", field_key: "warehouse", type: "Text Input", required: false, show_in_list: false, show_in_form: true, active: true, order: 6, placeholder: "e.g. Bay 4", options: [] }
          ]
        },
        {
          name: "Education",
          icon: "ri-graduation-cap-line",
          icon_bg: "bg-green-100",
          icon_color: "text-green-600",
          pipeline_summary: "Inquiry → Counseling → Application → Verification → Fee Payment → Enrolled",
          stages: [
            { id: 1, name: "Inquiry", color: "#22c55e", required: true },
            { id: 2, name: "Counseling Scheduled", color: "#3b82f6", required: false },
            { id: 3, name: "Application Submitted", color: "#6366f1", required: false },
            { id: 4, name: "Document Verification", color: "#f59e0b", required: false },
            { id: 5, name: "Fee Payment", color: "#a855f7", required: false },
            { id: 6, name: "Enrolled", color: "#16a34a", required: false }
          ],
          fields: [
            { id: 1, label: "Course Interested", type: "Dropdown", required: true, options: ["B.Tech", "MBA", "MCA", "BBA", "Diploma"] },
            { id: 2, label: "Batch Year", type: "Dropdown", required: false, options: ["2026", "2027", "2028"] },
            { id: 3, label: "Scholarship Required", type: "Toggle", required: false },
            { id: 4, label: "Previous Score (%)", type: "Number", required: false },
            { id: 5, label: "Parent Contact", type: "Phone", required: false }
          ],
          inventory_fields: [
            { id: 1, label: "Course ID", field_key: "courseId", type: "Text Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 1, placeholder: "e.g. CRS-101", options: [] },
            { id: 2, label: "Course Name", field_key: "courseName", type: "Text Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 2, placeholder: "e.g. MBA Full Time", options: [] },
            { id: 3, label: "Total Seats", field_key: "totalSeats", type: "Number Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 3, placeholder: "e.g. 60", options: [] },
            { id: 4, label: "Available Seats", field_key: "availSeats", type: "Number Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 4, placeholder: "e.g. 25", options: [] },
            { id: 5, label: "Tuition Fee (₹)", field_key: "fee", type: "Number Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 5, placeholder: "e.g. 240000", options: [] }
          ]
        },
        {
          name: "Healthcare",
          icon: "ri-heart-line",
          icon_bg: "bg-red-100",
          icon_color: "text-red-600",
          pipeline_summary: "Inquiry → Consultation → Diagnosis → Treatment → Follow-up → Discharged",
          stages: [
            { id: 1, name: "Inquiry", color: "#22c55e", required: true },
            { id: 2, name: "Consultation Booked", color: "#3b82f6", required: true },
            { id: 3, name: "Diagnosis Done", color: "#6366f1", required: false },
            { id: 4, name: "Treatment Plan", color: "#f59e0b", required: false },
            { id: 5, name: "Follow-up", color: "#a855f7", required: false },
            { id: 6, name: "Discharged / Won", color: "#16a34a", required: false }
          ],
          fields: [
            { id: 1, label: "Department", type: "Dropdown", required: true, options: ["Cardiology", "Orthopedics", "Neurology", "Dental", "General"] },
            { id: 2, label: "Doctor Preference", type: "Text Input", required: false },
            { id: 3, label: "Insurance Covered", type: "Toggle", required: false },
            { id: 4, label: "Preferred Time Slot", type: "Dropdown", required: false, options: ["Morning", "Afternoon", "Evening"] }
          ],
          inventory_fields: [
            { id: 1, label: "Package / Service ID", field_key: "packageId", type: "Text Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 1, placeholder: "e.g. PKG-01", options: [] },
            { id: 2, label: "Department", field_key: "dept", type: "Dropdown", required: true, show_in_list: true, show_in_form: true, active: true, order: 2, placeholder: "", options: ["Cardiology", "Orthopedics", "Dental"] },
            { id: 3, label: "Room / Slot Type", field_key: "roomType", type: "Dropdown", required: false, show_in_list: true, show_in_form: true, active: true, order: 3, placeholder: "", options: ["General", "Semi-Private", "Deluxe Suite"] },
            { id: 4, label: "Standard Rate (₹)", field_key: "rate", type: "Number Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 4, placeholder: "e.g. 50000", options: [] }
          ]
        },
        {
          name: "E-Commerce",
          icon: "ri-shopping-cart-2-line",
          icon_bg: "bg-pink-100",
          icon_color: "text-pink-600",
          pipeline_summary: "Lead Inquiry → Product Inquiry → Cart Abandoned → Order Placed → Delivered",
          stages: [
            { id: 1, name: "Lead Inquiry", color: "#22c55e", required: true },
            { id: 2, name: "Product Inquiry", color: "#3b82f6", required: false },
            { id: 3, name: "Cart Abandoned", color: "#f59e0b", required: false },
            { id: 4, name: "Order Placed", color: "#a855f7", required: false },
            { id: 5, name: "Delivered", color: "#16a34a", required: false }
          ],
          fields: [
            { id: 1, label: "Product SKU", type: "Text Input", required: true },
            { id: 2, label: "Order Value (₹)", type: "Number", required: false },
            { id: 3, label: "Shipping City", type: "Text Input", required: false }
          ],
          inventory_fields: [
            { id: 1, label: "SKU", field_key: "sku", type: "Text Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 1, placeholder: "e.g. SKU-889", options: [] },
            { id: 2, label: "Product Title", field_key: "title", type: "Text Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 2, placeholder: "e.g. Wireless Headphone", options: [] },
            { id: 3, label: "Category", field_key: "category", type: "Dropdown", required: true, show_in_list: true, show_in_form: true, active: true, order: 3, placeholder: "", options: ["Apparel", "Electronics", "Home & Kitchen", "Beauty"] },
            { id: 4, label: "Price (₹)", field_key: "price", type: "Number Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 4, placeholder: "e.g. 2999", options: [] },
            { id: 5, label: "Stock Level", field_key: "stock", type: "Number Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 5, placeholder: "e.g. 150", options: [] }
          ]
        },
        {
          name: "Automotive",
          icon: "ri-car-line",
          icon_bg: "bg-blue-100",
          icon_color: "text-blue-600",
          pipeline_summary: "Inquiry → Test Drive Scheduled → Test Drive Done → Finance Approved → Booking Done → Vehicle Delivered",
          stages: [
            { id: 1, name: "Inquiry", color: "#22c55e", required: true },
            { id: 2, name: "Test Drive Scheduled", color: "#3b82f6", required: true },
            { id: 3, name: "Test Drive Done", color: "#6366f1", required: true },
            { id: 4, name: "Finance Approved", color: "#f59e0b", required: false },
            { id: 5, name: "Booking Done", color: "#a855f7", required: false },
            { id: 6, name: "Vehicle Delivered", color: "#16a34a", required: false }
          ],
          fields: [
            { id: 1, label: "Vehicle Model", type: "Dropdown", required: true, options: ["Sedan", "SUV", "Hatchback", "EV", "Luxury"] },
            { id: 2, label: "Fuel Type", type: "Dropdown", required: false, options: ["Petrol", "Diesel", "EV", "CNG", "Hybrid"] },
            { id: 3, label: "Test Drive Date", type: "Date", required: false }
          ],
          inventory_fields: [
            { id: 1, label: "VIN / Chassis No", field_key: "vinNo", type: "Text Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 1, placeholder: "e.g. MA3E...", options: [] },
            { id: 2, label: "Model & Variant", field_key: "model", type: "Text Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 2, placeholder: "e.g. Harrier XZA+", options: [] },
            { id: 3, label: "Color / Trim", field_key: "color", type: "Text Input", required: false, show_in_list: true, show_in_form: true, active: true, order: 3, placeholder: "e.g. Daytona Grey", options: [] },
            { id: 4, label: "Ex-Showroom Price (₹)", field_key: "price", type: "Number Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 4, placeholder: "e.g. 2100000", options: [] },
            { id: 5, label: "Units in Stock", field_key: "stock", type: "Number Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 5, placeholder: "e.g. 4", options: [] }
          ]
        },
        {
          name: "Travel & Hospitality",
          icon: "ri-flight-takeoff-line",
          icon_bg: "bg-cyan-100",
          icon_color: "text-cyan-600",
          pipeline_summary: "Inquiry → Itinerary Sent → Customization → Advance Paid → Vouchers Issued → Trip Completed",
          stages: [
            { id: 1, name: "Inquiry", color: "#22c55e", required: true },
            { id: 2, name: "Itinerary Sent", color: "#3b82f6", required: true },
            { id: 3, name: "Customization", color: "#6366f1", required: false },
            { id: 4, name: "Advance Paid", color: "#f59e0b", required: false },
            { id: 5, name: "Vouchers Issued", color: "#a855f7", required: false },
            { id: 6, name: "Trip Completed", color: "#16a34a", required: false }
          ],
          fields: [
            { id: 1, label: "Destination", type: "Text Input", required: true },
            { id: 2, label: "Travel Dates", type: "Date", required: false },
            { id: 3, label: "No. of Travelers", type: "Number", required: false }
          ],
          inventory_fields: [
            { id: 1, label: "Package Code", field_key: "pkgCode", type: "Text Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 1, placeholder: "e.g. BALI-5N", options: [] },
            { id: 2, label: "Destination", field_key: "destination", type: "Text Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 2, placeholder: "e.g. Bali, Indonesia", options: [] },
            { id: 3, label: "Duration (Nights)", field_key: "duration", type: "Number Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 3, placeholder: "e.g. 5", options: [] },
            { id: 4, label: "Starting Price (₹)", field_key: "price", type: "Number Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 4, placeholder: "e.g. 45000", options: [] }
          ]
        },
        {
          name: "Solar & Energy",
          icon: "ri-sun-line",
          icon_bg: "bg-teal-100",
          icon_color: "text-teal-600",
          pipeline_summary: "Inquiry → Site Survey Scheduled → Feasibility Report → Quotation Sent → Govt Subsidy Applied → Installation Done → Commissioned",
          stages: [
            { id: 1, name: "Inquiry", color: "#22c55e", required: true },
            { id: 2, name: "Site Survey Scheduled", color: "#3b82f6", required: true },
            { id: 3, name: "Feasibility Report", color: "#6366f1", required: true },
            { id: 4, name: "Quotation Sent", color: "#f59e0b", required: false },
            { id: 5, name: "Govt Subsidy Applied", color: "#f97316", required: false },
            { id: 6, name: "Installation Done", color: "#a855f7", required: false },
            { id: 7, name: "Commissioned", color: "#16a34a", required: false }
          ],
          fields: [
            { id: 1, label: "Monthly Bill (₹)", type: "Number", required: true },
            { id: 2, label: "Roof Type", type: "Dropdown", required: false, options: ["RCC Flat", "Tin Shed", "Tile Roof", "Ground Mount"] },
            { id: 3, label: "Sanctioned Load (kW)", type: "Number", required: false }
          ],
          inventory_fields: [
            { id: 1, label: "System Capacity (kW)", field_key: "capacity", type: "Number Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 1, placeholder: "e.g. 5", options: [] },
            { id: 2, label: "Panel Brand", field_key: "brand", type: "Dropdown", required: true, show_in_list: true, show_in_form: true, active: true, order: 2, placeholder: "", options: ["Tata Power", "Adani Solar", "Waaree", "Vikram Solar"] },
            { id: 3, label: "Inverter Type", field_key: "inverter", type: "Dropdown", required: false, show_in_list: true, show_in_form: true, active: true, order: 3, placeholder: "", options: ["On-Grid", "Off-Grid", "Hybrid"] },
            { id: 4, label: "Package Price (₹)", field_key: "price", type: "Number Input", required: true, show_in_list: true, show_in_form: true, active: true, order: 4, placeholder: "e.g. 260000", options: [] }
          ]
        }
      ];

      for (const t of defaultIndTemplates) {
        await connectDB.query(
          `INSERT INTO public.industry_templates (name, icon, icon_bg, icon_color, pipeline_summary, stages, fields, inventory_fields, is_custom, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, NOW(), NOW())`,
          [t.name, t.icon, t.icon_bg, t.icon_color, t.pipeline_summary, JSON.stringify(t.stages), JSON.stringify(t.fields), JSON.stringify(t.inventory_fields)]
        );
      }
    }

    // Seed default whatsapp templates if empty
    const tplCount = await connectDB.query(`SELECT COUNT(*) FROM public.whatsapp_templates`).catch(() => ({ rows: [{ count: '0' }] }));
    if (parseInt(tplCount.rows[0].count, 10) === 0) {
      const defaultTemplates = [
        { name: "Property Brochure Inquiry", category: "Marketing", language: "en", status: "Approved", content: "Hi {{1}}, thank you for your interest in {{2}}! Here is the latest brochure and pricing details. Let us know if you'd like to schedule a site visit." },
        { name: "Site Visit Confirmation", category: "Utility", language: "en", status: "Approved", content: "Hello {{1}}, your site visit for {{2}} is confirmed for {{3}} at {{4}}. Our representative {{5}} will meet you at the location." },
        { name: "Payment Reminder", category: "Utility", language: "en", status: "Approved", content: "Dear {{1}}, this is a friendly reminder that installment {{2}} for quotation {{3}} of {{4}} is due on {{5}}." },
        { name: "Welcome Message", category: "Service", language: "en", status: "Approved", content: "Welcome {{1}} to Digi India CRM! We're here to assist you with all your requirements. Feel free to reply to this message anytime." },
        { name: "Follow-up Check-in", category: "Marketing", language: "en", status: "Approved", content: "Hi {{1}}, following up on our recent conversation regarding {{2}}. Would you like to review the updated proposal today?" }
      ];
      for (const t of defaultTemplates) {
        await connectDB.query(
          `INSERT INTO public.whatsapp_templates (name, category, language, status, content, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [t.name, t.category, t.language, t.status, t.content]
        );
      }
    }

    // Seed default quick replies if empty
    const qrCount = await connectDB.query(`SELECT COUNT(*) FROM public.whatsapp_quick_replies`).catch(() => ({ rows: [{ count: '0' }] }));
    if (parseInt(qrCount.rows[0].count, 10) === 0) {
      const defaultQuickReplies = [
        { shortcut: "/hello", title: "Greeting", message: "Hello! Thank you for reaching out to us. How can I assist you today?", category: "General" },
        { shortcut: "/brochure", title: "Send Brochure", message: "Here is our project catalog and brochure: https://crmpro.in/brochure.pdf. Please take a look!", category: "Sales" },
        { shortcut: "/visit", title: "Schedule Visit", message: "We would be delighted to host you for a site visit. Would tomorrow at 11:00 AM or 3:00 PM work for you?", category: "Sales" },
        { shortcut: "/pricing", title: "Pricing Request", message: "Our pricing plans start from standard rates with flexible payment milestones. I can share the detailed breakdown.", category: "Sales" },
        { shortcut: "/thanks", title: "Thank You", message: "Thank you for your time today! Please let us know if you have any questions.", category: "General" }
      ];
      for (const q of defaultQuickReplies) {
        await connectDB.query(
          `INSERT INTO public.whatsapp_quick_replies (shortcut, title, message, category, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [q.shortcut, q.title, q.message, q.category]
        );
      }
    }

    // Seed default whatsapp chats if empty
    const chatsCount = await connectDB.query(`SELECT COUNT(*) FROM public.whatsapp_chats`).catch(() => ({ rows: [{ count: '0' }] }));
    if (parseInt(chatsCount.rows[0].count, 10) === 0) {
      const initialChats = [
        {
          name: "Vikram Mehta", phone: "+91 98765 43210", avatar: "VM", unread: 2, assigned: "Rajesh Kumar", stage: "Negotiation", dealValue: "₹24,500",
          lastMsg: "Can you send the revised payment schedule for Unit 402?",
          messages: [
            { text: "Hello, I visited the site yesterday with Priya.", sender: "incoming", time: "10:15 AM" },
            { text: "Glad to hear that, Mr. Mehta! Did you like the East-facing unit?", sender: "me", time: "10:18 AM" },
            { text: "Can you send the revised payment schedule for Unit 402?", sender: "incoming", time: "11:04 AM" }
          ]
        },
        {
          name: "Anita Desai", phone: "+91 98451 23456", avatar: "AD", unread: 0, assigned: "Priya Sharma", stage: "Proposal Sent", dealValue: "₹18,000",
          lastMsg: "Thank you, reviewing the proposal with our team today.",
          messages: [
            { text: "Hi Priya, sharing the requirements for our office setup.", sender: "incoming", time: "09:30 AM" },
            { text: "Thank you Anita! I have attached the customized proposal for your review.", sender: "me", time: "10:00 AM" },
            { text: "Thank you, reviewing the proposal with our team today.", sender: "incoming", time: "10:45 AM" }
          ]
        },
        {
          name: "Suresh Nair", phone: "+91 97123 45678", avatar: "SN", unread: 1, assigned: "Rajesh Kumar", stage: "New Inquiry", dealValue: "₹45,000",
          lastMsg: "Interested in the industrial pump series. What is the delivery timeline?",
          messages: [
            { text: "Interested in the industrial pump series. What is the delivery timeline?", sender: "incoming", time: "11:20 AM" }
          ]
        },
        {
          name: "Pooja Hegde", phone: "+91 91234 56789", avatar: "PH", unread: 0, assigned: "Sneha Rao", stage: "Booking Done", dealValue: "₹1,20,000",
          lastMsg: "Booking token received. Receipt has been generated.",
          messages: [
            { text: "I have transferred the booking amount.", sender: "incoming", time: "Yesterday" },
            { text: "Booking token received. Receipt has been generated.", sender: "me", time: "Yesterday" }
          ]
        },
        {
          name: "Kavita Joshi", phone: "+91 96321 45870", avatar: "KJ", unread: 0, assigned: "Amit Patel", stage: "Site Visit Done", dealValue: "₹12,200",
          lastMsg: "Site visit was great! Let's connect tomorrow afternoon.",
          messages: [
            { text: "Site visit was great! Let's connect tomorrow afternoon.", sender: "incoming", time: "Yesterday" }
          ]
        }
      ];

      for (const c of initialChats) {
        const chatRes = await connectDB.query(
          `INSERT INTO public.whatsapp_chats (contact_name, phone, avatar, unread_count, assigned_agent, stage, deal_value, last_message, last_message_time)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING id`,
          [c.name, c.phone, c.avatar, c.unread, c.assigned, c.stage, c.dealValue, c.lastMsg]
        );
        const chatId = chatRes.rows[0].id;
        for (const m of c.messages) {
          await connectDB.query(
            `INSERT INTO public.whatsapp_messages (chat_id, text, sender, timestamp, read)
             VALUES ($1, $2, $3, NOW(), true)`,
            [chatId, m.text, m.sender]
          );
        }
      }
    }

    // ─── 11. Seed Quotation Templates ───
    const tmplCount = await connectDB.query(`SELECT COUNT(*)::int AS count FROM public.quotation_templates`);
    if (tmplCount.rows[0].count === 0) {
      const initialTemplates = [
        {
          name: "2BHK Standard Package",
          description: "Standard 2BHK flat with registration and legal charges",
          created_by: "Rajesh Kumar",
          items: [
            { id: 1, description: "2BHK Flat", qty: 1, unit: "Unit", rate: 22000000, taxPercent: 0 },
            { id: 2, description: "Registration & Stamp Duty", qty: 1, unit: "Lump Sum", rate: 150000, taxPercent: 18 },
            { id: 3, description: "Brokerage Fee", qty: 1, unit: "Lump Sum", rate: 245000, taxPercent: 18 },
            { id: 4, description: "Legal Charges", qty: 1, unit: "Lump Sum", rate: 35000, taxPercent: 18 },
          ]
        },
        {
          name: "3BHK Premium Package",
          description: "Premium 3BHK flat with interior consultation and full legal support",
          created_by: "Priya Sharma",
          items: [
            { id: 1, description: "3BHK Flat", qty: 1, unit: "Unit", rate: 38000000, taxPercent: 0 },
            { id: 2, description: "Registration & Stamp Duty", qty: 1, unit: "Lump Sum", rate: 250000, taxPercent: 18 },
            { id: 3, description: "Brokerage Fee", qty: 1, unit: "Lump Sum", rate: 450000, taxPercent: 18 },
            { id: 4, description: "Interior Consultation", qty: 1, unit: "Lump Sum", rate: 500000, taxPercent: 18 },
            { id: 5, description: "Legal Charges", qty: 1, unit: "Lump Sum", rate: 75000, taxPercent: 18 },
          ]
        },
        {
          name: "Plot + Construction",
          description: "Residential plot purchase with construction and approval charges",
          created_by: "Rajesh Kumar",
          items: [
            { id: 1, description: "Plot Cost", qty: 1, unit: "Unit", rate: 25000000, taxPercent: 0 },
            { id: 2, description: "Construction Cost", qty: 1, unit: "Lump Sum", rate: 8000000, taxPercent: 5 },
            { id: 3, description: "Architect Fee", qty: 1, unit: "Lump Sum", rate: 500000, taxPercent: 18 },
            { id: 4, description: "Approval Charges", qty: 1, unit: "Lump Sum", rate: 200000, taxPercent: 18 },
          ]
        },
        {
          name: "Commercial Space",
          description: "Commercial unit with CAM charges and complete registration",
          created_by: "Amit Patel",
          items: [
            { id: 1, description: "Commercial Unit", qty: 1, unit: "Unit", rate: 60000000, taxPercent: 0 },
            { id: 2, description: "CAM Charges (1 Year)", qty: 1, unit: "Lump Sum", rate: 2500000, taxPercent: 18 },
            { id: 3, description: "Registration & Stamp Duty", qty: 1, unit: "Lump Sum", rate: 500000, taxPercent: 18 },
            { id: 4, description: "Legal Documentation", qty: 1, unit: "Lump Sum", rate: 150000, taxPercent: 18 },
          ]
        },
        {
          name: "Affordable Housing",
          description: "Budget-friendly 1BHK flat with minimal charges",
          created_by: "Sneha Rao",
          items: [
            { id: 1, description: "1BHK Flat", qty: 1, unit: "Unit", rate: 12000000, taxPercent: 0 },
            { id: 2, description: "Registration Charges", qty: 1, unit: "Lump Sum", rate: 120000, taxPercent: 18 },
          ]
        }
      ];

      for (const t of initialTemplates) {
        await connectDB.query(
          `INSERT INTO public.quotation_templates (name, description, created_by, items, item_count)
           VALUES ($1, $2, $3, $4, $5)`,
          [t.name, t.description, t.created_by, JSON.stringify(t.items), t.items.length]
        );
      }
    }

    // ─── 12. Seed Quotations ───
    const quoteCount = await connectDB.query(`SELECT COUNT(*)::int AS count FROM public.quotations`);
    if (quoteCount.rows[0].count === 0) {
      const defaultTerms = "1. This quotation is valid for 30 days\n2. Payment terms: 10% on booking\n3. All prices inclusive of applicable taxes\n4. Subject to availability";
      const initialQuotes = [
        {
          quote_number: "QT-001", client_name: "Vikram Mehta", client_company: "TechVentures Inc", client_email: "vikram@techventures.in", client_phone: "+91 98201 12345",
          agent: "Rajesh Kumar", quote_date: "2026-06-20", valid_until: "2026-06-30", status: "Sent", discount: 0, tax: 450, total_amount: 24950,
          items: [
            { id: 1, description: "2BHK Apartment — Andheri East", qty: 1, unit: "Unit", rate: 22000, taxPercent: 0 },
            { id: 2, description: "Parking Slot", qty: 1, unit: "Unit", rate: 1500, taxPercent: 18 },
            { id: 3, description: "Processing Fee", qty: 1, unit: "Lump Sum", rate: 1000, taxPercent: 18 },
          ],
          terms: defaultTerms
        },
        {
          quote_number: "QT-002", client_name: "Anita Desai", client_company: "GreenLeaf Organics", client_email: "anita@greenleaf.com", client_phone: "+91 98202 23456",
          agent: "Priya Sharma", quote_date: "2026-06-15", valid_until: "2026-06-25", status: "Accepted", discount: 0, tax: 234, total_amount: 13034,
          items: [
            { id: 1, description: "1BHK Apartment — Vashi", qty: 1, unit: "Unit", rate: 11500, taxPercent: 0 },
            { id: 2, description: "Registration Charges", qty: 1, unit: "Lump Sum", rate: 1300, taxPercent: 18 },
          ],
          terms: defaultTerms
        },
        {
          quote_number: "QT-003", client_name: "Suresh Nair", client_company: "Skyline Architects", client_email: "suresh@skyline.co", client_phone: "+91 98203 34567",
          agent: "Rajesh Kumar", quote_date: "2026-06-18", valid_until: "2026-07-15", status: "Draft", discount: 0, tax: 1188, total_amount: 46388,
          items: [
            { id: 1, description: "3BHK Penthouse — Bandra", qty: 1, unit: "Unit", rate: 38000, taxPercent: 0 },
            { id: 2, description: "Terrace Garden Setup", qty: 1, unit: "Lump Sum", rate: 2500, taxPercent: 18 },
            { id: 3, description: "Modular Kitchen", qty: 1, unit: "Unit", rate: 1800, taxPercent: 12 },
            { id: 4, description: "Interior Painting", qty: 1, unit: "Lump Sum", rate: 1200, taxPercent: 18 },
            { id: 5, description: "Club Membership", qty: 1, unit: "Unit", rate: 1700, taxPercent: 18 },
          ],
          terms: defaultTerms
        },
        {
          quote_number: "QT-004", client_name: "Kavita Joshi", client_company: "BluePeak Media", client_email: "kavita@bluepeak.in", client_phone: "+91 98204 45678",
          agent: "Amit Patel", quote_date: "2026-06-10", valid_until: "2026-06-20", status: "Accepted", discount: 0, tax: 0, total_amount: 8900,
          items: [
            { id: 1, description: "Studio Apartment — Powai", qty: 1, unit: "Unit", rate: 8900, taxPercent: 0 },
          ],
          terms: defaultTerms
        },
        {
          quote_number: "QT-005", client_name: "Sunita Rao", client_company: "PropMax Realty", client_email: "sunita@propmax.in", client_phone: "+91 98205 56789",
          agent: "Rajesh Kumar", quote_date: "2026-06-22", valid_until: "2026-07-05", status: "Sent", discount: 2000, tax: 2130, total_amount: 95130,
          items: [
            { id: 1, description: "4BHK Villa — Lonavala", qty: 1, unit: "Unit", rate: 82000, taxPercent: 0 },
            { id: 2, description: "Swimming Pool Access", qty: 1, unit: "Unit", rate: 5000, taxPercent: 18 },
            { id: 3, description: "Landscaping", qty: 1, unit: "Lump Sum", rate: 3500, taxPercent: 12 },
            { id: 4, description: "Security System", qty: 1, unit: "Unit", rate: 4500, taxPercent: 18 },
          ],
          terms: defaultTerms
        },
        {
          quote_number: "QT-006", client_name: "Manoj Tiwari", client_company: "FastBuild Corp", client_email: "manoj@fastbuild.com", client_phone: "+91 98206 67890",
          agent: "Priya Sharma", quote_date: "2026-06-08", valid_until: "2026-06-18", status: "Rejected", discount: 500, tax: 1260, total_amount: 52760,
          items: [
            { id: 1, description: "2BHK Apartment — Thane", qty: 1, unit: "Unit", rate: 45000, taxPercent: 0 },
            { id: 2, description: "Parking Slot", qty: 2, unit: "Unit", rate: 2000, taxPercent: 18 },
            { id: 3, description: "GST on Services", qty: 1, unit: "Lump Sum", rate: 3000, taxPercent: 18 },
          ],
          terms: defaultTerms
        },
        {
          quote_number: "QT-007", client_name: "Rahul Verma", client_company: "NovaTech Labs", client_email: "rahul@novatech.io", client_phone: "+91 98207 78901",
          agent: "Sneha Rao", quote_date: "2026-06-19", valid_until: "2026-07-10", status: "Draft", discount: 0, tax: 0, total_amount: 31000,
          items: [
            { id: 1, description: "1BHK Apartment — Panvel", qty: 1, unit: "Unit", rate: 28000, taxPercent: 0 },
            { id: 2, description: "Maintenance Deposit", qty: 1, unit: "Lump Sum", rate: 3000, taxPercent: 0 },
          ],
          terms: defaultTerms
        },
        {
          quote_number: "QT-008", client_name: "Deepika Singh", client_company: "EduSmart", client_email: "deepika@edusmart.com", client_phone: "+91 98208 89012",
          agent: "Priya Sharma", quote_date: "2026-06-21", valid_until: "2026-06-28", status: "Sent", discount: 0, tax: 540, total_amount: 19040,
          items: [
            { id: 1, description: "2BHK Apartment — Kharghar", qty: 1, unit: "Unit", rate: 15500, taxPercent: 0 },
            { id: 2, description: "Parking Slot", qty: 1, unit: "Unit", rate: 1500, taxPercent: 18 },
            { id: 3, description: "Registration Charges", qty: 1, unit: "Lump Sum", rate: 1500, taxPercent: 18 },
          ],
          terms: defaultTerms
        }
      ];

      for (const q of initialQuotes) {
        await connectDB.query(
          `INSERT INTO public.quotations (quote_number, client_name, client_company, client_email, client_phone, agent, quote_date, valid_until, status, discount, tax, total_amount, items, terms)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            q.quote_number, q.client_name, q.client_company, q.client_email, q.client_phone,
            q.agent, q.quote_date, q.valid_until, q.status, q.discount, q.tax, q.total_amount,
            JSON.stringify(q.items), q.terms
          ]
        );
      }
    }

    // Sync all existing leads into activities table if not already present
    try {
      const allLeadsRes = await connectDB.query(`SELECT id, name, source, score, assigned, created_at FROM public.leads`);
      for (const lead of allLeadsRes.rows) {
        const leadIdStr = String(lead.id);
        const actCheck = await connectDB.query(
          `SELECT id FROM public.activities WHERE lead_id = $1 AND type = 'lead_created'`,
          [leadIdStr]
        );
        if (actCheck.rows.length === 0) {
          const uName = lead.assigned || 'System';
          const uInitials = uName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 3);
          const detail = `Source: ${lead.source || 'Manual'} • Score: ${lead.score || 50}`;
          const ts = lead.created_at ? new Date(lead.created_at) : new Date();
          const hours = ts.getHours();
          const block = hours < 12 ? 'Morning' : hours < 17 ? 'Afternoon' : 'Evening';

          await connectDB.query(
            `INSERT INTO public.activities (
              type, title, description, user_name, user_initials, action,
              lead_name, lead_id, detail, time_block, timestamp, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              'lead_created',
              'Lead created',
              detail,
              uName,
              uInitials,
              'created a lead',
              lead.name,
              leadIdStr,
              detail,
              block,
              ts,
              JSON.stringify({}),
            ]
          ).catch(() => {});
        }
      }
    } catch (err) {
      console.error("Error syncing leads to activities:", err.message);
    }

    // Sync serial sequences
    await connectDB.query(`
      SELECT setval(pg_get_serial_sequence('public.leads', 'id'), COALESCE((SELECT MAX(id) FROM public.leads), 1), true);
      SELECT setval(pg_get_serial_sequence('public.quotation_templates', 'id'), COALESCE((SELECT MAX(id) FROM public.quotation_templates), 1), true);
    `).catch(() => { });

    // Initialize Knowledge Base module tables, triggers, and seed data (Phase 1)
    try {
      const { initKnowledgeBaseDb } = await import('./knowledge-base/kb-init.js');
      await initKnowledgeBaseDb();
    } catch (kbErr) {
      console.error("Error initializing Knowledge Base DB:", kbErr.message);
    }

    // Initialize Workflows module tables, indexes, and constraints (Phase 1)
    try {
      const { initWorkflowsDb } = await import('./workflows/workflow-init.js');
      await initWorkflowsDb();
    } catch (wfErr) {
      console.error("Error initializing Workflows DB:", wfErr.message);
    }

    console.log("✅ All CRM Database Tables Initialized Successfully!");
  } catch (error) {
    console.error("❌ DB Table Initialization Error:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
};

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('src/initDb.js')) {
  initDb().then(() => process.exit(0)).catch(() => process.exit(1));
}
