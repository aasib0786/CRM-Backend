/**
 * Initial Schema Migration - IMSDATABASE
 * Contains all tables, enums, functions and indexes
 * Run: npm run migrate
 */

exports.up = async function (knex) {
  await knex.raw(`

    -- ─────────────────────────────────────────
    -- EXTENSIONS
    -- ─────────────────────────────────────────
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

    -- ─────────────────────────────────────────
    -- ENUM TYPES
    -- ─────────────────────────────────────────
    CREATE TYPE public.adjustment_type_enum AS ENUM ('INCREASE', 'DECREASE');

    CREATE TYPE public.cheque_status_enum AS ENUM (
      'PENDING', 'CLEARED', 'BOUNCED', 'INSUFFICIENT_BALANCE'
    );

    CREATE TYPE public.dse_reason_enum AS ENUM (
      'OPENING', 'AUDIT_FOUND', 'FREE_SAMPLE',
      'RETURNED_NO_INVOICE', 'INTERNAL_FOUND', 'OTHER'
    );

    CREATE TYPE public.gate_pass_purpose_enum AS ENUM (
      'SALE', 'TRANSFER', 'RETURN', 'SAMPLE',
      'OTHER', 'PURCHASE', 'SALE_RETURN', 'TRANSFER_IN'
    );

    CREATE TYPE public.gate_pass_status_enum AS ENUM (
      'OPEN', 'CLOSED', 'RETURNED', 'OVERDUE', 'RECEIVED', 'LINKED'
    );

    CREATE TYPE public.gate_pass_type_enum AS ENUM ('INWARD', 'OUTWARD');

    CREATE TYPE public.gate_pass_verification_enum AS ENUM (
      'PENDING', 'VERIFIED', 'REJECTED'
    );

    CREATE TYPE public.party_type_enum AS ENUM ('Customer', 'Supplier', 'Both');

    CREATE TYPE public.payment_mode_enum AS ENUM (
      'CASH', 'UPI', 'CARD', 'CHEQUE', 'NEFT', 'RTGS'
    );

    CREATE TYPE public.payment_status_enum AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

    CREATE TYPE public.transfer_status_enum AS ENUM (
      'PENDING', 'APPROVED', 'COMPLETED', 'REJECTED'
    );

    CREATE TYPE public.type AS ENUM ('STORE', 'GODOWN');

    CREATE TYPE public.warehouse_type_enum AS ENUM (
      'OFFICE', 'FACTORY', 'STORE', 'GODOWN', 'BRANCH', 'TRANSIT'
    );

    -- ─────────────────────────────────────────
    -- FUNCTIONS
    -- ─────────────────────────────────────────
    CREATE FUNCTION public.set_updated_at() RETURNS trigger
      LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$;

    CREATE FUNCTION public.generate_po_number(p_company_id uuid)
      RETURNS character varying LANGUAGE plpgsql AS $$
    DECLARE
      v_year INT := EXTRACT(YEAR FROM NOW());
      v_seq INT;
    BEGIN
      INSERT INTO po_sequences (company_id, year, last_number)
      VALUES (p_company_id, v_year, 1)
      ON CONFLICT (company_id, year)
      DO UPDATE SET last_number = po_sequences.last_number + 1
      RETURNING last_number INTO v_seq;
      RETURN 'PO-' || v_year || '-' || LPAD(v_seq::TEXT, 3, '0');
    END;
    $$;

    CREATE FUNCTION public.next_adjustment_number(p_company_id uuid)
      RETURNS character varying LANGUAGE plpgsql AS $$
    DECLARE
      new_val BIGINT;
    BEGIN
      INSERT INTO document_sequences (company_id, doc_type, current_value)
      VALUES (p_company_id, 'ADJ', 0)
      ON CONFLICT (company_id, doc_type) DO NOTHING;
      UPDATE document_sequences
      SET current_value = current_value + 1
      WHERE company_id = p_company_id AND doc_type = 'ADJ'
      RETURNING current_value INTO new_val;
      RETURN 'ADJ-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(new_val::TEXT, 4, '0');
    END;
    $$;

    CREATE FUNCTION public.next_dse_number(p_company_id uuid)
      RETURNS character varying LANGUAGE plpgsql AS $$
    DECLARE
      new_val BIGINT;
    BEGIN
      INSERT INTO document_sequences (company_id, doc_type, current_value)
      VALUES (p_company_id, 'DSE', 0)
      ON CONFLICT (company_id, doc_type) DO NOTHING;
      UPDATE document_sequences
      SET current_value = current_value + 1
      WHERE company_id = p_company_id AND doc_type = 'DSE'
      RETURNING current_value INTO new_val;
      RETURN 'DSE-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(new_val::TEXT, 4, '0');
    END;
    $$;

    CREATE FUNCTION public.next_transfer_number(p_company_id uuid)
      RETURNS character varying LANGUAGE plpgsql AS $$
    DECLARE
      new_val BIGINT;
    BEGIN
      INSERT INTO document_sequences (company_id, doc_type, current_value)
      VALUES (p_company_id, 'TRF', 0)
      ON CONFLICT (company_id, doc_type) DO NOTHING;
      UPDATE document_sequences
      SET current_value = current_value + 1
      WHERE company_id = p_company_id AND doc_type = 'TRF'
      RETURNING current_value INTO new_val;
      RETURN 'TRF-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(new_val::TEXT, 4, '0');
    END;
    $$;

    -- ─────────────────────────────────────────
    -- TABLES
    -- ─────────────────────────────────────────

    CREATE TABLE public.companies (
      id uuid NOT NULL,
      name character varying(200) NOT NULL,
      address text,
      gstin character varying(15),
      pan character varying(10),
      state_code character varying(2) NOT NULL,
      logo_url text,
      financial_year_start date NOT NULL,
      invoice_prefix character varying(10) DEFAULT 'INV',
      phone character varying(15),
      email character varying(150),
      bank_name character varying(100),
      bank_account character varying(20),
      bank_ifsc character varying(11),
      website character varying(200),
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now(),
      CONSTRAINT companies_pkey PRIMARY KEY (id)
    );

    CREATE TABLE public.users (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      name character varying(100) NOT NULL,
      email character varying(150) NOT NULL,
      password_hash character varying(255) NOT NULL,
      role character varying(30) NOT NULL,
      is_active boolean DEFAULT true,
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now(),
      CONSTRAINT users_pkey PRIMARY KEY (id),
      CONSTRAINT users_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
    );

    CREATE TABLE public.warehouses (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      name character varying(100) NOT NULL,
      type public.warehouse_type_enum NOT NULL,
      address text,
      city character varying(100),
      state character varying(100),
      pincode character varying(10),
      incharge_user_id uuid,
      is_active boolean DEFAULT true,
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now(),
      CONSTRAINT warehouses_pkey PRIMARY KEY (id),
      CONSTRAINT warehouses_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
      CONSTRAINT warehouses_incharge_user_id_fkey FOREIGN KEY (incharge_user_id) REFERENCES public.users(id)
    );

    CREATE TABLE public.roles (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      name text NOT NULL,
      description text,
      is_active boolean DEFAULT true,
      is_system boolean DEFAULT false,
      permissions jsonb DEFAULT '{}'::jsonb NOT NULL,
      additional_controls jsonb DEFAULT '{}'::jsonb NOT NULL,
      created_by uuid,
      created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT roles_pkey PRIMARY KEY (id),
      CONSTRAINT roles_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
    );

    CREATE TABLE public.user_permissions (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      user_id uuid NOT NULL,
      permission_key character varying(50) NOT NULL,
      granted_by uuid,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT user_permissions_pkey PRIMARY KEY (id),
      CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
    );

    CREATE TABLE public.user_warehouses (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      user_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      is_primary boolean DEFAULT false NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT user_warehouses_pkey PRIMARY KEY (id),
      CONSTRAINT user_warehouses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
      CONSTRAINT user_warehouses_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id)
    );

    CREATE TABLE public.categories (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      name character varying(100) NOT NULL,
      parent_id uuid,
      requires_narration boolean DEFAULT false,
      created_at timestamp with time zone DEFAULT now(),
      created_by uuid,
      CONSTRAINT categories_pkey PRIMARY KEY (id),
      CONSTRAINT categories_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
    );

    CREATE TABLE public.units (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      name character varying(50) NOT NULL,
      short_name character varying(10) NOT NULL,
      is_active boolean DEFAULT true,
      created_at timestamp with time zone DEFAULT now(),
      created_by uuid,
      CONSTRAINT units_pkey PRIMARY KEY (id),
      CONSTRAINT units_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
    );

    CREATE TABLE public.parties (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      name character varying(200) NOT NULL,
      type public.party_type_enum NOT NULL,
      phone character varying(15),
      email character varying(150),
      gstin character varying(15),
      pan character varying(10),
      address text,
      city character varying(100),
      state character varying(100),
      state_code character varying(2),
      pincode character varying(10),
      opening_balance numeric(15,2) DEFAULT 0,
      balance_type character varying(10) DEFAULT 'DEBIT',
      is_active boolean DEFAULT true,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now(),
      CONSTRAINT parties_pkey PRIMARY KEY (id),
      CONSTRAINT parties_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
    );

    CREATE TABLE public.items (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      name character varying(200) NOT NULL,
      sku character varying(100),
      barcode character varying(100),
      hsn_code character varying(20),
      category_id uuid,
      unit_id uuid,
      purchase_rate numeric(15,2) DEFAULT 0,
      sale_rate numeric(15,2) DEFAULT 0,
      mrp numeric(15,2) DEFAULT 0,
      tax_rate numeric(5,2) DEFAULT 0,
      min_stock numeric(15,3) DEFAULT 0,
      is_active boolean DEFAULT true,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now(),
      CONSTRAINT items_pkey PRIMARY KEY (id),
      CONSTRAINT items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
      CONSTRAINT items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id),
      CONSTRAINT items_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id)
    );

    CREATE TABLE public.barcode_settings (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      format character varying(20) DEFAULT 'CODE128',
      length integer DEFAULT 13,
      prefix character varying(10) DEFAULT '',
      starting_number bigint DEFAULT 1,
      last_used_number bigint DEFAULT 0,
      created_at timestamp without time zone DEFAULT now(),
      updated_at timestamp without time zone DEFAULT now(),
      CONSTRAINT barcode_settings_pkey PRIMARY KEY (id),
      CONSTRAINT barcode_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
    );

    CREATE TABLE public.document_sequences (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      doc_type character varying(20) NOT NULL,
      current_value bigint DEFAULT 0 NOT NULL,
      prefix character varying(10) DEFAULT '' NOT NULL,
      start_no bigint DEFAULT 1001 NOT NULL,
      CONSTRAINT document_sequences_pkey PRIMARY KEY (id),
      CONSTRAINT document_sequences_company_id_doc_type_key UNIQUE (company_id, doc_type)
    );

    CREATE TABLE public.po_sequences (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      year integer NOT NULL,
      last_number integer DEFAULT 0 NOT NULL,
      CONSTRAINT po_sequences_pkey PRIMARY KEY (id),
      CONSTRAINT po_sequences_company_id_year_key UNIQUE (company_id, year)
    );

    CREATE TABLE public.challans (
      id uuid NOT NULL,
      company_id uuid NOT NULL,
      customer_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      challan_number character varying(50) NOT NULL,
      challan_date date NOT NULL,
      vehicle_no character varying(50),
      driver_name character varying(100),
      lr_no character varying(100),
      status character varying(20) DEFAULT 'SAVED' NOT NULL,
      converted_to_invoice boolean DEFAULT false NOT NULL,
      notes text,
      is_active boolean DEFAULT true NOT NULL,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT challans_pkey PRIMARY KEY (id),
      CONSTRAINT challans_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
      CONSTRAINT challans_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.parties(id),
      CONSTRAINT challans_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id)
    );

    CREATE TABLE public.challan_items (
      id uuid NOT NULL,
      challan_id uuid NOT NULL,
      item_id uuid NOT NULL,
      quantity numeric(14,2) DEFAULT 0 NOT NULL,
      unit character varying(20) DEFAULT 'Pcs' NOT NULL,
      rate numeric(14,2) DEFAULT 0 NOT NULL,
      amount numeric(14,2) DEFAULT 0 NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT challan_items_pkey PRIMARY KEY (id),
      CONSTRAINT challan_items_challan_id_fkey FOREIGN KEY (challan_id) REFERENCES public.challans(id),
      CONSTRAINT challan_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id)
    );

    CREATE TABLE public.customer_credits (
      id uuid NOT NULL,
      company_id uuid NOT NULL,
      customer_id uuid NOT NULL,
      sale_return_id uuid NOT NULL,
      amount numeric(14,2) DEFAULT 0 NOT NULL,
      is_used boolean DEFAULT false NOT NULL,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT customer_credits_pkey PRIMARY KEY (id)
    );

    CREATE TABLE public.direct_stock_entries (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      dse_number character varying(50) NOT NULL,
      entry_date date DEFAULT CURRENT_DATE NOT NULL,
      reason public.dse_reason_enum NOT NULL,
      custom_reason text,
      reference_no character varying(100),
      notes text,
      total_qty numeric(15,3) DEFAULT 0 NOT NULL,
      total_value numeric(15,2) DEFAULT 0 NOT NULL,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT direct_stock_entries_pkey PRIMARY KEY (id)
    );

    CREATE TABLE public.direct_stock_entry_items (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      dse_id uuid NOT NULL,
      item_id uuid NOT NULL,
      quantity numeric(15,3) NOT NULL,
      unit_name character varying(50),
      rate numeric(15,2) DEFAULT 0 NOT NULL,
      total numeric(15,2) GENERATED ALWAYS AS (quantity * rate) STORED,
      CONSTRAINT direct_stock_entry_items_pkey PRIMARY KEY (id),
      CONSTRAINT direct_stock_entry_items_quantity_check CHECK (quantity > 0),
      CONSTRAINT direct_stock_entry_items_dse_id_fkey FOREIGN KEY (dse_id) REFERENCES public.direct_stock_entries(id),
      CONSTRAINT direct_stock_entry_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id)
    );

    CREATE TABLE public.gate_passes (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      gp_number character varying(50) NOT NULL,
      type public.gate_pass_type_enum NOT NULL,
      status public.gate_pass_status_enum NOT NULL,
      verification_status public.gate_pass_verification_enum DEFAULT 'PENDING' NOT NULL,
      purpose public.gate_pass_purpose_enum NOT NULL,
      custom_purpose text,
      party_name character varying(200) NOT NULL,
      vehicle_number character varying(50) NOT NULL,
      driver_name character varying(100),
      driver_phone character varying(20),
      security_guard character varying(100) NOT NULL,
      authorised_by character varying(100) NOT NULL,
      received_by character varying(100),
      is_returnable boolean DEFAULT false NOT NULL,
      expected_return_date date,
      linked_doc_type character varying(20),
      linked_doc_number character varying(50),
      is_recreated boolean DEFAULT false NOT NULL,
      notes text,
      date date DEFAULT CURRENT_DATE NOT NULL,
      "time" time without time zone DEFAULT CURRENT_TIME NOT NULL,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now(),
      returned_date date,
      rejection_reason text,
      original_gp_id uuid,
      is_deleted boolean DEFAULT false,
      CONSTRAINT gate_passes_pkey PRIMARY KEY (id)
    );

    CREATE TABLE public.gate_pass_items (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      gp_id uuid NOT NULL,
      item_name character varying(200) NOT NULL,
      qty numeric(18,3) NOT NULL,
      unit character varying(50) DEFAULT 'Pcs' NOT NULL,
      description text,
      CONSTRAINT gate_pass_items_pkey PRIMARY KEY (id),
      CONSTRAINT gate_pass_items_qty_check CHECK (qty > 0),
      CONSTRAINT gate_pass_items_gp_id_fkey FOREIGN KEY (gp_id) REFERENCES public.gate_passes(id)
    );

    CREATE TABLE public.grns (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      supplier_id uuid,
      grn_number character varying(50) NOT NULL,
      date date DEFAULT CURRENT_DATE NOT NULL,
      status character varying(15) DEFAULT 'CONFIRMED' NOT NULL,
      total_qty numeric(15,3) DEFAULT 0,
      total_value numeric(15,2) DEFAULT 0,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT grns_pkey PRIMARY KEY (id),
      CONSTRAINT grns_status_check CHECK (status = ANY (ARRAY['CONFIRMED', 'INVOICED'])),
      CONSTRAINT grns_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
      CONSTRAINT grns_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id),
      CONSTRAINT grns_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.parties(id)
    );

    CREATE TABLE public.grn_items (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      grn_id uuid NOT NULL,
      item_id uuid,
      po_id uuid,
      po_number character varying(50),
      hsn_code character varying(20),
      quantity numeric(15,3) NOT NULL,
      unit_name character varying(50),
      rate numeric(15,2) DEFAULT 0,
      total numeric(15,2) GENERATED ALWAYS AS (quantity * rate) STORED,
      barcode character varying(100),
      company_barcode character varying(100),
      CONSTRAINT grn_items_pkey PRIMARY KEY (id),
      CONSTRAINT grn_items_quantity_check CHECK (quantity > 0),
      CONSTRAINT grn_items_grn_id_fkey FOREIGN KEY (grn_id) REFERENCES public.grns(id)
    );

    CREATE TABLE public.purchase_orders (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      warehouse_id uuid,
      supplier_id uuid NOT NULL,
      po_number character varying(50) NOT NULL,
      po_date date DEFAULT CURRENT_DATE NOT NULL,
      expected_delivery date,
      status character varying(20) DEFAULT 'PENDING' NOT NULL,
      priority character varying(10) DEFAULT 'NORMAL' NOT NULL,
      billing_address text,
      delivery_address text,
      payment_terms character varying(50),
      terms_conditions text,
      notes text,
      total_amount numeric(15,2) DEFAULT 0,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now(),
      CONSTRAINT purchase_orders_pkey PRIMARY KEY (id),
      CONSTRAINT purchase_orders_priority_check CHECK (priority = ANY (ARRAY['LOW','NORMAL','HIGH','URGENT'])),
      CONSTRAINT purchase_orders_status_check CHECK (status = ANY (ARRAY['PENDING','PARTIAL','COMPLETED','CANCELLED'])),
      CONSTRAINT purchase_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
      CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.parties(id)
    );

    CREATE TABLE public.purchase_order_items (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      po_id uuid NOT NULL,
      item_id uuid,
      item_name character varying(200),
      hsn_code character varying(8),
      ordered_qty numeric(15,3) NOT NULL,
      received_qty numeric(15,3) DEFAULT 0 NOT NULL,
      pending_qty numeric(15,3) GENERATED ALWAYS AS (ordered_qty - received_qty) STORED,
      unit_id uuid,
      unit_name character varying(50),
      rate numeric(15,2) NOT NULL,
      gst_rate numeric(5,2) DEFAULT 0,
      amount numeric(15,2) GENERATED ALWAYS AS (ordered_qty * rate) STORED,
      sort_order integer DEFAULT 0,
      size_color character varying(100),
      group_name character varying(100),
      brand character varying(100),
      article_no character varying(50),
      created_at timestamp with time zone DEFAULT now(),
      CONSTRAINT purchase_order_items_pkey PRIMARY KEY (id),
      CONSTRAINT purchase_order_items_ordered_qty_check CHECK (ordered_qty > 0),
      CONSTRAINT purchase_order_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id)
    );

    CREATE TABLE public.purchase_invoices (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      supplier_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      grn_id uuid,
      invoice_number character varying(50) NOT NULL,
      invoice_date date NOT NULL,
      due_date date,
      total_amount numeric(15,2) DEFAULT 0 NOT NULL,
      paid_amount numeric(15,2) DEFAULT 0 NOT NULL,
      balance_due numeric(15,2) DEFAULT 0 NOT NULL,
      payment_status public.payment_status_enum DEFAULT 'UNPAID' NOT NULL,
      notes text,
      is_active boolean DEFAULT true,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT purchase_invoices_pkey PRIMARY KEY (id),
      CONSTRAINT purchase_invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
      CONSTRAINT purchase_invoices_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.parties(id),
      CONSTRAINT purchase_invoices_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id),
      CONSTRAINT purchase_invoices_grn_id_fkey FOREIGN KEY (grn_id) REFERENCES public.grns(id) ON DELETE SET NULL,
      CONSTRAINT purchase_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
    );

    CREATE TABLE public.purchase_invoice_items (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      invoice_id uuid NOT NULL,
      item_id uuid NOT NULL,
      unit_id uuid,
      item_name character varying(200) NOT NULL,
      hsn_code character varying(8),
      unit_name character varying(50),
      quantity numeric(15,3) NOT NULL,
      rate numeric(15,2) NOT NULL,
      gst_rate numeric(5,2) DEFAULT 0,
      amount numeric(15,2) DEFAULT 0 NOT NULL,
      CONSTRAINT purchase_invoice_items_pkey PRIMARY KEY (id),
      CONSTRAINT purchase_invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.purchase_invoices(id),
      CONSTRAINT purchase_invoice_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id),
      CONSTRAINT purchase_invoice_items_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id)
    );

    CREATE TABLE public.purchase_payments (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      invoice_id uuid NOT NULL,
      supplier_id uuid NOT NULL,
      voucher_number character varying(50) NOT NULL,
      date date DEFAULT CURRENT_DATE NOT NULL,
      payment_amount numeric(15,2) NOT NULL,
      payment_mode public.payment_mode_enum NOT NULL,
      reference_no character varying(100),
      card_last_four character(4),
      bank_name character varying(100),
      cheque_no character varying(50),
      cheque_date date,
      cheque_status public.cheque_status_enum,
      bounce_reason text,
      notes text,
      type character varying(10) DEFAULT 'PAYMENT',
      created_by uuid NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now(),
      CONSTRAINT purchase_payments_pkey PRIMARY KEY (id),
      CONSTRAINT purchase_payments_payment_amount_check CHECK (payment_amount > 0),
      CONSTRAINT purchase_payments_type_check CHECK (type = ANY (ARRAY['PAYMENT','REFUND'])),
      CONSTRAINT chk_cheque_status_only_for_cheque CHECK (payment_mode = 'CHEQUE'::public.payment_mode_enum OR cheque_status IS NULL),
      CONSTRAINT purchase_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.purchase_invoices(id) ON DELETE RESTRICT,
      CONSTRAINT purchase_payments_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.parties(id) ON DELETE RESTRICT,
      CONSTRAINT purchase_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
    );

    CREATE TABLE public.purchase_returns (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      original_invoice_id uuid NOT NULL,
      supplier_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      return_number character varying(50) NOT NULL,
      date date DEFAULT CURRENT_DATE NOT NULL,
      total_amount numeric(15,2) DEFAULT 0 NOT NULL,
      reason text,
      payment_handled boolean DEFAULT false NOT NULL,
      payment_type character varying(10),
      refund_mode character varying(10),
      refund_reference character varying(100),
      refund_date date,
      credit_is_used boolean DEFAULT false NOT NULL,
      credit_used_on_invoice_id uuid,
      credit_used_at timestamp with time zone,
      created_by uuid NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT purchase_returns_pkey PRIMARY KEY (id),
      CONSTRAINT purchase_returns_payment_type_check CHECK (payment_type = ANY (ARRAY['credit','refund'])),
      CONSTRAINT purchase_returns_original_invoice_id_fkey FOREIGN KEY (original_invoice_id) REFERENCES public.purchase_invoices(id) ON DELETE RESTRICT,
      CONSTRAINT purchase_returns_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.parties(id) ON DELETE RESTRICT,
      CONSTRAINT purchase_returns_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT,
      CONSTRAINT purchase_returns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
    );

    CREATE TABLE public.purchase_return_items (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      return_id uuid NOT NULL,
      item_id uuid NOT NULL,
      unit_id uuid,
      item_name character varying(200) NOT NULL,
      hsn_code character varying(8),
      unit_name character varying(50),
      return_qty numeric(15,3) NOT NULL,
      rate numeric(15,2) NOT NULL,
      amount numeric(15,2) DEFAULT 0 NOT NULL,
      reason text,
      CONSTRAINT purchase_return_items_pkey PRIMARY KEY (id),
      CONSTRAINT purchase_return_items_return_qty_check CHECK (return_qty > 0),
      CONSTRAINT purchase_return_items_rate_check CHECK (rate >= 0),
      CONSTRAINT purchase_return_items_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
      CONSTRAINT purchase_return_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE RESTRICT,
      CONSTRAINT purchase_return_items_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL
    );

    CREATE TABLE public.sales_invoices (
      id uuid NOT NULL,
      company_id uuid NOT NULL,
      customer_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      invoice_number character varying(50) NOT NULL,
      invoice_date date NOT NULL,
      billing_address text,
      shipping_address text,
      payment_mode character varying(20) NOT NULL,
      amount_received numeric(14,2) DEFAULT 0 NOT NULL,
      total_amount numeric(14,2) DEFAULT 0 NOT NULL,
      paid_amount numeric(14,2) DEFAULT 0 NOT NULL,
      balance_due numeric(14,2) DEFAULT 0 NOT NULL,
      payment_status character varying(20) DEFAULT 'UNPAID' NOT NULL,
      status character varying(20) DEFAULT 'SAVED' NOT NULL,
      notes text,
      is_active boolean DEFAULT true NOT NULL,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT sales_invoices_pkey PRIMARY KEY (id),
      CONSTRAINT sales_invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
      CONSTRAINT sales_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.parties(id),
      CONSTRAINT sales_invoices_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id)
    );

    CREATE TABLE public.sales_invoice_items (
      id uuid NOT NULL,
      sales_invoice_id uuid NOT NULL,
      item_id uuid NOT NULL,
      quantity numeric(14,2) DEFAULT 0 NOT NULL,
      unit character varying(20) DEFAULT 'Pcs' NOT NULL,
      unit_id uuid,
      rate numeric(14,2) DEFAULT 0 NOT NULL,
      discount numeric(14,2) DEFAULT 0 NOT NULL,
      taxable_amount numeric(14,2) DEFAULT 0 NOT NULL,
      tax_rate numeric(14,2) DEFAULT 0 NOT NULL,
      cgst numeric(14,2) DEFAULT 0 NOT NULL,
      sgst numeric(14,2) DEFAULT 0 NOT NULL,
      igst numeric(14,2) DEFAULT 0 NOT NULL,
      total numeric(14,2) DEFAULT 0 NOT NULL,
      hsn_code character varying(50),
      narration text,
      category_id uuid,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT sales_invoice_items_pkey PRIMARY KEY (id),
      CONSTRAINT sales_invoice_items_invoice_id_fkey FOREIGN KEY (sales_invoice_id) REFERENCES public.sales_invoices(id),
      CONSTRAINT sales_invoice_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id)
    );

    CREATE TABLE public.sales_payments (
      id uuid NOT NULL,
      company_id uuid NOT NULL,
      invoice_id uuid NOT NULL,
      receipt_number character varying(50) NOT NULL,
      payment_date date NOT NULL,
      payment_amount numeric(14,2) NOT NULL,
      payment_mode character varying(20) NOT NULL,
      reference_no character varying(120),
      card_last_four character varying(4),
      bank_name character varying(120),
      cheque_no character varying(80),
      cheque_date date,
      cheque_status character varying(30),
      bounce_reason text,
      notes text,
      is_active boolean DEFAULT true NOT NULL,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT sales_payments_pkey PRIMARY KEY (id),
      CONSTRAINT sales_payments_payment_amount_check CHECK (payment_amount > 0),
      CONSTRAINT sales_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.sales_invoices(id) ON DELETE CASCADE
    );

    CREATE TABLE public.sale_returns (
      id uuid NOT NULL,
      company_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      customer_id uuid NOT NULL,
      original_invoice_id uuid NOT NULL,
      return_number character varying(50) NOT NULL,
      return_date date NOT NULL,
      total_amount numeric(14,2) DEFAULT 0 NOT NULL,
      payment_handled boolean DEFAULT false NOT NULL,
      payment_type character varying(20),
      refund_id uuid,
      notes text,
      is_active boolean DEFAULT true NOT NULL,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT sale_returns_pkey PRIMARY KEY (id)
    );

    CREATE TABLE public.sale_return_items (
      id uuid NOT NULL,
      sale_return_id uuid NOT NULL,
      item_id uuid NOT NULL,
      return_qty numeric(14,3) NOT NULL,
      rate numeric(14,2) DEFAULT 0 NOT NULL,
      reason text,
      custom_reason text,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT sale_return_items_pkey PRIMARY KEY (id),
      CONSTRAINT sale_return_items_return_qty_check CHECK (return_qty > 0),
      CONSTRAINT sale_return_items_sale_return_id_fkey FOREIGN KEY (sale_return_id) REFERENCES public.sale_returns(id) ON DELETE CASCADE
    );

    CREATE TABLE public.refunds_given (
      id uuid NOT NULL,
      company_id uuid NOT NULL,
      sale_return_id uuid NOT NULL,
      customer_id uuid NOT NULL,
      refund_number character varying(50) NOT NULL,
      payment_mode character varying(20) NOT NULL,
      amount numeric(14,2) DEFAULT 0 NOT NULL,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT refunds_given_pkey PRIMARY KEY (id)
    );

    CREATE TABLE public.stock_adjustments (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      item_id uuid NOT NULL,
      adjustment_number character varying(50),
      adjustment_date date DEFAULT CURRENT_DATE NOT NULL,
      type public.adjustment_type_enum NOT NULL,
      quantity numeric(15,3) NOT NULL,
      reason text NOT NULL,
      created_by uuid,
      approved_by uuid,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT stock_adjustments_pkey PRIMARY KEY (id),
      CONSTRAINT stock_adjustments_quantity_check CHECK (quantity > 0),
      CONSTRAINT stock_adjustments_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id),
      CONSTRAINT stock_adjustments_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id),
      CONSTRAINT stock_adjustments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id),
      CONSTRAINT stock_adjustments_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id)
    );

    CREATE TABLE public.stock_movements (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      item_id uuid NOT NULL,
      movement_type character varying(30) NOT NULL,
      quantity numeric(14,2) DEFAULT 0 NOT NULL,
      reference_type character varying(50),
      reference_id uuid,
      reference_number character varying(100),
      created_by uuid,
      notes text,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT stock_movements_pkey PRIMARY KEY (id)
    );

    CREATE TABLE public.stock_transfers (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      company_id uuid NOT NULL,
      from_warehouse_id uuid NOT NULL,
      to_warehouse_id uuid NOT NULL,
      transfer_number character varying(50) NOT NULL,
      transfer_date date DEFAULT CURRENT_DATE NOT NULL,
      status public.transfer_status_enum DEFAULT 'PENDING' NOT NULL,
      notes text,
      created_by uuid,
      approved_by uuid,
      approved_at timestamp with time zone,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT stock_transfers_pkey PRIMARY KEY (id),
      CONSTRAINT chk_different_warehouses CHECK (from_warehouse_id <> to_warehouse_id),
      CONSTRAINT stock_transfers_from_warehouse_id_fkey FOREIGN KEY (from_warehouse_id) REFERENCES public.warehouses(id),
      CONSTRAINT stock_transfers_to_warehouse_id_fkey FOREIGN KEY (to_warehouse_id) REFERENCES public.warehouses(id),
      CONSTRAINT stock_transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id),
      CONSTRAINT stock_transfers_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id)
    );

    CREATE TABLE public.stock_transfer_items (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      transfer_id uuid NOT NULL,
      item_id uuid NOT NULL,
      quantity numeric(15,3) NOT NULL,
      CONSTRAINT stock_transfer_items_pkey PRIMARY KEY (id),
      CONSTRAINT stock_transfer_items_quantity_check CHECK (quantity > 0),
      CONSTRAINT stock_transfer_items_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
      CONSTRAINT stock_transfer_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id)
    );

  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS public.stock_transfer_items CASCADE;
    DROP TABLE IF EXISTS public.stock_transfers CASCADE;
    DROP TABLE IF EXISTS public.stock_movements CASCADE;
    DROP TABLE IF EXISTS public.stock_adjustments CASCADE;
    DROP TABLE IF EXISTS public.refunds_given CASCADE;
    DROP TABLE IF EXISTS public.sale_return_items CASCADE;
    DROP TABLE IF EXISTS public.sale_returns CASCADE;
    DROP TABLE IF EXISTS public.sales_payments CASCADE;
    DROP TABLE IF EXISTS public.sales_invoice_items CASCADE;
    DROP TABLE IF EXISTS public.sales_invoices CASCADE;
    DROP TABLE IF EXISTS public.purchase_return_items CASCADE;
    DROP TABLE IF EXISTS public.purchase_returns CASCADE;
    DROP TABLE IF EXISTS public.purchase_payments CASCADE;
    DROP TABLE IF EXISTS public.purchase_invoice_items CASCADE;
    DROP TABLE IF EXISTS public.purchase_invoices CASCADE;
    DROP TABLE IF EXISTS public.purchase_order_items CASCADE;
    DROP TABLE IF EXISTS public.purchase_orders CASCADE;
    DROP TABLE IF EXISTS public.grn_items CASCADE;
    DROP TABLE IF EXISTS public.grns CASCADE;
    DROP TABLE IF EXISTS public.gate_pass_items CASCADE;
    DROP TABLE IF EXISTS public.gate_passes CASCADE;
    DROP TABLE IF EXISTS public.direct_stock_entry_items CASCADE;
    DROP TABLE IF EXISTS public.direct_stock_entries CASCADE;
    DROP TABLE IF EXISTS public.document_sequences CASCADE;
    DROP TABLE IF EXISTS public.po_sequences CASCADE;
    DROP TABLE IF EXISTS public.customer_credits CASCADE;
    DROP TABLE IF EXISTS public.challan_items CASCADE;
    DROP TABLE IF EXISTS public.challans CASCADE;
    DROP TABLE IF EXISTS public.barcode_settings CASCADE;
    DROP TABLE IF EXISTS public.items CASCADE;
    DROP TABLE IF EXISTS public.parties CASCADE;
    DROP TABLE IF EXISTS public.units CASCADE;
    DROP TABLE IF EXISTS public.categories CASCADE;
    DROP TABLE IF EXISTS public.user_warehouses CASCADE;
    DROP TABLE IF EXISTS public.user_permissions CASCADE;
    DROP TABLE IF EXISTS public.roles CASCADE;
    DROP TABLE IF EXISTS public.warehouses CASCADE;
    DROP TABLE IF EXISTS public.users CASCADE;
    DROP TABLE IF EXISTS public.companies CASCADE;

    DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;
    DROP FUNCTION IF EXISTS public.generate_po_number(uuid) CASCADE;
    DROP FUNCTION IF EXISTS public.next_adjustment_number(uuid) CASCADE;
    DROP FUNCTION IF EXISTS public.next_dse_number(uuid) CASCADE;
    DROP FUNCTION IF EXISTS public.next_transfer_number(uuid) CASCADE;

    DROP TYPE IF EXISTS public.stock_transfer_status_enum CASCADE;
    DROP TYPE IF EXISTS public.transfer_status_enum CASCADE;
    DROP TYPE IF EXISTS public.payment_status_enum CASCADE;
    DROP TYPE IF EXISTS public.payment_mode_enum CASCADE;
    DROP TYPE IF EXISTS public.party_type_enum CASCADE;
    DROP TYPE IF EXISTS public.gate_pass_verification_enum CASCADE;
    DROP TYPE IF EXISTS public.gate_pass_type_enum CASCADE;
    DROP TYPE IF EXISTS public.gate_pass_status_enum CASCADE;
    DROP TYPE IF EXISTS public.gate_pass_purpose_enum CASCADE;
    DROP TYPE IF EXISTS public.dse_reason_enum CASCADE;
    DROP TYPE IF EXISTS public.cheque_status_enum CASCADE;
    DROP TYPE IF EXISTS public.adjustment_type_enum CASCADE;
    DROP TYPE IF EXISTS public.warehouse_type_enum CASCADE;
    DROP TYPE IF EXISTS public.type CASCADE;

    DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;
    DROP EXTENSION IF EXISTS pgcrypto CASCADE;
  `);
};
