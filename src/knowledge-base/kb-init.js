/**
 * Knowledge Base Database Initializer & Seeder (Phase 1)
 * Creates:
 *  - kb_categories
 *  - kb_articles (with search_vector & GIN index)
 *  - kb_unanswered
 * Seeds 10 sample FAQs in 2 categories for demo company.
 */

import connectDB from '../pool.js';

export const SAMPLE_KB_DATA = [
  {
    categoryName: 'General & Booking Policies',
    categoryDescription: 'Standard company guidelines, booking documentation, payment schedules, and site visit policies.',
    sortOrder: 1,
    articles: [
      {
        question: 'What documents are required to book a property?',
        answer: 'To complete a property booking, you require: (1) Self-attested PAN Card copy, (2) Aadhaar Card or Passport for identity and address proof, (3) 2 passport-sized photographs, and (4) Booking token amount payment receipt via Cheque, UPI, or Bank Transfer. For NRI buyers, a valid passport and NRE/NRO account details are additionally required.',
        keywords: ['documents', 'booking', 'aadhaar', 'pan card', 'id proof', 'token amount', 'dastavej', 'kaagaz'],
        type: 'policy',
        priority: 10,
        language: 'en',
      },
      {
        question: 'Can I schedule a free weekend site visit?',
        answer: 'Yes, complimentary guided site visits are available 7 days a week, including Saturdays and Sundays, between 9:30 AM and 6:30 PM. We also offer door-to-door cab pickup and drop facility for families upon 24-hour advance confirmation.',
        keywords: ['site visit', 'visit', 'weekend', 'cab facility', 'timing', 'pickup', 'free visit', 'ghumna'],
        type: 'faq',
        priority: 9,
        language: 'en',
      },
      {
        question: 'What are the standard payment plans available?',
        answer: 'We offer flexible construction-linked payment plans (CLP), possession-linked plans (PLP), and down payment discount plans. Typically, booking token is 10%, 10% on agreement within 30 days, and the remaining 80% disbursed across construction milestones through bank home loans.',
        keywords: ['payment plan', 'payment schedule', 'installments', 'clp', 'plp', 'down payment', 'kist', 'bhuqtan'],
        type: 'pricing',
        priority: 8,
        language: 'en',
      },
      {
        question: 'Do you provide assistance with bank home loans?',
        answer: 'Yes, our in-house financial desk provides end-to-end home loan assistance with leading partner banks including SBI, HDFC, ICICI, Axis Bank, and Kotak. Our projects are pre-approved, ensuring fast approval with competitive interest rates and minimal paperwork.',
        keywords: ['home loan', 'bank loan', 'loan assistance', 'sbi', 'hdfc', 'icici', 'interest rate', 'emi', 'karz'],
        type: 'faq',
        priority: 8,
        language: 'en',
      },
      {
        question: 'What is your booking cancellation and refund policy?',
        answer: 'If you wish to cancel before the builder-buyer agreement is executed (within 15 days of booking), 100% of the token amount is refundable minus a nominal administrative processing fee. Post agreement signing, terms specified in the RERA agreement will govern the refund timeline.',
        keywords: ['cancellation', 'refund', 'cancel booking', 'token refund', 'money back', 'policy', 'wapas'],
        type: 'policy',
        priority: 7,
        language: 'en',
      },
    ],
  },
  {
    categoryName: 'Properties & Amenities',
    categoryDescription: 'Unit layouts, construction specifications, possession timelines, parking, and clubhouse amenities.',
    sortOrder: 2,
    articles: [
      {
        question: 'What apartment configurations are available across your residential projects?',
        answer: 'Our residential developments feature 2 BHK (approx 950 - 1,250 sq.ft.), 3 BHK (approx 1,450 - 1,900 sq.ft.), and 4 BHK luxury penthouses (approx 2,400 - 3,200 sq.ft.). All units are Vastu-compliant, cross-ventilated, and designed with private balconies.',
        keywords: ['configurations', '2 bhk', '3 bhk', '4 bhk', 'penthouse', 'super area', 'carpet area', 'sizes', 'vastu'],
        type: 'product_info',
        priority: 10,
        language: 'en',
      },
      {
        question: 'What is the estimated possession timeline for ongoing towers?',
        answer: 'Phase 1 towers are ready to move with Occupancy Certificate (OC) received. Phase 2 towers are progressing on schedule as per RERA guidelines, with handovers starting in December 2026. Detailed construction milestone tracking is provided to all buyers.',
        keywords: ['possession', 'handover', 'possession date', 'ready to move', 'completion', 'rera date', 'kab milega'],
        type: 'faq',
        priority: 9,
        language: 'en',
      },
      {
        question: 'What clubhouse amenities and sports facilities are included?',
        answer: 'Residents enjoy exclusive access to a 25,000 sq.ft. multi-level clubhouse featuring an Olympic-size swimming pool, gymnasium, badminton and squash courts, dedicated yoga deck, banquet hall, co-working lounge, kids play arena, and 24x7 gated security with biometric access.',
        keywords: ['amenities', 'clubhouse', 'swimming pool', 'gym', 'sports', 'kids play area', 'security', 'suvidha'],
        type: 'faq',
        priority: 8,
        language: 'en',
      },
      {
        question: 'Is covered reserved car parking provided with each unit?',
        answer: 'Yes, each 2 BHK and 3 BHK apartment is allocated 1 covered basement car parking space. For 4 BHK penthouses and duplex units, 2 covered parking slots are allocated. Guest parking and EV vehicle charging stations are also designated.',
        keywords: ['car parking', 'parking slot', 'covered parking', 'basement parking', 'ev charging', 'two wheeler', 'gaadi'],
        type: 'product_info',
        priority: 7,
        language: 'en',
      },
      {
        question: 'How are monthly society maintenance charges calculated?',
        answer: 'Maintenance charges are calculated on super built-up area at approximately ₹2.5 to ₹3.5 per sq.ft. per month. This covers 24x7 security, power backup for common areas, landscaping, swimming pool upkeep, waste disposal, and elevator maintenance.',
        keywords: ['maintenance', 'maintenance charges', 'society maintenance', 'monthly charges', 'power backup', 'kharcha'],
        type: 'pricing',
        priority: 6,
        language: 'en',
      },
    ],
  },
];

