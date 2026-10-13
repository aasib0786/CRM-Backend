/**
 * Add warehouse_stock table
 * Needed for purchase invoice stock updates, transfers and reports.
 */

exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS public.warehouse_stock (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      item_id uuid NOT NULL,
      quantity numeric(15,3) DEFAULT 0 NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT warehouse_stock_pkey PRIMARY KEY (id),
      CONSTRAINT warehouse_stock_company_warehouse_item_key UNIQUE (company_id, warehouse_id, item_id),
      CONSTRAINT warehouse_stock_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
      CONSTRAINT warehouse_stock_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id),
      CONSTRAINT warehouse_stock_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id)
    );
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS public.warehouse_stock CASCADE;
  `);
};