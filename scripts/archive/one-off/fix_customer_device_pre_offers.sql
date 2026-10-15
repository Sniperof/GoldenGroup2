-- Fix: Recreate customer_device_pre_offers table cleanly
-- Baseline migration 001_initial_schema.sql was "adopted" but this table was never created.
-- Run this, then re-run: pnpm --filter @golden-crm/api migrate

BEGIN;

-- Drop existing objects to avoid conflicts
DROP TABLE IF EXISTS public.customer_device_pre_offers CASCADE;
DROP SEQUENCE IF EXISTS public.customer_device_pre_offers_id_seq CASCADE;

-- 1. Sequence
CREATE SEQUENCE public.customer_device_pre_offers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- 2. Table
CREATE TABLE public.customer_device_pre_offers (
    id bigint NOT NULL,
    customer_id integer NOT NULL,
    branch_id integer,
    device_model_id integer NOT NULL,
    offer_type character varying(50) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    total_amount numeric NOT NULL,
    first_payment_amount numeric,
    installment_months integer,
    currency character varying(10) DEFAULT 'SYP'::character varying NOT NULL,
    discount_percentage numeric,
    applied_device_discount_id integer,
    closed_by_employee_id integer,
    no_closing_reason text,
    response_state character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    response_notes text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sale_reference_number character varying(32),
    CONSTRAINT customer_device_pre_offers_discount_percentage_check CHECK (((discount_percentage IS NULL) OR (discount_percentage >= (0)::numeric))),
    CONSTRAINT customer_device_pre_offers_first_payment_amount_check CHECK (((first_payment_amount IS NULL) OR (first_payment_amount >= (0)::numeric))),
    CONSTRAINT customer_device_pre_offers_installment_months_check CHECK (((installment_months IS NULL) OR (installment_months > 0))),
    CONSTRAINT customer_device_pre_offers_offer_type_check CHECK (((offer_type)::text = ANY ((ARRAY['cash'::character varying, 'installment'::character varying])::text[]))),
    CONSTRAINT customer_device_pre_offers_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT customer_device_pre_offers_response_state_check CHECK (((response_state)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'rejected'::character varying, 'extension_requested'::character varying])::text[]))),
    CONSTRAINT customer_device_pre_offers_total_amount_check CHECK ((total_amount >= (0)::numeric))
);

-- 3. Link sequence
ALTER SEQUENCE public.customer_device_pre_offers_id_seq OWNED BY public.customer_device_pre_offers.id;

-- 4. Default for id
ALTER TABLE public.customer_device_pre_offers ALTER COLUMN id SET DEFAULT nextval('public.customer_device_pre_offers_id_seq'::regclass);

-- 5. Primary key
ALTER TABLE public.customer_device_pre_offers ADD CONSTRAINT customer_device_pre_offers_pkey PRIMARY KEY (id);

-- 6. Indexes
CREATE INDEX idx_cdpo_branch ON public.customer_device_pre_offers USING btree (branch_id);
CREATE INDEX idx_cdpo_customer_state ON public.customer_device_pre_offers USING btree (customer_id, response_state, created_at DESC);
CREATE INDEX idx_cdpo_sale_reference_number ON public.customer_device_pre_offers (sale_reference_number) WHERE sale_reference_number IS NOT NULL;

-- 7. Foreign keys
ALTER TABLE public.customer_device_pre_offers
    ADD CONSTRAINT customer_device_pre_offers_applied_device_discount_id_fkey FOREIGN KEY (applied_device_discount_id) REFERENCES public.device_discounts(id) ON DELETE SET NULL;

ALTER TABLE public.customer_device_pre_offers
    ADD CONSTRAINT customer_device_pre_offers_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;

ALTER TABLE public.customer_device_pre_offers
    ADD CONSTRAINT customer_device_pre_offers_closed_by_employee_id_fkey FOREIGN KEY (closed_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.customer_device_pre_offers
    ADD CONSTRAINT customer_device_pre_offers_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.clients(id) ON DELETE CASCADE;

ALTER TABLE public.customer_device_pre_offers
    ADD CONSTRAINT customer_device_pre_offers_device_model_id_fkey FOREIGN KEY (device_model_id) REFERENCES public.device_models(id) ON DELETE RESTRICT;

COMMIT;

-- 8. Mark migration 238 as applied so it won't fail on re-run
INSERT INTO schema_migrations (filename) VALUES ('238_pre_offer_sale_reference_number.sql')
ON CONFLICT (filename) DO NOTHING;