/**
 * Initializes Knowledge Base tables, triggers, and seed data
 */
export async function initKnowledgeBaseDb() {
  try {
    console.log('📚 Checking & Initializing Knowledge Base Tables (Phase 1)...');

    // 1. kb_categories
    await connectDB.query(`
      CREATE TABLE IF NOT EXISTS public.kb_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        name VARCHAR(150) NOT NULL,
        description TEXT,
        sort_order INT DEFAULT 0 NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT uq_kb_categories_company_name UNIQUE (company_id, name)
      );

      CREATE INDEX IF NOT EXISTS idx_kb_categories_comp_sort 
        ON public.kb_categories(company_id, sort_order ASC);
    `);

    // 2. kb_articles
    await connectDB.query(`
      CREATE TABLE IF NOT EXISTS public.kb_articles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        category_id UUID REFERENCES public.kb_categories(id) ON DELETE SET NULL,
        project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
        type VARCHAR(50) DEFAULT 'faq' NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        keywords TEXT[] DEFAULT '{}'::text[] NOT NULL,
        language VARCHAR(20) DEFAULT 'en' NOT NULL,
        status VARCHAR(20) DEFAULT 'published' NOT NULL,
        priority INT DEFAULT 0 NOT NULL,
        usage_count INT DEFAULT 0 NOT NULL,
        last_used_at TIMESTAMPTZ,
        is_auto_generated BOOLEAN DEFAULT false NOT NULL,
        created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        search_vector tsvector,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT chk_kb_article_type CHECK (type IN ('faq', 'product_info', 'policy', 'pricing', 'objection_handling')),
        CONSTRAINT chk_kb_article_language CHECK (language IN ('en', 'hi', 'hinglish')),
        CONSTRAINT chk_kb_article_status CHECK (status IN ('draft', 'published'))
      );
    `);

    // 3. Search vector trigger & GIN Index
    await connectDB.query(`
      CREATE OR REPLACE FUNCTION public.kb_articles_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('simple', coalesce(NEW.question, '')), 'A') ||
          setweight(to_tsvector('simple', array_to_string(coalesce(NEW.keywords, '{}'::text[]), ' ')), 'B') ||
          setweight(to_tsvector('simple', coalesce(NEW.answer, '')), 'C');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_kb_articles_search_vector ON public.kb_articles;
      CREATE TRIGGER trg_kb_articles_search_vector
      BEFORE INSERT OR UPDATE OF question, answer, keywords
      ON public.kb_articles
      FOR EACH ROW
      EXECUTE FUNCTION public.kb_articles_search_vector_update();

      CREATE INDEX IF NOT EXISTS idx_kb_articles_search_vector 
        ON public.kb_articles USING GIN(search_vector);

      CREATE INDEX IF NOT EXISTS idx_kb_articles_comp_status 
        ON public.kb_articles(company_id, status);

      CREATE INDEX IF NOT EXISTS idx_kb_articles_comp_cat 
        ON public.kb_articles(company_id, category_id);

      CREATE INDEX IF NOT EXISTS idx_kb_articles_comp_proj 
        ON public.kb_articles(company_id, project_id);

      CREATE INDEX IF NOT EXISTS idx_kb_articles_priority 
        ON public.kb_articles(company_id, priority DESC);
    `);

    // 4. kb_unanswered
    await connectDB.query(`
      CREATE TABLE IF NOT EXISTS public.kb_unanswered (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
        question_text TEXT NOT NULL,
        bot_conversation_id UUID REFERENCES public.bot_conversations(id) ON DELETE SET NULL,
        status VARCHAR(20) DEFAULT 'open' NOT NULL,
        resolved_article_id UUID REFERENCES public.kb_articles(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT chk_kb_unanswered_status CHECK (status IN ('open', 'resolved', 'ignored'))
      );

      CREATE INDEX IF NOT EXISTS idx_kb_unanswered_comp_status 
        ON public.kb_unanswered(company_id, status);

      CREATE INDEX IF NOT EXISTS idx_kb_unanswered_comp_lead 
        ON public.kb_unanswered(company_id, lead_id);
    `);

    // 5. Seed 10 sample FAQs for demo company
    await seedSampleKnowledgeBase();

    console.log('✅ Knowledge Base Database Initialized Successfully!');
  } catch (err) {
    console.error('❌ Knowledge Base DB Initialization Error:', err.message);
  }
}

