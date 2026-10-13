/**
 * Knex Migration: Knowledge Base Module (Phase 1)
 * Creates:
 *  - kb_categories: Company-scoped categories with sort_order
 *  - kb_articles: Full knowledge base articles with search_vector (simple config) & GIN index
 *  - kb_unanswered: Lead questions that could not be answered by bot
 *  - Automatic search_vector trigger & Seed FAQs for existing companies
 */

exports.up = async function (knex) {
  await knex.raw(`
    -- 1. kb_categories
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

    -- 2. kb_articles
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

    -- 3. Search vector trigger & GIN Index
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

    -- 4. kb_unanswered
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
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS public.kb_unanswered CASCADE;
    DROP TABLE IF EXISTS public.kb_articles CASCADE;
    DROP TABLE IF EXISTS public.kb_categories CASCADE;
    DROP FUNCTION IF EXISTS public.kb_articles_search_vector_update CASCADE;
  `);
};