/**
 * Seeds sample categories & articles for each company if they have none
 */
export async function seedSampleKnowledgeBase(targetCompanyId = null) {
  try {
    let companyIds = [];
    if (targetCompanyId) {
      companyIds = [targetCompanyId];
    } else {
      const compRes = await connectDB.query(`SELECT id FROM public.companies`);
      companyIds = compRes.rows.map((r) => r.id);
      if (companyIds.length === 0) {
        companyIds = ['00000000-0000-0000-0000-000000000000'];
      }
    }

    for (const compId of companyIds) {
      for (const catData of SAMPLE_KB_DATA) {
        // Insert or fetch category
        let catId;
        const catRes = await connectDB.query(
          `INSERT INTO public.kb_categories (company_id, name, description, sort_order)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (company_id, name) DO UPDATE SET description = EXCLUDED.description
           RETURNING id`,
          [compId, catData.categoryName, catData.categoryDescription, catData.sortOrder]
        );
        catId = catRes.rows[0]?.id;

        if (!catId) {
          const fetchCat = await connectDB.query(
            `SELECT id FROM public.kb_categories WHERE company_id = $1 AND name = $2`,
            [compId, catData.categoryName]
          );
          catId = fetchCat.rows[0]?.id;
        }

        // Insert articles if not already present
        for (const art of catData.articles) {
          const artCheck = await connectDB.query(
            `SELECT id FROM public.kb_articles 
             WHERE company_id = $1 AND question = $2 LIMIT 1`,
            [compId, art.question]
          );

          if (artCheck.rows.length === 0) {
            await connectDB.query(
              `INSERT INTO public.kb_articles (
                company_id, category_id, type, question, answer,
                keywords, language, status, priority, usage_count, is_auto_generated
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, false)`,
              [
                compId,
                catId,
                art.type,
                art.question,
                art.answer,
                art.keywords,
                art.language,
                'published',
                art.priority,
              ]
            );
          }
        }
      }
    }
    console.log('🌱 Knowledge Base Seed Data Synced (10 sample FAQs across 2 categories).');
  } catch (err) {
    console.error('❌ Error seeding sample KB:', err.message);
  }
}
