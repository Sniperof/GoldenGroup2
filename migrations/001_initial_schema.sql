-- Golden CRM pre-launch baseline migration
-- Generated from local golden_crm_dev on 2026-06-01.
-- Contains schema plus reference seed data only; operational/customer data is intentionally excluded.

--
-- PostgreSQL database dump
--


-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auto_create_installed_device(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_create_installed_device() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM auto_create_installed_device_for(NEW.id);
  RETURN NEW;
END;
$$;


--
-- Name: auto_create_installed_device_for(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_create_installed_device_for(p_contract_id integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_device_id INTEGER;
  v_customer_id INTEGER;
  v_branch_id   INTEGER;
  v_model_id    INTEGER;
  v_model_name  VARCHAR;
BEGIN
  SELECT customer_id, branch_id, device_model_id, device_model_name
    INTO v_customer_id, v_branch_id, v_model_id, v_model_name
    FROM contracts WHERE id = p_contract_id;

  INSERT INTO installed_devices (
    contract_id, customer_id, branch_id,
    device_model_id, device_model_name,
    status
  ) VALUES (
    p_contract_id, v_customer_id, v_branch_id,
    v_model_id, v_model_name,
    'pending_delivery'
  )
  RETURNING id INTO v_device_id;

  UPDATE contracts SET installed_device_id = v_device_id WHERE id = p_contract_id;
  RETURN v_device_id;
END;
$$;


--
-- Name: clone_role_templates_to_branch(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clone_role_templates_to_branch(target_branch integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  tmpl     RECORD;
  new_id   INTEGER;
  cloned   INTEGER := 0;
BEGIN
  FOR tmpl IN
    SELECT id, name, display_name, description, is_system, is_active
      FROM roles
     WHERE is_template = TRUE
  LOOP
    IF EXISTS (
      SELECT 1 FROM roles
       WHERE branch_id = target_branch
         AND name      = tmpl.name
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO roles (
      name, display_name, description, is_system, is_active,
      branch_id, is_template, template_id
    )
    VALUES (
      tmpl.name, tmpl.display_name, tmpl.description, tmpl.is_system, tmpl.is_active,
      target_branch, FALSE, tmpl.id
    )
    RETURNING id INTO new_id;

    INSERT INTO role_permissions (role_id, permission_id)
    SELECT new_id, rp.permission_id
      FROM role_permissions rp
     WHERE rp.role_id = tmpl.id
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
    SELECT new_id, rpg.permission_id, rpg.scope_type
      FROM role_permission_grants rpg
     WHERE rpg.role_id = tmpl.id
    ON CONFLICT (role_id, permission_id) DO UPDATE
      SET scope_type = EXCLUDED.scope_type,
          updated_at = NOW();

    cloned := cloned + 1;
  END LOOP;

  RETURN cloned;
END;
$$;


--
-- Name: fn_set_contract_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_set_contract_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.contract_number IS NULL OR NEW.contract_number = '' THEN
    NEW.contract_number := 'C-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nextval('contract_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: materialize_device_on_activation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.materialize_device_on_activation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_device_id INTEGER;
BEGIN
  -- Skip if a device row already exists (legacy contracts or re-activation).
  SELECT id INTO v_device_id
    FROM installed_devices
    WHERE contract_id = NEW.id
    LIMIT 1;

  IF v_device_id IS NULL THEN
    -- Reuse the existing creator function for symmetry with INSERT path.
    PERFORM auto_create_installed_device_for(NEW.id);
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: recompute_contract_completion(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_contract_completion(p_contract_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_total      INTEGER;
  v_paid       INTEGER;
  v_status     VARCHAR(50);
BEGIN
  IF p_contract_id IS NULL THEN RETURN; END IF;

  SELECT status INTO v_status FROM contracts WHERE id = p_contract_id;
  -- Only auto-advance from `active`; never override draft/cancelled/discarded.
  IF v_status <> 'active' THEN RETURN; END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status = 'paid')
    INTO v_total, v_paid
    FROM contract_installments
    WHERE contract_id = p_contract_id;

  -- A contract with zero installments is cash-up-front; we don't auto-complete
  -- it from here â€” that's the caller's responsibility on the cash sale path.
  IF v_total > 0 AND v_total = v_paid THEN
    UPDATE contracts SET status = 'completed' WHERE id = p_contract_id AND status = 'active';
  END IF;
END;
$$;


--
-- Name: recompute_installment_balance(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_installment_balance(p_installment_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_amount       NUMERIC;
  v_due_date     DATE;
  v_contract_id  INTEGER;
  v_status_c     VARCHAR(50);
  v_paid         NUMERIC;
  v_remaining    NUMERIC;
  v_status       VARCHAR(50);
BEGIN
  IF p_installment_id IS NULL THEN RETURN; END IF;

  SELECT i.amount_syp, i.due_date, i.contract_id, c.status
    INTO v_amount, v_due_date, v_contract_id, v_status_c
    FROM contract_installments i
    JOIN contracts c ON c.id = i.contract_id
    WHERE i.id = p_installment_id;

  IF v_amount IS NULL THEN RETURN; END IF;

  -- Constitution rule: draft contracts have no financial effect.
  -- Payments saved while drafting are stored but do not flip installments.
  IF v_status_c IN ('draft', 'discarded') THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
           CASE WHEN entry_type = 'refund' THEN -amount_syp ELSE amount_syp END
         ), 0)
    INTO v_paid
    FROM contract_payment_entries
    WHERE installment_id = p_installment_id;

  v_remaining := GREATEST(v_amount - v_paid, 0);

  v_status := CASE
    WHEN v_remaining <= 0                              THEN 'paid'
    WHEN v_paid > 0 AND v_remaining > 0                THEN 'partial'
    WHEN v_paid <= 0 AND v_due_date < CURRENT_DATE     THEN 'overdue'
    ELSE 'pending'
  END;

  UPDATE contract_installments
     SET paid_amount       = v_paid,
         remaining_balance = v_remaining,
         status            = v_status
   WHERE id = p_installment_id;
END;
$$;


--
-- Name: replay_recompute_on_activation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replay_recompute_on_activation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_inst RECORD;
BEGIN
  FOR v_inst IN SELECT id FROM contract_installments WHERE contract_id = NEW.id LOOP
    PERFORM recompute_installment_balance(v_inst.id);
  END LOOP;
  RETURN NULL;
END;
$$;


--
-- Name: set_device_warranties_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_device_warranties_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


--
-- Name: set_installed_devices_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_installed_devices_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


--
-- Name: set_service_agreements_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_service_agreements_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


--
-- Name: sync_device_warranty_is_active(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_device_warranty_is_active() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.is_active := (NEW.status = 'active');
  RETURN NEW;
END;
$$;


--
-- Name: trg_cascade_warranty_activation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_cascade_warranty_activation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_months INTEGER;
  v_end    DATE;
BEGIN
  -- Only when activated_at just became non-null.
  IF NEW.activated_at IS NOT NULL
     AND OLD.activated_at IS DISTINCT FROM NEW.activated_at THEN

    -- For each contract warranty on this device, snapshot the activation
    -- instant and recompute end_date from months (if available).
    UPDATE device_warranties dw
       SET activated_at = NEW.activated_at,
           status       = 'active',
           start_date   = COALESCE(start_date, NEW.activated_at::date),
           end_date     = CASE
             WHEN dw.months IS NOT NULL AND dw.months > 0
               THEN (NEW.activated_at::date + (dw.months || ' months')::interval)::date
             ELSE dw.end_date
           END
     WHERE dw.device_id     = NEW.id
       AND dw.warranty_type = 'contract'
       AND dw.status IN ('pending', 'active'); -- never resurrect cancelled/expired
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: trg_installed_device_activation_snapshot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_installed_device_activation_snapshot() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Only act on the first transition into 'active'.
  IF NEW.status = 'active'
     AND (OLD.status IS DISTINCT FROM 'active')
     AND NEW.activated_at IS NULL THEN
    NEW.activated_at := v_now;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: trg_installment_status_check_completion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_installment_status_check_completion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    PERFORM recompute_contract_completion(NEW.contract_id);
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: trg_payment_entry_recompute(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_payment_entry_recompute() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Recompute the new target (INSERT, UPDATE-to)
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.installment_id IS NOT NULL THEN
    PERFORM recompute_installment_balance(NEW.installment_id);
  END IF;

  -- Recompute the old target if it changed or got deleted
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') AND OLD.installment_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.installment_id IS DISTINCT FROM NEW.installment_id) THEN
    PERFORM recompute_installment_balance(OLD.installment_id);
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: trg_warranty_on_contract_cancel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_warranty_on_contract_cancel() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_device_id   INTEGER;
  v_dev_status  VARCHAR(50);
  v_unsettled   INTEGER;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    SELECT id, status INTO v_device_id, v_dev_status
      FROM installed_devices
      WHERE contract_id = NEW.id
      LIMIT 1;

    IF v_device_id IS NULL OR v_dev_status <> 'active' THEN
      RETURN NULL;
    END IF;

    SELECT COUNT(*) INTO v_unsettled
      FROM contract_installments
      WHERE contract_id = NEW.id
        AND remaining_balance > 0;

    IF v_unsettled = 0 THEN
      -- Receivables fully settled â€” leave the warranty alone.
      RETURN NULL;
    END IF;

    UPDATE device_warranties
       SET status              = 'cancelled',
           cancellation_reason = 'contract_cancelled',
           cancelled_at        = NOW()
     WHERE device_id = v_device_id
       AND warranty_type = 'contract'
       AND status IN ('pending', 'active');
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: trg_warranty_on_device_retrieval(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_warranty_on_device_retrieval() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'retrieved' AND OLD.status IS DISTINCT FROM 'retrieved' THEN
    UPDATE device_warranties
       SET status              = 'cancelled',
           cancellation_reason = 'device_retrieved',
           cancelled_at        = NOW()
     WHERE device_id = NEW.id
       AND status IN ('pending', 'active');
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: applicants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.applicants (
    id integer NOT NULL,
    first_name character varying(255) NOT NULL,
    last_name character varying(255) NOT NULL,
    dob date NOT NULL,
    gender character varying(20) NOT NULL,
    marital_status character varying(50) NOT NULL,
    email character varying(255),
    mobile_number character varying(20) NOT NULL,
    secondary_mobile character varying(20),
    governorate character varying(255) NOT NULL,
    city_or_area character varying(255),
    sub_area character varying(255),
    neighborhood character varying(255),
    detailed_address text,
    academic_qualification character varying(255),
    previous_employment character varying(255),
    driving_license character varying(10) DEFAULT NULL::character varying,
    expected_salary integer,
    computer_skills text,
    foreign_languages text,
    specialization character varying(255),
    years_of_experience integer,
    cv_url text,
    photo_url text,
    applicant_segment character varying(100),
    has_whatsapp_primary boolean DEFAULT false,
    has_whatsapp_secondary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    has_car boolean DEFAULT false
);


--
-- Name: applicants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.applicants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: applicants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.applicants_id_seq OWNED BY public.applicants.id;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id integer NOT NULL,
    application_id integer,
    action_type character varying(100) NOT NULL,
    performed_by_role character varying(50),
    performed_by_user_id integer,
    old_value text,
    new_value text,
    internal_reason text,
    "timestamp" timestamp with time zone DEFAULT now()
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: branch_geo_coverage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branch_geo_coverage (
    branch_id integer NOT NULL,
    geo_unit_id integer NOT NULL
);


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    location_geo_id integer,
    status character varying(50) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    contact_info jsonb DEFAULT '[]'::jsonb,
    detailed_address text,
    CONSTRAINT branches_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


--
-- Name: branches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.branches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: branches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.branches_id_seq OWNED BY public.branches.id;


--
-- Name: call_task_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_task_links (
    call_id character varying(255) NOT NULL,
    task_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: candidate_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_assignments (
    id integer NOT NULL,
    candidate_id integer NOT NULL,
    hr_user_id integer NOT NULL,
    assigned_at timestamp with time zone DEFAULT now(),
    assigned_by integer
);


--
-- Name: candidate_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.candidate_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: candidate_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.candidate_assignments_id_seq OWNED BY public.candidate_assignments.id;


--
-- Name: candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidates (
    id integer NOT NULL,
    first_name character varying(255),
    last_name character varying(255),
    nickname character varying(255),
    mobile character varying(50) NOT NULL,
    contacts jsonb DEFAULT '[]'::jsonb,
    address_text text,
    geo_unit_id integer,
    owner_user_id integer,
    status character varying(50) DEFAULT 'Suggested'::character varying,
    referral_sheet_id integer,
    referral_date character varying(50),
    referral_reason text,
    referral_type character varying(100),
    referral_origin_channel character varying(100),
    referral_name_snapshot character varying(255),
    referral_entity_id integer,
    referral_confirmation_status character varying(50) DEFAULT 'Pending'::character varying,
    occupation character varying(255),
    candidate_notes text,
    duplicate_flag boolean DEFAULT false,
    duplicate_type character varying(50),
    duplicate_reference_id integer,
    converted_to_lead_id integer,
    created_at timestamp with time zone DEFAULT now(),
    created_by integer,
    branch_id integer,
    CONSTRAINT candidates_status_check CHECK (((status)::text = ANY ((ARRAY['New'::character varying, 'Suggested'::character varying, 'FollowUp'::character varying, 'Contacted'::character varying, 'Qualified'::character varying, 'Junk'::character varying])::text[])))
);


--
-- Name: candidates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.candidates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: candidates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.candidates_id_seq OWNED BY public.candidates.id;


--
-- Name: client_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_assignments (
    id integer NOT NULL,
    client_id integer NOT NULL,
    hr_user_id integer NOT NULL,
    assigned_at timestamp with time zone DEFAULT now(),
    assigned_by integer
);


--
-- Name: client_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_assignments_id_seq OWNED BY public.client_assignments.id;


--
-- Name: client_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_audit_log (
    id integer NOT NULL,
    client_id integer NOT NULL,
    field_name character varying(100),
    old_value text,
    new_value text,
    changed_by integer,
    changed_at timestamp without time zone DEFAULT now()
);


--
-- Name: client_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_audit_log_id_seq OWNED BY public.client_audit_log.id;


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    mobile character varying(50) NOT NULL,
    contacts jsonb DEFAULT '[]'::jsonb,
    detailed_address text,
    gps_coordinates jsonb,
    source_channel character varying(255),
    referrer_type character varying(255),
    referrer_id integer,
    referrer_name character varying(255),
    referral_entity_id integer,
    referral_date character varying(50),
    referral_reason text,
    referral_sheet_id integer,
    referral_address_text text,
    created_at timestamp with time zone DEFAULT now(),
    is_candidate boolean DEFAULT false,
    target_client character varying(255),
    candidate_status character varying(50),
    first_name character varying(255),
    father_name character varying(255),
    last_name character varying(255),
    nickname character varying(255),
    occupation character varying(255),
    water_source character varying(255),
    notes text,
    rating character varying(50),
    referrers jsonb DEFAULT '[]'::jsonb,
    spouse_occupation character varying(255),
    data_quality character varying(50),
    gender character varying(10),
    national_id character varying(12),
    birth_date date,
    referral_notes text,
    branch_id integer,
    assigned_hr_user_id integer,
    created_by integer,
    deleted_at timestamp without time zone,
    deleted_by integer,
    is_active boolean DEFAULT true,
    mother_name character varying(255),
    national_id_registry character varying(255),
    national_id_issued_by character varying(255),
    national_id_issue_date date,
    national_id_box character varying(50),
    governorate integer,
    district integer,
    neighborhood integer,
    cooldown_until date,
    cooldown_reason text,
    cooldown_set_by integer,
    cooldown_set_at timestamp with time zone,
    do_not_contact boolean DEFAULT false NOT NULL
);


--
-- Name: clients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clients_id_seq OWNED BY public.clients.id;


--
-- Name: contact_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_targets (
    id bigint NOT NULL,
    branch_id integer NOT NULL,
    target_type character varying(50) NOT NULL,
    target_id integer NOT NULL,
    target_stage character varying(50) NOT NULL,
    visit_type character varying(50) NOT NULL,
    source_type character varying(50) NOT NULL,
    source_id integer NOT NULL,
    supervisor_hr_user_id integer,
    zone_id integer,
    status character varying(50) DEFAULT 'new'::character varying NOT NULL,
    latest_call_outcome character varying(50),
    latest_task_list_item_id character varying(100),
    latest_visit_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    date date,
    closing_reason character varying(50),
    closed_by integer,
    closed_at timestamp with time zone,
    team_key character varying(50),
    work_location_geo_unit_id integer,
    CONSTRAINT contact_targets_source_type_check CHECK (((source_type)::text = 'lead'::text)),
    CONSTRAINT contact_targets_status_check CHECK (((status)::text = ANY ((ARRAY['new'::character varying, 'queued'::character varying, 'in_call_list'::character varying, 'contacted'::character varying, 'booked'::character varying, 'closed'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT contact_targets_target_stage_check CHECK (((target_stage)::text = 'lead'::text)),
    CONSTRAINT contact_targets_target_type_check CHECK (((target_type)::text = 'client'::text)),
    CONSTRAINT contact_targets_visit_type_check CHECK (((visit_type)::text = 'marketing'::text))
);


--
-- Name: COLUMN contact_targets.closing_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contact_targets.closing_reason IS 'DEC-005 D26 vocabulary: booked | manual_telemarketer | manual_supervisor | auto_closed_by_cron | cooldown_set.';


--
-- Name: COLUMN contact_targets.closed_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contact_targets.closed_by IS 'hr_users.id who closed the target. NULL for auto_closed_by_cron.';


--
-- Name: COLUMN contact_targets.closed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contact_targets.closed_at IS 'Timestamp of closure. NULL while status != closed.';


--
-- Name: COLUMN contact_targets.team_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contact_targets.team_key IS 'Snapshot of team_key (from day_schedule) that owned this target. Helps cross-team awareness queries (DEC-005 D28).';


--
-- Name: COLUMN contact_targets.work_location_geo_unit_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contact_targets.work_location_geo_unit_id IS 'Work location grain per DEC-005 D27. Computed from task_type_config.location_basis: client â†’ client geo_unit, device â†’ installed_device.installation_geo_unit_id. Backfill + UNIQUE constraint update deferred to Phase 5.';


--
-- Name: contact_targets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contact_targets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contact_targets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contact_targets_id_seq OWNED BY public.contact_targets.id;


--
-- Name: contract_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_documents (
    id integer NOT NULL,
    contract_id integer NOT NULL,
    template_version character varying(50) NOT NULL,
    rendered_html text NOT NULL,
    content_hash character(64) NOT NULL,
    is_amendment boolean DEFAULT false NOT NULL,
    frozen_at timestamp with time zone DEFAULT now() NOT NULL,
    frozen_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contract_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_documents_id_seq OWNED BY public.contract_documents.id;


--
-- Name: contract_installments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_installments (
    id integer NOT NULL,
    contract_id integer NOT NULL,
    installment_number integer NOT NULL,
    due_date date NOT NULL,
    amount_syp numeric NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    paid_amount numeric DEFAULT 0 NOT NULL,
    remaining_balance numeric DEFAULT 0 NOT NULL,
    confirmed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    collection_owner_id integer,
    CONSTRAINT contract_installments_amount_syp_check CHECK ((amount_syp >= (0)::numeric)),
    CONSTRAINT contract_installments_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'paid'::character varying, 'partial'::character varying, 'overdue'::character varying])::text[])))
);


--
-- Name: contract_installments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_installments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_installments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_installments_id_seq OWNED BY public.contract_installments.id;


--
-- Name: contract_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_line_items (
    id integer NOT NULL,
    contract_id integer NOT NULL,
    item_type character varying(50) NOT NULL,
    spare_part_id integer,
    description character varying(500),
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric NOT NULL,
    total_price numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_installed boolean DEFAULT false,
    CONSTRAINT contract_line_items_item_type_check CHECK (((item_type)::text = ANY ((ARRAY['device'::character varying, 'accessory'::character varying, 'service_fee'::character varying])::text[]))),
    CONSTRAINT contract_line_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT contract_line_items_total_price_check CHECK ((total_price >= (0)::numeric)),
    CONSTRAINT contract_line_items_unit_price_check CHECK ((unit_price >= (0)::numeric))
);


--
-- Name: contract_line_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_line_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_line_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_line_items_id_seq OWNED BY public.contract_line_items.id;


--
-- Name: contract_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_payment_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_payment_entries (
    id integer NOT NULL,
    contract_id integer NOT NULL,
    method character varying(50) NOT NULL,
    currency character varying(10) DEFAULT 'SYP'::character varying NOT NULL,
    amount_value numeric NOT NULL,
    exchange_rate numeric,
    amount_syp numeric NOT NULL,
    reference_number character varying(255),
    barter_name character varying(255),
    barter_value_syp numeric,
    received_by_employee_id integer,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    entry_type character varying(20) DEFAULT 'collection'::character varying NOT NULL,
    installment_id integer,
    CONSTRAINT contract_payment_entries_amount_syp_check CHECK ((amount_syp >= (0)::numeric)),
    CONSTRAINT contract_payment_entries_amount_value_check CHECK ((amount_value >= (0)::numeric)),
    CONSTRAINT contract_payment_entries_barter_value_syp_check CHECK ((barter_value_syp >= (0)::numeric)),
    CONSTRAINT contract_payment_entries_entry_type_check CHECK (((entry_type)::text = ANY ((ARRAY['collection'::character varying, 'refund'::character varying])::text[]))),
    CONSTRAINT contract_payment_entries_exchange_rate_check CHECK (((exchange_rate IS NULL) OR (exchange_rate > (0)::numeric))),
    CONSTRAINT contract_payment_entries_method_check CHECK (((method)::text = ANY ((ARRAY['cash'::character varying, 'sham_cash'::character varying, 'syriatel_cash'::character varying, 'mtn_cash'::character varying, 'alharam'::character varying, 'bank_transfer'::character varying, 'barter'::character varying, 'usd_cash'::character varying])::text[])))
);


--
-- Name: contract_payment_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_payment_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_payment_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_payment_entries_id_seq OWNED BY public.contract_payment_entries.id;


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id integer NOT NULL,
    contract_number character varying(100),
    customer_id integer,
    customer_name character varying(255),
    contract_date character varying(50),
    source_visit character varying(255),
    device_model_id integer,
    device_model_name character varying(255),
    maintenance_plan character varying(10),
    base_price numeric DEFAULT 0,
    final_price numeric DEFAULT 0,
    payment_type character varying(50) DEFAULT 'cash'::character varying,
    down_payment numeric DEFAULT 0,
    installments_count integer DEFAULT 0,
    status character varying(50) DEFAULT 'draft'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    branch_id integer,
    sale_type character varying(30) DEFAULT 'marketing'::character varying NOT NULL,
    discount_id integer,
    sale_source character varying(50),
    closing_employee_id integer,
    closing_date timestamp with time zone,
    invoice_notes text,
    receipt_number character varying(100),
    applied_device_discount_id integer,
    buyer_mother_name character varying(255),
    buyer_national_id_registry character varying(255),
    buyer_national_id_issued_by character varying(255),
    buyer_national_id_issue_date date,
    buyer_national_id_box character varying(50),
    buyer_birth_date date,
    buyer_gender character varying(10),
    source_open_task_id integer,
    source_task_offer_id bigint,
    sale_reference_number character varying(10),
    contract_type character varying(30) DEFAULT 'sale_contract'::character varying NOT NULL,
    no_closing_reason_id integer,
    sale_subtype character varying(30) DEFAULT 'definitive'::character varying,
    code character varying(100),
    created_by integer,
    installed_device_id integer,
    contract_referrers jsonb DEFAULT '[]'::jsonb NOT NULL,
    sale_owner_id integer,
    offer_team_snapshot jsonb,
    CONSTRAINT contracts_contract_type_check CHECK (((contract_type)::text = 'sale_contract'::text)),
    CONSTRAINT contracts_sale_subtype_check CHECK (((sale_subtype)::text = ANY ((ARRAY['definitive'::character varying, 'temporary'::character varying, 'free'::character varying])::text[]))),
    CONSTRAINT contracts_sale_type_check CHECK (((sale_type)::text = ANY ((ARRAY['tradein'::character varying, 'retention'::character varying, 'direct'::character varying])::text[]))),
    CONSTRAINT contracts_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'cancelled'::character varying, 'completed'::character varying, 'discarded'::character varying])::text[])))
);


--
-- Name: contracts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contracts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contracts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contracts_id_seq OWNED BY public.contracts.id;


--
-- Name: customer_call_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_call_logs (
    id character varying(100) NOT NULL,
    customer_id integer NOT NULL,
    contact_id character varying(100),
    contact_number character varying(50),
    contact_label character varying(255),
    caller_id integer,
    caller_role character varying(50),
    call_date timestamp with time zone DEFAULT now(),
    outcome character varying(50) NOT NULL,
    source_type character varying(50) DEFAULT 'direct_call'::character varying,
    source_id character varying(100),
    notes text,
    branch_id integer,
    action_log jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    answered_by character varying(50),
    communication_channel character varying(50),
    status character varying(50) DEFAULT 'completed'::character varying NOT NULL
);


--
-- Name: customer_device_pre_offers; Type: TABLE; Schema: public; Owner: -
--

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
    CONSTRAINT customer_device_pre_offers_discount_percentage_check CHECK (((discount_percentage IS NULL) OR (discount_percentage >= (0)::numeric))),
    CONSTRAINT customer_device_pre_offers_first_payment_amount_check CHECK (((first_payment_amount IS NULL) OR (first_payment_amount >= (0)::numeric))),
    CONSTRAINT customer_device_pre_offers_installment_months_check CHECK (((installment_months IS NULL) OR (installment_months > 0))),
    CONSTRAINT customer_device_pre_offers_offer_type_check CHECK (((offer_type)::text = ANY ((ARRAY['cash'::character varying, 'installment'::character varying])::text[]))),
    CONSTRAINT customer_device_pre_offers_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT customer_device_pre_offers_response_state_check CHECK (((response_state)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'rejected'::character varying, 'extension_requested'::character varying])::text[]))),
    CONSTRAINT customer_device_pre_offers_total_amount_check CHECK ((total_amount >= (0)::numeric))
);


--
-- Name: customer_device_pre_offers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_device_pre_offers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_device_pre_offers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_device_pre_offers_id_seq OWNED BY public.customer_device_pre_offers.id;


--
-- Name: day_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.day_schedules (
    date character varying(50) NOT NULL,
    teams jsonb DEFAULT '[]'::jsonb,
    solos jsonb DEFAULT '[]'::jsonb
);


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    department_type_id integer,
    branch_id integer NOT NULL,
    device_model_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: departments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.departments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: departments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.departments_id_seq OWNED BY public.departments.id;


--
-- Name: device_possession_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_possession_log (
    id integer NOT NULL,
    device_id integer NOT NULL,
    holder_type character varying(20) NOT NULL,
    holder_id integer,
    start_at timestamp with time zone DEFAULT now() NOT NULL,
    end_at timestamp with time zone,
    reason character varying(30) NOT NULL,
    notes text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_possession_holder_type_check CHECK (((holder_type)::text = ANY ((ARRAY['warehouse'::character varying, 'technician'::character varying, 'customer'::character varying, 'workshop'::character varying, 'supplier'::character varying])::text[]))),
    CONSTRAINT device_possession_period_check CHECK (((end_at IS NULL) OR (end_at >= start_at))),
    CONSTRAINT device_possession_reason_check CHECK (((reason)::text = ANY ((ARRAY['sale_delivery'::character varying, 'repair_pickup'::character varying, 'temporary_swap'::character varying, 'retrieval'::character varying, 'cancellation'::character varying, 'transfer'::character varying])::text[])))
);


--
-- Name: device_current_possession; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.device_current_possession AS
 SELECT device_id,
    id AS possession_id,
    holder_type,
    holder_id,
    start_at,
    reason
   FROM public.device_possession_log
  WHERE (end_at IS NULL);


--
-- Name: device_discounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_discounts (
    id integer NOT NULL,
    device_model_id integer NOT NULL,
    label character varying(255) NOT NULL,
    percentage numeric NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_discounts_percentage_check CHECK (((percentage >= (0)::numeric) AND (percentage <= (100)::numeric)))
);


--
-- Name: device_discounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_discounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_discounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_discounts_id_seq OWNED BY public.device_discounts.id;


--
-- Name: device_installed_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_installed_parts (
    id integer NOT NULL,
    device_id integer NOT NULL,
    open_task_id integer,
    spare_part_id integer,
    part_name_snapshot character varying(255) NOT NULL,
    part_code_snapshot character varying(100),
    maintenance_type character varying(50),
    unit_price numeric(12,2),
    quantity integer DEFAULT 1 NOT NULL,
    line_total numeric(12,2),
    event_type character varying(20) DEFAULT 'replaced'::character varying NOT NULL,
    event_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_installed_parts_event_type_check CHECK (((event_type)::text = ANY ((ARRAY['installed'::character varying, 'replaced'::character varying, 'removed'::character varying])::text[])))
);


--
-- Name: device_installed_parts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_installed_parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_installed_parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_installed_parts_id_seq OWNED BY public.device_installed_parts.id;


--
-- Name: device_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_models (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    brand character varying(255),
    category character varying(50),
    maintenance_interval character varying(50),
    base_price numeric DEFAULT 0,
    supported_visit_types jsonb DEFAULT '[]'::jsonb,
    name_ar character varying(255),
    name_en character varying(255) NOT NULL,
    is_golden_warranty boolean DEFAULT false NOT NULL,
    golden_warranty_periods jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_featured boolean DEFAULT false CONSTRAINT device_models_is_offer_included_not_null NOT NULL,
    description text,
    images jsonb DEFAULT '[]'::jsonb NOT NULL,
    primary_image_id text,
    videos jsonb DEFAULT '[]'::jsonb NOT NULL,
    documents jsonb DEFAULT '[]'::jsonb NOT NULL,
    description_en text,
    code character varying(255),
    deleted_at timestamp with time zone,
    warranty_periods jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: device_models_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_models_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_models_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_models_id_seq OWNED BY public.device_models.id;


--
-- Name: device_possession_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_possession_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_possession_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_possession_log_id_seq OWNED BY public.device_possession_log.id;


--
-- Name: device_technical_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_technical_states (
    id integer NOT NULL,
    contract_id integer,
    open_task_id integer,
    phase character varying(10) NOT NULL,
    water_source_type character varying(20),
    water_source_tds numeric,
    water_pressure character varying(20),
    has_pressure_regulator boolean,
    tap_tds_before numeric,
    pump_pressure numeric,
    membrane_output_tds numeric,
    membrane_input_tds numeric,
    membrane_flow character varying(20),
    flow_cup_size integer,
    sterilization_transformer character varying(20),
    uv_lamp character varying(20),
    sterilization_sleeve character varying(20),
    high_pressure_tds numeric,
    low_pressure_switch character varying(20),
    tank_tds numeric,
    valve_type character varying(20),
    pump_transformer character varying(20),
    has_fifth_tap character varying(20),
    device_connection character varying(20),
    additional_notes text,
    recorded_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_technical_states_phase_check CHECK (((phase)::text = ANY ((ARRAY['pre'::character varying, 'post'::character varying, 'standalone'::character varying])::text[])))
);


--
-- Name: device_technical_states_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_technical_states_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_technical_states_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_technical_states_id_seq OWNED BY public.device_technical_states.id;


--
-- Name: device_warranties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_warranties (
    id integer NOT NULL,
    device_id integer NOT NULL,
    warranty_type character varying(20) NOT NULL,
    start_date date,
    end_date date,
    months integer,
    visits integer,
    source_task_id integer,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    cancellation_reason character varying(30),
    cancelled_at timestamp with time zone,
    cancelled_by integer,
    activated_at timestamp with time zone,
    CONSTRAINT device_warranties_cancellation_consistency CHECK (((((status)::text = 'cancelled'::text) AND (cancellation_reason IS NOT NULL) AND (cancelled_at IS NOT NULL)) OR (((status)::text <> 'cancelled'::text) AND (cancellation_reason IS NULL) AND (cancelled_at IS NULL)))),
    CONSTRAINT device_warranties_cancellation_reason_check CHECK (((cancellation_reason IS NULL) OR ((cancellation_reason)::text = ANY ((ARRAY['contract_cancelled'::character varying, 'device_retrieved'::character varying, 'manual'::character varying])::text[])))),
    CONSTRAINT device_warranties_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'active'::character varying, 'cancelled'::character varying, 'expired'::character varying])::text[]))),
    CONSTRAINT device_warranties_warranty_type_check CHECK (((warranty_type)::text = ANY ((ARRAY['contract'::character varying, 'golden'::character varying])::text[])))
);


--
-- Name: device_warranties_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_warranties_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_warranties_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_warranties_id_seq OWNED BY public.device_warranties.id;


--
-- Name: direct_suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.direct_suggestions (
    id integer NOT NULL,
    visit_task_id integer NOT NULL,
    client_id integer,
    name character varying(255) NOT NULL,
    phone character varying(50),
    is_direct boolean DEFAULT true,
    status character varying(50) DEFAULT 'pending'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT direct_suggestions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'contacted'::character varying, 'converted'::character varying])::text[])))
);


--
-- Name: direct_suggestions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.direct_suggestions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: direct_suggestions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.direct_suggestions_id_seq OWNED BY public.direct_suggestions.id;


--
-- Name: dues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dues (
    id integer NOT NULL,
    contract_id integer NOT NULL,
    type character varying(50) NOT NULL,
    scheduled_date character varying(50),
    adjusted_date character varying(50),
    original_amount numeric DEFAULT 0,
    remaining_balance numeric DEFAULT 0,
    assigned_telemarketer_id integer,
    status character varying(50) DEFAULT 'Pending'::character varying,
    escalated boolean DEFAULT false,
    CONSTRAINT dues_status_check CHECK (((status)::text = ANY ((ARRAY['Pending'::character varying, 'Partial'::character varying, 'Paid'::character varying, 'Overdue'::character varying])::text[])))
);


--
-- Name: dues_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dues_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dues_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dues_id_seq OWNED BY public.dues.id;


--
-- Name: emergency_action_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_action_types (
    id integer NOT NULL,
    arabic_label character varying(100) NOT NULL,
    description text,
    display_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: emergency_action_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.emergency_action_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: emergency_action_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.emergency_action_types_id_seq OWNED BY public.emergency_action_types.id;


--
-- Name: emergency_installments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_installments (
    id integer NOT NULL,
    costs_id integer NOT NULL,
    open_task_id integer,
    installment_number integer NOT NULL,
    due_date date NOT NULL,
    amount_syp numeric(12,2) DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    due_id integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: emergency_installments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.emergency_installments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: emergency_installments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.emergency_installments_id_seq OWNED BY public.emergency_installments.id;


--
-- Name: emergency_maintenance_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_maintenance_actions (
    id integer NOT NULL,
    open_task_id integer NOT NULL,
    action_type_id integer,
    actions_taken text,
    parts_used jsonb DEFAULT '[]'::jsonb NOT NULL,
    technician_notes text,
    recorded_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: emergency_maintenance_actions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.emergency_maintenance_actions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: emergency_maintenance_actions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.emergency_maintenance_actions_id_seq OWNED BY public.emergency_maintenance_actions.id;


--
-- Name: emergency_payment_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_payment_entries (
    id integer NOT NULL,
    costs_id integer NOT NULL,
    method character varying(20) NOT NULL,
    amount_value numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(5) DEFAULT 'syp'::character varying,
    exchange_rate numeric(10,2),
    amount_syp numeric(12,2) DEFAULT 0 NOT NULL,
    transfer_company_id integer,
    barter_description text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: emergency_payment_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.emergency_payment_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: emergency_payment_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.emergency_payment_entries_id_seq OWNED BY public.emergency_payment_entries.id;


--
-- Name: emergency_result_costs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_result_costs (
    id integer NOT NULL,
    open_task_id integer NOT NULL,
    final_decision character varying(50) NOT NULL,
    closing_notes text,
    labor_cost numeric DEFAULT 0,
    parts_cost numeric DEFAULT 0,
    total_cost numeric DEFAULT 0,
    payment_method character varying(50),
    collected_amount numeric DEFAULT 0,
    invoice_notes text,
    recorded_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    transport_fee numeric DEFAULT 0,
    assembly_fee numeric DEFAULT 0,
    discount_percentage numeric DEFAULT 0,
    discount_reason_id integer,
    discount_reason_text character varying(255),
    decision_reason_id integer,
    decision_reason_text character varying(255),
    follow_up_priority character varying(20),
    follow_up_expected_date date,
    follow_up_task_id integer,
    payment_type character varying(20),
    installment_months integer,
    payment_delivery character varying(20),
    transfer_company_id integer,
    barter_description text,
    barter_value_syp numeric(12,2),
    pay1_currency character varying(5),
    pay1_amount numeric(12,2),
    pay1_exchange_rate numeric(10,2),
    pay2_currency character varying(5),
    pay2_amount numeric(12,2),
    pay2_exchange_rate numeric(10,2),
    closing_note text,
    has_first_payment boolean DEFAULT false,
    installments_count integer,
    installments_confirmed boolean DEFAULT false,
    CONSTRAINT emergency_result_costs_discount_percentage_check CHECK (((discount_percentage >= (0)::numeric) AND (discount_percentage <= (100)::numeric))),
    CONSTRAINT emergency_result_costs_final_decision_check CHECK (((final_decision)::text = ANY ((ARRAY['resolved'::character varying, 'unresolved'::character varying, 'needs_followup'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: emergency_result_costs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.emergency_result_costs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: emergency_result_costs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.emergency_result_costs_id_seq OWNED BY public.emergency_result_costs.id;


--
-- Name: emergency_result_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_result_parts (
    id integer NOT NULL,
    open_task_id integer NOT NULL,
    spare_part_id integer,
    part_name_snapshot character varying(255) NOT NULL,
    part_code_snapshot character varying(100),
    maintenance_type character varying(50),
    unit_price numeric DEFAULT 0 NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    line_total numeric GENERATED ALWAYS AS ((unit_price * (quantity)::numeric)) STORED,
    retrieved boolean DEFAULT true,
    no_retrieval_reason_id integer,
    no_retrieval_reason_text character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    placement_state character varying(30) DEFAULT 'installed'::character varying NOT NULL,
    CONSTRAINT emergency_result_parts_placement_state_check CHECK (((placement_state)::text = ANY ((ARRAY['installed'::character varying, 'customer_stock'::character varying])::text[])))
);


--
-- Name: emergency_result_parts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.emergency_result_parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: emergency_result_parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.emergency_result_parts_id_seq OWNED BY public.emergency_result_parts.id;


--
-- Name: emergency_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_tickets (
    id integer NOT NULL,
    client_id integer NOT NULL,
    client_name character varying(255) NOT NULL,
    client_address text,
    client_rating character varying(50) DEFAULT 'Undefined'::character varying,
    contract_id integer,
    device_model_name character varying(255),
    problem_description text NOT NULL,
    call_notes text,
    attachments jsonb DEFAULT '[]'::jsonb,
    call_receiver character varying(255),
    priority character varying(50) DEFAULT 'Normal'::character varying,
    status character varying(50) DEFAULT 'New'::character varying,
    assigned_technician_id integer,
    created_at timestamp with time zone DEFAULT now(),
    open_task_id integer,
    action_type_id integer,
    due_within_hours integer DEFAULT 48 NOT NULL,
    CONSTRAINT emergency_tickets_priority_check CHECK (((priority)::text = ANY ((ARRAY['Critical'::character varying, 'High'::character varying, 'Normal'::character varying])::text[]))),
    CONSTRAINT emergency_tickets_status_check CHECK (((status)::text = ANY ((ARRAY['New'::character varying, 'Assigned'::character varying, 'In Progress'::character varying, 'Completed'::character varying, 'Cancelled'::character varying])::text[])))
);


--
-- Name: emergency_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.emergency_tickets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: emergency_tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.emergency_tickets_id_seq OWNED BY public.emergency_tickets.id;


--
-- Name: employee_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    role character varying(50),
    mobile character varying(50) NOT NULL,
    branch character varying(255),
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    job_title character varying(255),
    avatar text,
    created_at timestamp with time zone DEFAULT now(),
    branch_id integer,
    department_id integer,
    employee_number bigint DEFAULT nextval('public.employee_number_seq'::regclass),
    first_name character varying(255),
    father_name character varying(255),
    last_name character varying(255),
    birth_date date,
    gender character varying(20),
    marital_status character varying(100),
    military_service character varying(100),
    residence_governorate_id integer,
    residence_region_id integer,
    residence_sub_area_id integer,
    residence_neighborhood_id integer,
    detailed_address text,
    contacts jsonb DEFAULT '[]'::jsonb NOT NULL,
    academic_qualification character varying(255),
    specialization character varying(255),
    years_of_experience integer,
    driving_license boolean,
    job_skills text,
    foreign_languages jsonb DEFAULT '[]'::jsonb NOT NULL,
    hire_date date,
    start_work_date date,
    contract_type character varying(100),
    work_type character varying(100),
    previous_employment text,
    direct_manager_id integer,
    referrer_type character varying(50),
    source_channel character varying(100),
    referrer_name character varying(255),
    referral_notes text,
    referral_entity_id integer,
    CONSTRAINT employees_role_check CHECK (((role IS NULL) OR ((role)::text = ANY ((ARRAY['supervisor'::character varying, 'technician'::character varying, 'telemarketer'::character varying, 'trainee'::character varying])::text[])))),
    CONSTRAINT employees_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'vacation'::character varying, 'suspended'::character varying, 'terminated'::character varying])::text[])))
);


--
-- Name: employees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employees_id_seq OWNED BY public.employees.id;


--
-- Name: field_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_visits (
    id bigint NOT NULL,
    visit_type character varying(50) NOT NULL,
    visit_family character varying(50) NOT NULL,
    status character varying(50) DEFAULT 'scheduled'::character varying NOT NULL,
    client_id integer NOT NULL,
    branch_id integer NOT NULL,
    scheduled_date date,
    scheduled_time character varying(50),
    source_legacy_type character varying(50),
    source_legacy_id character varying(100),
    team_snapshot jsonb,
    field_notes text,
    closed_by integer,
    closed_at timestamp with time zone,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reassigned_supervisor_id integer,
    reassigned_technician_id integer,
    reassigned_trainee_id integer,
    reassigned_team_snapshot jsonb,
    reassigned_at timestamp with time zone,
    reassigned_by integer,
    appointment_booked_at timestamp with time zone,
    booked_by_telemarketer_id integer,
    telemarketer_notes text,
    answered_by character varying(50),
    customer_snapshot jsonb,
    cancellation_reason_id integer,
    cancellation_notes text,
    origin_type character varying(50),
    origin_id bigint,
    team_responsible_user_id integer,
    CONSTRAINT field_visits_origin_type_check CHECK (((origin_type IS NULL) OR ((origin_type)::text = ANY ((ARRAY['telemarketing'::character varying, 'expected_followup'::character varying, 'manual'::character varying, 'emergency_request'::character varying, 'system'::character varying])::text[])))),
    CONSTRAINT field_visits_status_check CHECK (((status)::text = ANY ((ARRAY['scheduled'::character varying, 'in_progress'::character varying, 'ended'::character varying, 'completed'::character varying, 'not_completed'::character varying, 'cancelled'::character varying, 'closed'::character varying])::text[]))),
    CONSTRAINT field_visits_visit_family_check CHECK (((visit_family)::text = ANY ((ARRAY['marketing'::character varying, 'service'::character varying])::text[]))),
    CONSTRAINT field_visits_visit_type_check CHECK (((visit_type)::text = ANY ((ARRAY['marketing'::character varying, 'service'::character varying, 'mixed'::character varying])::text[])))
);


--
-- Name: COLUMN field_visits.origin_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.field_visits.origin_type IS 'Origin channel per DEC-003 D3 + DEC-004 D22. Required at insert time after Phase 4 (book-visit endpoint goes live).';


--
-- Name: COLUMN field_visits.origin_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.field_visits.origin_id IS 'Reference to source record (call_log id, hr_user id, emergency request id, etc.). Semantics depend on origin_type.';


--
-- Name: COLUMN field_visits.team_responsible_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.field_visits.team_responsible_user_id IS 'Snapshot of the team owner at creation time per DEC-007 D47. Supervisor for TeamSlot, Technician for EmergencySlot.';


--
-- Name: field_visits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.field_visits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: field_visits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.field_visits_id_seq OWNED BY public.field_visits.id;


--
-- Name: geo_units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geo_units (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    level integer NOT NULL,
    parent_id integer,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    CONSTRAINT geo_units_level_check CHECK ((level = ANY (ARRAY[1, 2, 3, 4]))),
    CONSTRAINT geo_units_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


--
-- Name: geo_units_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.geo_units_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: geo_units_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.geo_units_id_seq OWNED BY public.geo_units.id;


--
-- Name: hr_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hr_users (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    username character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(100) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    employee_id integer,
    role_id integer,
    is_super_admin boolean DEFAULT false NOT NULL,
    branch_id integer
);


--
-- Name: hr_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hr_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hr_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hr_users_id_seq OWNED BY public.hr_users.id;


--
-- Name: installed_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.installed_devices (
    id integer NOT NULL,
    contract_id integer NOT NULL,
    customer_id integer NOT NULL,
    branch_id integer,
    device_model_id integer,
    device_model_name character varying(255),
    serial_number character varying(255),
    status character varying(50) DEFAULT 'pending_delivery'::character varying NOT NULL,
    installation_geo_unit_id integer,
    installation_address_text text,
    installation_lat numeric(12,8),
    installation_lng numeric(12,8),
    delivery_date date,
    installation_date date,
    is_golden_warranty boolean DEFAULT false NOT NULL,
    golden_warranty_end_date date,
    contract_warranty_end_date date,
    warranty_months integer,
    warranty_visits integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone,
    CONSTRAINT installed_devices_status_check CHECK (((status)::text = ANY ((ARRAY['registered'::character varying, 'pending_delivery'::character varying, 'delivered'::character varying, 'installed'::character varying, 'active'::character varying, 'faulty'::character varying, 'in_workshop'::character varying, 'ready'::character varying, 'out_of_service'::character varying, 'retrieved'::character varying])::text[])))
);


--
-- Name: installed_devices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.installed_devices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: installed_devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.installed_devices_id_seq OWNED BY public.installed_devices.id;


--
-- Name: interviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interviews (
    id integer NOT NULL,
    application_id integer NOT NULL,
    interview_type character varying(30) NOT NULL,
    interview_number character varying(30) NOT NULL,
    interviewer_name character varying(255) NOT NULL,
    interview_date date NOT NULL,
    interview_time time without time zone NOT NULL,
    interview_status character varying(30) DEFAULT 'Interview Scheduled'::character varying,
    internal_notes text,
    created_at timestamp with time zone DEFAULT now(),
    interviewer_user_id integer,
    CONSTRAINT interviews_interview_number_check CHECK (((interview_number)::text = ANY ((ARRAY['First Interview'::character varying, 'Second Interview'::character varying])::text[]))),
    CONSTRAINT interviews_interview_status_check CHECK (((interview_status)::text = ANY ((ARRAY['Interview Scheduled'::character varying, 'Interview Completed'::character varying, 'Interview Failed'::character varying])::text[]))),
    CONSTRAINT interviews_interview_type_check CHECK (((interview_type)::text = ANY ((ARRAY['HR Interview'::character varying, 'Technical Interview'::character varying])::text[])))
);


--
-- Name: interviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.interviews_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: interviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.interviews_id_seq OWNED BY public.interviews.id;


--
-- Name: job_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_applications (
    id integer NOT NULL,
    job_vacancy_id integer,
    applicant_id integer NOT NULL,
    referrer_id integer,
    submission_type character varying(30) NOT NULL,
    application_source character varying(30) NOT NULL,
    entered_by_user_id integer,
    entered_by_name character varying(255),
    current_stage character varying(30) DEFAULT 'Submitted'::character varying NOT NULL,
    application_status character varying(30) DEFAULT 'New'::character varying NOT NULL,
    stage_status character varying(30),
    decision character varying(30),
    duplicate_flag boolean DEFAULT false,
    hired_employee_id integer,
    is_escalated boolean DEFAULT false,
    escalated_at timestamp with time zone,
    is_archived boolean DEFAULT false,
    archived_at timestamp with time zone,
    internal_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    branch_id integer,
    CONSTRAINT job_applications_application_status_check CHECK (((application_status)::text = ANY ((ARRAY['New'::character varying, 'In Review'::character varying, 'Qualified'::character varying, 'Rejected'::character varying, 'Interview Scheduled'::character varying, 'Interview Completed'::character varying, 'Interview Failed'::character varying, 'Approved'::character varying, 'Training Scheduled'::character varying, 'Training Started'::character varying, 'Training Completed'::character varying, 'Retraining'::character varying, 'Passed'::character varying, 'Final Hired'::character varying, 'Final Rejected'::character varying, 'Retreated'::character varying])::text[]))),
    CONSTRAINT job_applications_current_stage_check CHECK (((current_stage)::text = ANY ((ARRAY['Submitted'::character varying, 'Shortlisted'::character varying, 'Interview'::character varying, 'Training'::character varying, 'Final Decision'::character varying])::text[]))),
    CONSTRAINT job_applications_submission_type_check CHECK (((submission_type)::text = ANY ((ARRAY['Apply'::character varying, 'Refer a Candidate'::character varying])::text[])))
);


--
-- Name: job_applications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_applications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_applications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_applications_id_seq OWNED BY public.job_applications.id;


--
-- Name: job_vacancies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_vacancies (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    branch character varying(255) NOT NULL,
    governorate character varying(255),
    city_or_area character varying(255),
    sub_area character varying(255),
    neighborhood character varying(255),
    detailed_address text,
    work_type character varying(100),
    required_gender character varying(20),
    required_age_min integer,
    required_age_max integer,
    email character varying(255),
    required_qualification character varying(255),
    required_specialization character varying(255),
    required_certificate character varying(255),
    required_major character varying(255),
    required_experience_years integer,
    required_skills text,
    responsibilities text,
    driving_license_required boolean DEFAULT false,
    vacancy_count integer NOT NULL,
    max_retraining_count integer DEFAULT 1,
    contact_methods jsonb DEFAULT '[]'::jsonb,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status character varying(20) DEFAULT 'Open'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    branch_id integer,
    department_id integer,
    has_car_required boolean DEFAULT false,
    CONSTRAINT chk_vacancy_dates CHECK ((start_date <= end_date)),
    CONSTRAINT job_vacancies_status_check CHECK (((status)::text = ANY ((ARRAY['Open'::character varying, 'Closed'::character varying, 'Archived'::character varying])::text[]))),
    CONSTRAINT job_vacancies_vacancy_count_check CHECK ((vacancy_count >= 0))
);


--
-- Name: job_vacancies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_vacancies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_vacancies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_vacancies_id_seq OWNED BY public.job_vacancies.id;


--
-- Name: maintenance_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_requests (
    id integer NOT NULL,
    request_date timestamp with time zone,
    customer_id integer,
    customer_name character varying(255),
    contract_id integer,
    device_model_name character varying(255),
    priority character varying(50) DEFAULT 'Normal'::character varying,
    problem_description text,
    technician_id integer,
    telemarketer_id integer,
    last_follow_up_date timestamp with time zone,
    resolution_status character varying(50) DEFAULT 'Pending'::character varying,
    visit_type character varying(50),
    location character varying(255),
    notes text,
    technical_report jsonb
);


--
-- Name: maintenance_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.maintenance_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: maintenance_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.maintenance_requests_id_seq OWNED BY public.maintenance_requests.id;


--
-- Name: open_task_delivery_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_task_delivery_results (
    id bigint NOT NULL,
    open_task_id integer NOT NULL,
    outcome character varying(50) NOT NULL,
    serial_number character varying(100),
    device_model_id integer,
    delivery_address text,
    actual_delivery_date date,
    delivered_by_employee_id integer,
    customer_acknowledged boolean DEFAULT false NOT NULL,
    delivery_condition character varying(50),
    delivery_photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT open_task_delivery_results_delivery_condition_check CHECK (((delivery_condition)::text = ANY ((ARRAY['perfect'::character varying, 'minor_damage'::character varying, 'missing_accessories'::character varying])::text[]))),
    CONSTRAINT open_task_delivery_results_outcome_check CHECK (((outcome)::text = ANY ((ARRAY['delivered_successfully'::character varying, 'customer_not_available'::character varying, 'wrong_address'::character varying, 'refused_delivery'::character varying])::text[])))
);


--
-- Name: open_task_delivery_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.open_task_delivery_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: open_task_delivery_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.open_task_delivery_results_id_seq OWNED BY public.open_task_delivery_results.id;


--
-- Name: open_task_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_task_devices (
    id bigint NOT NULL,
    task_id integer NOT NULL,
    device_model_id integer,
    device_name_snapshot character varying(255) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: open_task_devices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.open_task_devices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: open_task_devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.open_task_devices_id_seq OWNED BY public.open_task_devices.id;


--
-- Name: open_task_installation_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_task_installation_results (
    id bigint NOT NULL,
    open_task_id integer NOT NULL,
    outcome character varying(50) NOT NULL,
    water_source_type character varying(50),
    pipe_type character varying(50),
    pipe_length_meters numeric(8,2),
    electrical_connection boolean DEFAULT false NOT NULL,
    wall_mounting_done boolean DEFAULT false NOT NULL,
    installed_accessories jsonb DEFAULT '[]'::jsonb NOT NULL,
    installation_start_date date,
    installation_end_date date,
    before_photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    after_photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    technical_notes text,
    installed_by_employee_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT open_task_installation_results_outcome_check CHECK (((outcome)::text = ANY ((ARRAY['installed_successfully'::character varying, 'installation_incomplete'::character varying, 'site_not_ready'::character varying])::text[])))
);


--
-- Name: open_task_installation_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.open_task_installation_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: open_task_installation_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.open_task_installation_results_id_seq OWNED BY public.open_task_installation_results.id;


--
-- Name: open_task_pre_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_task_pre_offers (
    id bigint NOT NULL,
    open_task_id integer NOT NULL,
    device_model_id integer NOT NULL,
    offer_type character varying(50) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    total_amount numeric NOT NULL,
    first_payment_amount numeric,
    installment_months integer,
    currency character varying(10) NOT NULL,
    discount_percentage numeric,
    closed_by_employee_id integer,
    no_closing_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_device_discount_id integer,
    source_customer_pre_offer_id bigint,
    CONSTRAINT open_task_pre_offers_discount_percentage_check CHECK (((discount_percentage IS NULL) OR (discount_percentage >= (0)::numeric))),
    CONSTRAINT open_task_pre_offers_first_payment_amount_check CHECK (((first_payment_amount IS NULL) OR (first_payment_amount >= (0)::numeric))),
    CONSTRAINT open_task_pre_offers_installment_months_check CHECK (((installment_months IS NULL) OR (installment_months > 0))),
    CONSTRAINT open_task_pre_offers_offer_type_check CHECK (((offer_type)::text = ANY ((ARRAY['cash'::character varying, 'installment'::character varying])::text[]))),
    CONSTRAINT open_task_pre_offers_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT open_task_pre_offers_total_amount_check CHECK ((total_amount >= (0)::numeric))
);


--
-- Name: open_task_pre_offers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.open_task_pre_offers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: open_task_pre_offers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.open_task_pre_offers_id_seq OWNED BY public.open_task_pre_offers.id;


--
-- Name: open_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_tasks (
    id integer NOT NULL,
    client_id integer NOT NULL,
    branch_id integer NOT NULL,
    task_type character varying(50) DEFAULT 'device_demo'::character varying NOT NULL,
    task_family character varying(50) DEFAULT 'marketing'::character varying NOT NULL,
    reason character varying(100) DEFAULT 'new_lead'::character varying NOT NULL,
    status character varying(50) DEFAULT 'open'::character varying NOT NULL,
    due_date date,
    priority character varying(20),
    source character varying(50) DEFAULT 'system'::character varying NOT NULL,
    marketing_visit_task_id character varying(100),
    contact_target_id integer,
    notes text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_snapshot jsonb,
    contract_snapshot jsonb,
    team_snapshot jsonb,
    origin character varying(50) DEFAULT 'manual_entry'::character varying,
    origin_ref_id integer,
    assigned_scope_id integer,
    assigned_team_key character varying(50),
    contract_id integer,
    expected_date date,
    last_waiting_status character varying(20),
    cancellation_reason text,
    waiting_reason_id integer,
    waiting_reason_text text,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_attempt_at timestamp with time zone,
    assigned_for_date date,
    assigned_at timestamp with time zone,
    excluded_for_date date,
    excluded_reason text,
    em_pre_state_id integer,
    em_post_state_id integer,
    em_action_id integer,
    em_costs_id integer,
    device_id integer,
    installment_id integer,
    creation_origin character varying(50),
    assigned_by integer,
    assigned_via character varying(50),
    expected_time character varying(50),
    CONSTRAINT open_tasks_assigned_via_check CHECK (((assigned_via IS NULL) OR ((assigned_via)::text = ANY ((ARRAY['planning_calculation'::character varying, 'telemarketing_booking'::character varying, 'manual_override'::character varying, 'cascading'::character varying])::text[])))),
    CONSTRAINT open_tasks_collection_requires_installment CHECK ((((task_type)::text <> 'collection'::text) OR (installment_id IS NOT NULL))),
    CONSTRAINT open_tasks_creation_origin_check CHECK (((creation_origin IS NULL) OR ((creation_origin)::text = ANY ((ARRAY['branch_plan'::character varying, 'service_request_call'::character varying, 'telemarketing_inline_booking'::character varying, 'cascading_during_visit'::character varying, 'manual_creation'::character varying, 'emergency_request'::character varying, 'system_trigger'::character varying])::text[])))),
    CONSTRAINT open_tasks_last_waiting_status_check CHECK (((last_waiting_status IS NULL) OR ((last_waiting_status)::text = ANY ((ARRAY['open'::character varying, 'needs_follow_up'::character varying])::text[])))),
    CONSTRAINT open_tasks_priority_check CHECK ((((priority)::text = ANY ((ARRAY['high'::character varying, 'medium'::character varying, 'low'::character varying])::text[])) OR (priority IS NULL))),
    CONSTRAINT open_tasks_reason_check CHECK (((reason)::text = ANY ((ARRAY['new_lead'::character varying, 'follow_up'::character varying, 'renewal'::character varying, 'service_request'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT open_tasks_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'needs_follow_up'::character varying, 'assigned'::character varying, 'in_scheduling'::character varying, 'scheduled'::character varying, 'waiting_execution'::character varying, 'in_execution'::character varying, 'ended'::character varying, 'completed'::character varying, 'closed'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT open_tasks_task_family_check CHECK (((task_family)::text = ANY ((ARRAY['marketing'::character varying, 'sales'::character varying, 'delivery'::character varying, 'maintenance'::character varying, 'emergency'::character varying, 'collection'::character varying, 'service'::character varying, 'warranty'::character varying])::text[])))
);


--
-- Name: TABLE open_tasks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.open_tasks IS 'Open marketing/service tasks linked to clients before they become visits';


--
-- Name: COLUMN open_tasks.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.open_tasks.status IS 'open=in_queue, in_contact_list=queued_for_call, scheduled=appointment_set, in_visit=visit_created, completed=done, cancelled=cancelled, needs_reschedule=reschedule_needed';


--
-- Name: COLUMN open_tasks.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.open_tasks.source IS 'DEPRECATED (DEC-004 D13): use creation_origin. Retained for legacy readers (TaskCreationCard, planningMarketingTargets) until Phase 9.';


--
-- Name: COLUMN open_tasks.origin; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.open_tasks.origin IS 'DEPRECATED (DEC-004 D13): subsumed by creation_origin. Always "manual_entry" in current writes. Drop in Phase 9.';


--
-- Name: COLUMN open_tasks.origin_ref_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.open_tasks.origin_ref_id IS 'Retained: backs the "ظ…ط´طھظ‚ظ‘ط© ظ…ظ† #X" UI hint in TaskHeader. Not covered by constitution; kept for operational value.';


--
-- Name: COLUMN open_tasks.creation_origin; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.open_tasks.creation_origin IS 'Canonical task-creation origin per DEC-004 D13. 7 values enumerated by check constraint.';


--
-- Name: COLUMN open_tasks.assigned_via; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.open_tasks.assigned_via IS 'How this task moved into assigned state per DEC-004 D13 (planning_calculation | telemarketing_booking | manual_override | cascading).';


--
-- Name: open_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.open_tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: open_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.open_tasks_id_seq OWNED BY public.open_tasks.id;


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id integer NOT NULL,
    key character varying(150) NOT NULL,
    module character varying(50) NOT NULL,
    sub_module character varying(50) NOT NULL,
    action character varying(50) NOT NULL,
    display_name character varying(255) NOT NULL,
    display_order integer DEFAULT 0,
    allowed_scopes text[] DEFAULT ARRAY['GLOBAL'::text, 'BRANCH'::text, 'ASSIGNED'::text] NOT NULL
);


--
-- Name: COLUMN permissions.allowed_scopes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.permissions.allowed_scopes IS 'Scopes allowed for this permission. Super admin configures this. GLOBAL-only for admin functions, GLOBAL+BRANCH for operational, GLOBAL+BRANCH+ASSIGNED for personal.';


--
-- Name: permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permissions_id_seq OWNED BY public.permissions.id;


--
-- Name: referral_sheets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_sheets (
    id integer NOT NULL,
    referral_type character varying(100) NOT NULL,
    referral_entity_id integer,
    referral_name_snapshot character varying(255),
    referral_address_text text,
    referral_origin_channel character varying(100),
    referral_notes text,
    referral_date character varying(50),
    owner_user_id integer NOT NULL,
    status character varying(50) DEFAULT 'New'::character varying,
    total_candidates integer DEFAULT 0,
    quality_percentage real DEFAULT 0,
    conversion_percentage real DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    created_by integer,
    branch_id integer,
    assigned_hr_user_id integer,
    target_candidates integer DEFAULT 0 NOT NULL,
    field_visit_id integer,
    CONSTRAINT referral_sheets_status_check CHECK (((status)::text = ANY ((ARRAY['New'::character varying, 'In-Progress'::character varying, 'Completed'::character varying, 'Archived'::character varying])::text[])))
);


--
-- Name: referral_sheets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.referral_sheets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: referral_sheets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.referral_sheets_id_seq OWNED BY public.referral_sheets.id;


--
-- Name: referrers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referrers (
    id integer NOT NULL,
    type character varying(20) NOT NULL,
    employee_id integer,
    full_name character varying(255) NOT NULL,
    last_name character varying(255),
    mobile_number character varying(20) NOT NULL,
    governorate character varying(255),
    city_or_area character varying(255),
    sub_area character varying(255),
    neighborhood character varying(255),
    detailed_address text,
    referrer_work character varying(255),
    referrer_notes text,
    created_at timestamp with time zone DEFAULT now(),
    referral_entity_id integer,
    CONSTRAINT referrers_type_check CHECK (((type)::text = ANY ((ARRAY['Employee'::character varying, 'Client'::character varying, 'Personal'::character varying, 'Unknown'::character varying, 'Customer'::character varying])::text[])))
);


--
-- Name: referrers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.referrers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: referrers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.referrers_id_seq OWNED BY public.referrers.id;


--
-- Name: role_job_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_job_tasks (
    id integer NOT NULL,
    role_id integer NOT NULL,
    title text NOT NULL,
    description text,
    display_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: role_job_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.role_job_tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: role_job_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.role_job_tasks_id_seq OWNED BY public.role_job_tasks.id;


--
-- Name: role_permission_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permission_grants (
    id integer NOT NULL,
    role_id integer NOT NULL,
    permission_id integer NOT NULL,
    scope_type character varying(16) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT role_permission_grants_scope_type_ck CHECK (((scope_type)::text = ANY ((ARRAY['GLOBAL'::character varying, 'BRANCH'::character varying, 'ASSIGNED'::character varying])::text[])))
);


--
-- Name: role_permission_grants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.role_permission_grants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: role_permission_grants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.role_permission_grants_id_seq OWNED BY public.role_permission_grants.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    id integer NOT NULL,
    role_id integer NOT NULL,
    permission_id integer NOT NULL
);


--
-- Name: role_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.role_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: role_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.role_permissions_id_seq OWNED BY public.role_permissions.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    display_name character varying(255) NOT NULL,
    description text,
    is_system boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    branch_id integer,
    is_template boolean DEFAULT false NOT NULL,
    template_id integer,
    is_protected boolean DEFAULT false NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    protected_reason text,
    team_slot_type text,
    CONSTRAINT chk_roles_team_slot_type CHECK ((team_slot_type = ANY (ARRAY['SUPERVISOR'::text, 'TECHNICIAN'::text, 'TRAINEE'::text, 'TELEMARKETER'::text]))),
    CONSTRAINT roles_scope_ck CHECK ((((is_template = true) AND (branch_id IS NULL)) OR ((is_template = false) AND (branch_id IS NOT NULL))))
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: route_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.route_assignments (
    key character varying(255) NOT NULL,
    routes jsonb DEFAULT '[]'::jsonb,
    extra_zones jsonb DEFAULT '[]'::jsonb,
    station_order jsonb DEFAULT '[]'::jsonb
);


--
-- Name: route_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.route_points (
    id integer NOT NULL,
    route_id integer NOT NULL,
    geo_unit_id integer NOT NULL,
    level integer NOT NULL,
    point_order integer NOT NULL
);


--
-- Name: route_points_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.route_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.route_points_id_seq OWNED BY public.route_points.id;


--
-- Name: routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routes (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying
);


--
-- Name: routes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routes_id_seq OWNED BY public.routes.id;


--
-- Name: scope_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scope_tasks (
    id integer NOT NULL,
    scope_id integer NOT NULL,
    open_task_id integer NOT NULL,
    team_key character varying(50) NOT NULL,
    branch_id integer NOT NULL,
    added_at timestamp without time zone DEFAULT now(),
    added_by integer
);


--
-- Name: scope_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scope_tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scope_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scope_tasks_id_seq OWNED BY public.scope_tasks.id;


--
-- Name: service_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_agreements (
    id integer NOT NULL,
    agreement_number character varying(50),
    customer_id integer NOT NULL,
    customer_name character varying(255) NOT NULL,
    branch_id integer,
    agreement_date date NOT NULL,
    external_device_model_name character varying(255),
    external_device_serial character varying(255),
    external_device_notes text,
    maintenance_plan character varying(20),
    visits_count integer,
    fee_syp numeric DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    start_date date,
    end_date date,
    closing_employee_id integer,
    created_by integer,
    legacy_contract_id integer,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_agreements_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'cancelled'::character varying, 'completed'::character varying, 'discarded'::character varying])::text[])))
);


--
-- Name: service_agreements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.service_agreements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: service_agreements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.service_agreements_id_seq OWNED BY public.service_agreements.id;


--
-- Name: spare_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spare_parts (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(100),
    base_price numeric DEFAULT 0,
    maintenance_type character varying(50),
    compatible_device_ids jsonb DEFAULT '[]'::jsonb,
    deleted_at timestamp with time zone,
    CONSTRAINT spare_parts_maintenance_type_check CHECK (((maintenance_type)::text = ANY ((ARRAY['Periodic'::character varying, 'Emergency'::character varying, 'Accessory'::character varying])::text[])))
);


--
-- Name: spare_parts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.spare_parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: spare_parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.spare_parts_id_seq OWNED BY public.spare_parts.id;


--
-- Name: system_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_lists (
    id integer NOT NULL,
    category character varying(100) NOT NULL,
    value character varying(255) NOT NULL,
    is_active boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    linked_role_id integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: system_lists_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_lists_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_lists_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_lists_id_seq OWNED BY public.system_lists.id;


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id integer NOT NULL,
    key character varying(150) NOT NULL,
    value text NOT NULL,
    value_type character varying(20) NOT NULL,
    category character varying(50),
    description text,
    is_editable boolean DEFAULT true,
    updated_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT system_settings_value_type_check CHECK (((value_type)::text = ANY ((ARRAY['integer'::character varying, 'string'::character varying, 'boolean'::character varying, 'time'::character varying, 'date'::character varying, 'json'::character varying])::text[])))
);


--
-- Name: system_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_settings_id_seq OWNED BY public.system_settings.id;


--
-- Name: task_activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_activity_log (
    id bigint NOT NULL,
    task_id integer NOT NULL,
    event_type character varying(50) NOT NULL,
    performed_by integer,
    role character varying(50),
    old_value text,
    new_value text,
    reason text,
    reference_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_activity_log_event_type_check CHECK (((event_type)::text = ANY (ARRAY['status_change'::text, 'note_added'::text, 'rescheduled'::text, 'assigned'::text, 'reassigned'::text, 'call_made'::text, 'priority_changed'::text, 'team_assigned'::text, 'team_changed'::text, 'lifecycle_skip'::text])))
);


--
-- Name: task_activity_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_activity_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_activity_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_activity_log_id_seq OWNED BY public.task_activity_log.id;


--
-- Name: task_type_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_type_config (
    task_type character varying(50) NOT NULL,
    task_family character varying(50) NOT NULL,
    arabic_label character varying(255) NOT NULL,
    scheduling_pattern character varying(30) NOT NULL,
    window_basis character varying(20) NOT NULL,
    planning_window_days integer,
    contract_required boolean DEFAULT true NOT NULL,
    allow_multiple boolean DEFAULT false NOT NULL,
    has_due_date boolean DEFAULT false NOT NULL,
    display_order integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    location_basis character varying(20) DEFAULT 'client'::character varying NOT NULL,
    contact_target_visit_type character varying(50),
    CONSTRAINT task_type_config_basis_check CHECK (((window_basis)::text = ANY ((ARRAY['none'::character varying, 'due_date'::character varying, 'expected_date'::character varying])::text[]))),
    CONSTRAINT task_type_config_contact_target_visit_type_check CHECK (((contact_target_visit_type IS NULL) OR ((contact_target_visit_type)::text = ANY ((ARRAY['marketing'::character varying, 'service'::character varying, 'collection'::character varying])::text[])))),
    CONSTRAINT task_type_config_location_basis_check CHECK (((location_basis)::text = ANY ((ARRAY['client'::character varying, 'contract'::character varying])::text[]))),
    CONSTRAINT task_type_config_pattern_check CHECK (((scheduling_pattern)::text = ANY ((ARRAY['immediate'::character varying, 'short_window'::character varying, 'long_window'::character varying, 'expected_window'::character varying])::text[]))),
    CONSTRAINT task_type_config_window_consistency_check CHECK (((((scheduling_pattern)::text = 'immediate'::text) AND ((window_basis)::text = 'none'::text) AND (planning_window_days IS NULL)) OR (((scheduling_pattern)::text = 'short_window'::text) AND ((window_basis)::text = 'due_date'::text) AND (planning_window_days IS NOT NULL)) OR (((scheduling_pattern)::text = 'long_window'::text) AND ((window_basis)::text = 'due_date'::text) AND (planning_window_days IS NOT NULL)) OR (((scheduling_pattern)::text = 'expected_window'::text) AND ((window_basis)::text = 'expected_date'::text) AND (planning_window_days IS NOT NULL))))
);


--
-- Name: COLUMN task_type_config.planning_window_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.task_type_config.planning_window_days IS 'Alias of `lead_window_days` in DEC-005 D26. Days before due/expected date when the task appears in contact_targets. Constitution reconciliation pending Phase 10.';


--
-- Name: COLUMN task_type_config.contact_target_visit_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.task_type_config.contact_target_visit_type IS 'Category used when this task_type emits a contact_target (DEC-005 D24). When a single contact_target aggregates tasks of mixed categories, the application sets contact_targets.visit_type = "mixed" instead of using this value directly.';


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id integer NOT NULL,
    type character varying(50) NOT NULL,
    customer_name character varying(255) NOT NULL,
    context text,
    location character varying(255),
    due_date date,
    status character varying(50) DEFAULT 'pending'::character varying,
    priority character varying(50),
    branch_id integer,
    CONSTRAINT tasks_priority_check CHECK (((priority)::text = ANY ((ARRAY['high'::character varying, 'medium'::character varying, 'low'::character varying])::text[]))),
    CONSTRAINT tasks_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in-progress'::character varying, 'completed'::character varying])::text[]))),
    CONSTRAINT tasks_type_check CHECK (((type)::text = ANY ((ARRAY['emergency'::character varying, 'dues'::character varying, 'periodic'::character varying, 'returns'::character varying, 'followup'::character varying])::text[])))
);


--
-- Name: tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;


--
-- Name: telemarketing_appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemarketing_appointments (
    id character varying(100) NOT NULL,
    entity_type character varying(20) NOT NULL,
    entity_id integer NOT NULL,
    customer_name character varying(255) NOT NULL,
    customer_address text,
    customer_mobile character varying(50),
    team_key character varying(100) NOT NULL,
    date character varying(50) NOT NULL,
    time_slot character varying(50) NOT NULL,
    occupation character varying(255),
    water_source character varying(255),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    created_by integer,
    branch_id integer,
    contact_target_id bigint,
    visit_tasks jsonb DEFAULT '["device_demo"]'::jsonb,
    requested_device_model_id integer,
    requested_device_name text,
    open_task_id integer,
    answered_by character varying(50),
    CONSTRAINT telemarketing_appointments_entity_type_check CHECK (((entity_type)::text = ANY ((ARRAY['candidate'::character varying, 'client'::character varying])::text[])))
);


--
-- Name: telemarketing_call_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemarketing_call_logs (
    id character varying(100) NOT NULL,
    entity_type character varying(20) NOT NULL,
    entity_id integer NOT NULL,
    task_list_id character varying(100),
    team_key character varying(100) NOT NULL,
    outcome character varying(50) NOT NULL,
    contact_label character varying(255),
    contact_number character varying(50),
    notes text,
    "timestamp" timestamp with time zone DEFAULT now(),
    called_by integer,
    communication_method character varying(30),
    branch_id integer,
    contact_target_id bigint,
    CONSTRAINT telemarketing_call_logs_entity_type_check CHECK (((entity_type)::text = ANY ((ARRAY['candidate'::character varying, 'client'::character varying])::text[]))),
    CONSTRAINT telemarketing_call_logs_outcome_check CHECK (((outcome)::text = ANY (ARRAY['no_answer'::text, 'busy'::text, 'out_of_coverage'::text, 'not_in_service'::text, 'wrong_number'::text, 'auto_disconnected'::text, 'currently_busy'::text, 'interrupted'::text, 'not_interested'::text, 'address_updated'::text, 'customer_requested_followup'::text, 'service_request'::text, 'company_customer_missing_phone'::text, 'booked_marketing_appointment'::text, 'new_number'::text, 'message_sent'::text, 'other_company_not_interested'::text, 'seen_offer_not_interested'::text, 'other_company_callback'::text, 'seen_offer_callback'::text, 'rejected'::text, 'booked'::text])))
);


--
-- Name: CONSTRAINT telemarketing_call_logs_outcome_check ON telemarketing_call_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT telemarketing_call_logs_outcome_check ON public.telemarketing_call_logs IS 'DEC-006 D39 outcome vocabulary. Active outcomes: 16. Legacy outcomes (other_company_*, seen_offer_*, rejected, booked) retained for historical rows; will be dropped in Phase 9 after backfill.';


--
-- Name: telemarketing_task_list_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemarketing_task_list_items (
    id character varying(100) NOT NULL,
    task_list_id character varying(100) NOT NULL,
    entity_type character varying(20) NOT NULL,
    entity_id integer NOT NULL,
    name character varying(255) NOT NULL,
    mobile character varying(50) NOT NULL,
    contact_number character varying(50),
    contact_label character varying(255),
    address_text text,
    geo_unit_id integer,
    status character varying(20) DEFAULT 'pending'::character varying,
    call_outcome character varying(50),
    contact_target_id bigint,
    open_task_id integer,
    CONSTRAINT telemarketing_task_list_items_entity_type_check CHECK (((entity_type)::text = ANY ((ARRAY['candidate'::character varying, 'client'::character varying])::text[]))),
    CONSTRAINT telemarketing_task_list_items_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'called'::character varying, 'booked'::character varying])::text[])))
);


--
-- Name: telemarketing_task_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemarketing_task_lists (
    id character varying(100) NOT NULL,
    team_key character varying(100) NOT NULL,
    date character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    branch_id integer
);


--
-- Name: training_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_attendance (
    id integer NOT NULL,
    training_course_id integer NOT NULL,
    application_id integer NOT NULL,
    attendance_date date NOT NULL,
    status character varying(20) NOT NULL,
    recorded_by_user_id integer,
    CONSTRAINT training_attendance_status_check CHECK (((status)::text = ANY ((ARRAY['Present'::character varying, 'Absent'::character varying])::text[])))
);


--
-- Name: training_attendance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.training_attendance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: training_attendance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.training_attendance_id_seq OWNED BY public.training_attendance.id;


--
-- Name: training_course_trainees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_course_trainees (
    id integer NOT NULL,
    training_course_id integer NOT NULL,
    application_id integer NOT NULL,
    result character varying(30),
    result_recorded_at timestamp with time zone,
    result_recorded_by integer,
    added_at timestamp with time zone DEFAULT now(),
    CONSTRAINT training_course_trainees_result_check CHECK (((result)::text = ANY ((ARRAY['Passed'::character varying, 'Retraining'::character varying, 'Rejected'::character varying, 'Retreated'::character varying])::text[])))
);


--
-- Name: training_course_trainees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.training_course_trainees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: training_course_trainees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.training_course_trainees_id_seq OWNED BY public.training_course_trainees.id;


--
-- Name: training_courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_courses (
    id integer NOT NULL,
    training_name character varying(255) NOT NULL,
    job_vacancy_id integer,
    branch character varying(255),
    device_name character varying(255),
    trainer character varying(255) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    training_status character varying(30) DEFAULT 'Training Scheduled'::character varying,
    notes text,
    created_by_user_id integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    branch_id integer,
    CONSTRAINT training_courses_training_status_check CHECK (((training_status)::text = ANY ((ARRAY['Training Scheduled'::character varying, 'Training Started'::character varying, 'Training Completed'::character varying])::text[])))
);


--
-- Name: training_courses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.training_courses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: training_courses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.training_courses_id_seq OWNED BY public.training_courses.id;


--
-- Name: user_branch_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_branch_assignments (
    id integer NOT NULL,
    user_id integer NOT NULL,
    branch_id integer NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_branch_assignments_status_ck CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


--
-- Name: user_branch_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_branch_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_branch_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_branch_assignments_id_seq OWNED BY public.user_branch_assignments.id;


--
-- Name: visit_escalation_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_escalation_alerts (
    id integer NOT NULL,
    visit_id bigint NOT NULL,
    tier smallint NOT NULL,
    alerted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visit_escalation_alerts_tier_check CHECK ((tier = ANY (ARRAY[1, 2, 3])))
);


--
-- Name: visit_escalation_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visit_escalation_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visit_escalation_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visit_escalation_alerts_id_seq OWNED BY public.visit_escalation_alerts.id;


--
-- Name: visit_geo_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_geo_logs (
    id integer NOT NULL,
    visit_id integer NOT NULL,
    actual_start_time timestamp without time zone,
    actual_start_lat numeric(10,8),
    actual_start_lng numeric(11,8),
    actual_start_accuracy integer,
    actual_end_time timestamp without time zone,
    actual_end_lat numeric(10,8),
    actual_end_lng numeric(11,8),
    actual_end_accuracy integer,
    duration_minutes integer,
    distance_meters integer,
    location_missing boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    started_by integer,
    ended_by integer,
    location_missing_reason integer
);


--
-- Name: COLUMN visit_geo_logs.started_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.visit_geo_logs.started_by IS 'hr_users.id who triggered POST /field-visits/:id/start (DEC-004 D17).';


--
-- Name: COLUMN visit_geo_logs.ended_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.visit_geo_logs.ended_by IS 'hr_users.id who triggered POST /field-visits/:id/end (DEC-004 D17).';


--
-- Name: COLUMN visit_geo_logs.location_missing_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.visit_geo_logs.location_missing_reason IS 'Required when location_missing = TRUE. Reference to system_lists category=location_missing_reasons (DEC-004 D17). Enforcement at application layer until Phase 7 lifecycle refinement.';


--
-- Name: visit_geo_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visit_geo_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visit_geo_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visit_geo_logs_id_seq OWNED BY public.visit_geo_logs.id;


--
-- Name: visit_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_sources (
    id integer NOT NULL,
    visit_id integer NOT NULL,
    source_type character varying(50) NOT NULL,
    source_label character varying(255) NOT NULL,
    actor_employee_ids integer[] DEFAULT '{}'::integer[],
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT visit_sources_source_type_check CHECK (((source_type)::text = ANY ((ARRAY['supervisor'::character varying, 'technician'::character varying, 'both'::character varying, 'company_branch'::character varying, 'company_global'::character varying])::text[])))
);


--
-- Name: visit_sources_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visit_sources_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visit_sources_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visit_sources_id_seq OWNED BY public.visit_sources.id;


--
-- Name: visit_surveys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_surveys (
    id integer NOT NULL,
    field_visit_id integer NOT NULL,
    is_skipped boolean DEFAULT false NOT NULL,
    skip_reason character varying(255),
    filled_by_user_id integer,
    filled_at timestamp with time zone,
    household_members_count integer,
    drinking_water_source text,
    tds_test_result integer,
    hardness_test_drops integer,
    demo_kit_tds_result integer,
    customer_opinion_water_source text,
    customer_opinion_demo_kit text,
    customer_opinion_purification_idea text,
    customer_purchase_intent boolean,
    expected_payment_method text,
    area_evaluation character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visit_surveys_filled_or_skipped CHECK ((((is_skipped = true) AND (skip_reason IS NOT NULL) AND (household_members_count IS NULL) AND (drinking_water_source IS NULL) AND (tds_test_result IS NULL) AND (hardness_test_drops IS NULL) AND (demo_kit_tds_result IS NULL) AND (customer_opinion_water_source IS NULL) AND (customer_opinion_demo_kit IS NULL) AND (customer_opinion_purification_idea IS NULL) AND (customer_purchase_intent IS NULL) AND (expected_payment_method IS NULL) AND (area_evaluation IS NULL)) OR ((is_skipped = false) AND (filled_by_user_id IS NOT NULL) AND (filled_at IS NOT NULL) AND (household_members_count IS NOT NULL) AND (drinking_water_source IS NOT NULL) AND (tds_test_result IS NOT NULL) AND (hardness_test_drops IS NOT NULL) AND (demo_kit_tds_result IS NOT NULL) AND (customer_opinion_water_source IS NOT NULL) AND (customer_opinion_demo_kit IS NOT NULL) AND (customer_opinion_purification_idea IS NOT NULL) AND (customer_purchase_intent IS NOT NULL) AND (expected_payment_method IS NOT NULL) AND (area_evaluation IS NOT NULL))))
);


--
-- Name: visit_surveys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visit_surveys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visit_surveys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visit_surveys_id_seq OWNED BY public.visit_surveys.id;


--
-- Name: visit_task_device_activation_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_task_device_activation_results (
    id bigint NOT NULL,
    visit_task_result_id bigint CONSTRAINT visit_task_device_activation_resu_visit_task_result_id_not_null NOT NULL,
    outcome character varying(50) NOT NULL,
    tds_before numeric,
    tds_after numeric,
    pump_pressure numeric,
    membrane_output character varying(50),
    tank_pressure numeric,
    uv_status character varying(50),
    customer_trained boolean DEFAULT false NOT NULL,
    training_notes text,
    activation_photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    activated_by_employee_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visit_task_device_activation_results_outcome_check CHECK (((outcome)::text = ANY ((ARRAY['activated_successfully'::character varying, 'activation_failed'::character varying, 'device_issue'::character varying])::text[])))
);


--
-- Name: visit_task_device_activation_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visit_task_device_activation_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visit_task_device_activation_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visit_task_device_activation_results_id_seq OWNED BY public.visit_task_device_activation_results.id;


--
-- Name: visit_task_device_delivery_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_task_device_delivery_results (
    id bigint NOT NULL,
    visit_task_result_id bigint CONSTRAINT visit_task_device_delivery_result_visit_task_result_id_not_null NOT NULL,
    serial_number character varying(100),
    device_model_id integer,
    delivery_address text,
    actual_delivery_date date,
    delivered_by_employee_id integer,
    customer_acknowledged boolean DEFAULT false,
    delivery_photos jsonb DEFAULT '[]'::jsonb,
    delivery_condition character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    outcome character varying(50),
    delivery_lat numeric(10,7),
    delivery_lng numeric(10,7),
    notes text,
    CONSTRAINT visit_task_device_delivery_results_delivery_condition_check CHECK (((delivery_condition)::text = ANY ((ARRAY['perfect'::character varying, 'minor_damage'::character varying, 'missing_accessories'::character varying])::text[]))),
    CONSTRAINT visit_task_device_delivery_results_outcome_check CHECK (((outcome)::text = ANY ((ARRAY['delivered_successfully'::character varying, 'customer_not_available'::character varying, 'wrong_address'::character varying, 'refused_delivery'::character varying])::text[])))
);


--
-- Name: visit_task_device_delivery_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visit_task_device_delivery_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visit_task_device_delivery_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visit_task_device_delivery_results_id_seq OWNED BY public.visit_task_device_delivery_results.id;


--
-- Name: visit_task_device_demo_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_task_device_demo_results (
    id bigint NOT NULL,
    visit_task_result_id bigint NOT NULL,
    offer_type character varying(50),
    offer_amount numeric,
    installment_months integer,
    closed_by_employee_id integer,
    contract_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    discount_percentage numeric,
    sale_reference_number character varying(5),
    is_device_sold boolean DEFAULT false,
    offered_device_model_id integer,
    CONSTRAINT visit_task_device_demo_results_discount_percentage_check CHECK (((discount_percentage >= (0)::numeric) AND (discount_percentage <= (100)::numeric))),
    CONSTRAINT visit_task_device_demo_results_installment_months_check CHECK (((installment_months IS NULL) OR (installment_months > 0))),
    CONSTRAINT visit_task_device_demo_results_offer_amount_check CHECK (((offer_amount IS NULL) OR (offer_amount >= (0)::numeric))),
    CONSTRAINT visit_task_device_demo_results_offer_type_check CHECK (((offer_type IS NULL) OR ((offer_type)::text = ANY ((ARRAY['cash'::character varying, 'installment'::character varying])::text[]))))
);


--
-- Name: visit_task_device_demo_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visit_task_device_demo_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visit_task_device_demo_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visit_task_device_demo_results_id_seq OWNED BY public.visit_task_device_demo_results.id;


--
-- Name: visit_task_device_installation_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_task_device_installation_results (
    id bigint NOT NULL,
    visit_task_result_id bigint CONSTRAINT visit_task_device_installation_re_visit_task_result_id_not_null NOT NULL,
    outcome character varying(50) NOT NULL,
    water_source_type character varying(50),
    pipe_type character varying(50),
    pipe_length_meters numeric(8,2),
    electrical_connection boolean DEFAULT false CONSTRAINT visit_task_device_installation_r_electrical_connection_not_null NOT NULL,
    wall_mounting_done boolean DEFAULT false CONSTRAINT visit_task_device_installation_resu_wall_mounting_done_not_null NOT NULL,
    installed_accessories jsonb DEFAULT '[]'::jsonb CONSTRAINT visit_task_device_installation_r_installed_accessories_not_null NOT NULL,
    installation_start_date date,
    installation_end_date date,
    before_photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    after_photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    technical_notes text,
    installed_by_employee_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visit_task_device_installation_results_outcome_check CHECK (((outcome)::text = ANY ((ARRAY['installed_successfully'::character varying, 'installation_incomplete'::character varying, 'site_not_ready'::character varying])::text[])))
);


--
-- Name: visit_task_device_installation_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visit_task_device_installation_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visit_task_device_installation_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visit_task_device_installation_results_id_seq OWNED BY public.visit_task_device_installation_results.id;


--
-- Name: visit_task_emergency_financials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_task_emergency_financials (
    id bigint NOT NULL,
    labor_cost numeric,
    parts_cost numeric,
    total_cost numeric,
    payment_method character varying(50),
    collected_amount numeric,
    invoice_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    visit_task_result_id bigint NOT NULL,
    CONSTRAINT visit_task_emergency_financials_collected_amount_check CHECK (((collected_amount IS NULL) OR (collected_amount >= (0)::numeric))),
    CONSTRAINT visit_task_emergency_financials_labor_cost_check CHECK (((labor_cost IS NULL) OR (labor_cost >= (0)::numeric))),
    CONSTRAINT visit_task_emergency_financials_parts_cost_check CHECK (((parts_cost IS NULL) OR (parts_cost >= (0)::numeric))),
    CONSTRAINT visit_task_emergency_financials_total_cost_check CHECK (((total_cost IS NULL) OR (total_cost >= (0)::numeric)))
);


--
-- Name: visit_task_emergency_financials_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visit_task_emergency_financials_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visit_task_emergency_financials_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visit_task_emergency_financials_id_seq OWNED BY public.visit_task_emergency_financials.id;


--
-- Name: visit_task_emergency_parts_used; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_task_emergency_parts_used (
    id bigint NOT NULL,
    spare_part_id integer,
    part_name_snapshot character varying(255) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    visit_task_result_id bigint NOT NULL,
    old_part_removed boolean DEFAULT false,
    CONSTRAINT visit_task_emergency_parts_used_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT visit_task_emergency_parts_used_unit_price_check CHECK (((unit_price IS NULL) OR (unit_price >= (0)::numeric)))
);


--
-- Name: visit_task_emergency_parts_used_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visit_task_emergency_parts_used_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visit_task_emergency_parts_used_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visit_task_emergency_parts_used_id_seq OWNED BY public.visit_task_emergency_parts_used.id;


--
-- Name: visit_task_emergency_technical_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_task_emergency_technical_states (
    id bigint NOT NULL,
    problem_confirmed boolean,
    technical_notes text,
    water_tds_before numeric,
    water_tds_after numeric,
    pump_pressure numeric,
    membrane_output character varying(50),
    tank_pressure numeric,
    low_pressure_switch character varying(100),
    high_pressure_switch character varying(100),
    solenoid_valve character varying(100),
    uv_status character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    visit_task_result_id bigint CONSTRAINT visit_task_emergency_technical_st_visit_task_result_id_not_null NOT NULL,
    CONSTRAINT visit_task_emergency_technical_states_membrane_output_check CHECK (((membrane_output IS NULL) OR ((membrane_output)::text = ANY ((ARRAY['Good'::character varying, 'Weak'::character varying, 'Dead'::character varying])::text[]))))
);


--
-- Name: visit_task_emergency_technical_states_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visit_task_emergency_technical_states_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visit_task_emergency_technical_states_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visit_task_emergency_technical_states_id_seq OWNED BY public.visit_task_emergency_technical_states.id;


--
-- Name: visit_task_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_task_results (
    id bigint NOT NULL,
    visit_task_id bigint NOT NULL,
    final_decision character varying(100) NOT NULL,
    reason_code character varying(100),
    closing_notes text,
    closed_by integer,
    closed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: visit_task_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visit_task_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visit_task_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visit_task_results_id_seq OWNED BY public.visit_task_results.id;


--
-- Name: visit_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_tasks (
    id bigint NOT NULL,
    field_visit_id bigint NOT NULL,
    source_open_task_id integer,
    task_type character varying(50) NOT NULL,
    task_family character varying(50) NOT NULL,
    sequence_no integer DEFAULT 1 NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    execution_notes text,
    source_legacy_type character varying(50),
    source_legacy_id character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    legacy_result character varying(50),
    contract_id integer,
    contract_snapshot jsonb,
    CONSTRAINT visit_tasks_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'not_completed'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT visit_tasks_task_family_check CHECK (((task_family)::text = ANY ((ARRAY['marketing'::character varying, 'service'::character varying])::text[]))),
    CONSTRAINT visit_tasks_task_type_check CHECK (((task_type)::text = ANY ((ARRAY['device_demo'::character varying, 'emergency_maintenance'::character varying, 'device_delivery'::character varying, 'device_installation'::character varying, 'device_activation'::character varying])::text[])))
);


--
-- Name: visit_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visit_tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visit_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visit_tasks_id_seq OWNED BY public.visit_tasks.id;


--
-- Name: visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visits (
    id character varying(100) NOT NULL,
    date character varying(50),
    customer_id integer,
    employee_id integer,
    employee_name character varying(255),
    outcome character varying(50) DEFAULT 'Pending'::character varying,
    notes text,
    CONSTRAINT visits_outcome_check CHECK (((outcome)::text = ANY ((ARRAY['Pending'::character varying, 'Completed'::character varying, 'Cancelled'::character varying])::text[])))
);


--
-- Name: work_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_scopes (
    id integer NOT NULL,
    branch_id integer NOT NULL,
    date date NOT NULL,
    team_key character varying(50) NOT NULL,
    zone_ids integer[] DEFAULT '{}'::integer[],
    scope_type character varying(50) DEFAULT 'mixed'::character varying,
    status character varying(50) DEFAULT 'draft'::character varying,
    generated_at timestamp without time zone DEFAULT now(),
    generated_by integer
);


--
-- Name: work_scopes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_scopes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_scopes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_scopes_id_seq OWNED BY public.work_scopes.id;


--
-- Name: applicants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applicants ALTER COLUMN id SET DEFAULT nextval('public.applicants_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: branches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches ALTER COLUMN id SET DEFAULT nextval('public.branches_id_seq'::regclass);


--
-- Name: candidate_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_assignments ALTER COLUMN id SET DEFAULT nextval('public.candidate_assignments_id_seq'::regclass);


--
-- Name: candidates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates ALTER COLUMN id SET DEFAULT nextval('public.candidates_id_seq'::regclass);


--
-- Name: client_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_assignments ALTER COLUMN id SET DEFAULT nextval('public.client_assignments_id_seq'::regclass);


--
-- Name: client_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_audit_log ALTER COLUMN id SET DEFAULT nextval('public.client_audit_log_id_seq'::regclass);


--
-- Name: clients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients ALTER COLUMN id SET DEFAULT nextval('public.clients_id_seq'::regclass);


--
-- Name: contact_targets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_targets ALTER COLUMN id SET DEFAULT nextval('public.contact_targets_id_seq'::regclass);


--
-- Name: contract_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_documents ALTER COLUMN id SET DEFAULT nextval('public.contract_documents_id_seq'::regclass);


--
-- Name: contract_installments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_installments ALTER COLUMN id SET DEFAULT nextval('public.contract_installments_id_seq'::regclass);


--
-- Name: contract_line_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_line_items ALTER COLUMN id SET DEFAULT nextval('public.contract_line_items_id_seq'::regclass);


--
-- Name: contract_payment_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_payment_entries ALTER COLUMN id SET DEFAULT nextval('public.contract_payment_entries_id_seq'::regclass);


--
-- Name: contracts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts ALTER COLUMN id SET DEFAULT nextval('public.contracts_id_seq'::regclass);


--
-- Name: customer_device_pre_offers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_device_pre_offers ALTER COLUMN id SET DEFAULT nextval('public.customer_device_pre_offers_id_seq'::regclass);


--
-- Name: departments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments ALTER COLUMN id SET DEFAULT nextval('public.departments_id_seq'::regclass);


--
-- Name: device_discounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_discounts ALTER COLUMN id SET DEFAULT nextval('public.device_discounts_id_seq'::regclass);


--
-- Name: device_installed_parts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_installed_parts ALTER COLUMN id SET DEFAULT nextval('public.device_installed_parts_id_seq'::regclass);


--
-- Name: device_models id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_models ALTER COLUMN id SET DEFAULT nextval('public.device_models_id_seq'::regclass);


--
-- Name: device_possession_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_possession_log ALTER COLUMN id SET DEFAULT nextval('public.device_possession_log_id_seq'::regclass);


--
-- Name: device_technical_states id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_technical_states ALTER COLUMN id SET DEFAULT nextval('public.device_technical_states_id_seq'::regclass);


--
-- Name: device_warranties id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_warranties ALTER COLUMN id SET DEFAULT nextval('public.device_warranties_id_seq'::regclass);


--
-- Name: direct_suggestions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_suggestions ALTER COLUMN id SET DEFAULT nextval('public.direct_suggestions_id_seq'::regclass);


--
-- Name: dues id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dues ALTER COLUMN id SET DEFAULT nextval('public.dues_id_seq'::regclass);


--
-- Name: emergency_action_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_action_types ALTER COLUMN id SET DEFAULT nextval('public.emergency_action_types_id_seq'::regclass);


--
-- Name: emergency_installments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_installments ALTER COLUMN id SET DEFAULT nextval('public.emergency_installments_id_seq'::regclass);


--
-- Name: emergency_maintenance_actions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_maintenance_actions ALTER COLUMN id SET DEFAULT nextval('public.emergency_maintenance_actions_id_seq'::regclass);


--
-- Name: emergency_payment_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_payment_entries ALTER COLUMN id SET DEFAULT nextval('public.emergency_payment_entries_id_seq'::regclass);


--
-- Name: emergency_result_costs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_result_costs ALTER COLUMN id SET DEFAULT nextval('public.emergency_result_costs_id_seq'::regclass);


--
-- Name: emergency_result_parts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_result_parts ALTER COLUMN id SET DEFAULT nextval('public.emergency_result_parts_id_seq'::regclass);


--
-- Name: emergency_tickets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_tickets ALTER COLUMN id SET DEFAULT nextval('public.emergency_tickets_id_seq'::regclass);


--
-- Name: employees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees ALTER COLUMN id SET DEFAULT nextval('public.employees_id_seq'::regclass);


--
-- Name: field_visits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_visits ALTER COLUMN id SET DEFAULT nextval('public.field_visits_id_seq'::regclass);


--
-- Name: geo_units id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_units ALTER COLUMN id SET DEFAULT nextval('public.geo_units_id_seq'::regclass);


--
-- Name: hr_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_users ALTER COLUMN id SET DEFAULT nextval('public.hr_users_id_seq'::regclass);


--
-- Name: installed_devices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installed_devices ALTER COLUMN id SET DEFAULT nextval('public.installed_devices_id_seq'::regclass);


--
-- Name: interviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interviews ALTER COLUMN id SET DEFAULT nextval('public.interviews_id_seq'::regclass);


--
-- Name: job_applications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_applications ALTER COLUMN id SET DEFAULT nextval('public.job_applications_id_seq'::regclass);


--
-- Name: job_vacancies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_vacancies ALTER COLUMN id SET DEFAULT nextval('public.job_vacancies_id_seq'::regclass);


--
-- Name: maintenance_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_requests ALTER COLUMN id SET DEFAULT nextval('public.maintenance_requests_id_seq'::regclass);


--
-- Name: open_task_delivery_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_delivery_results ALTER COLUMN id SET DEFAULT nextval('public.open_task_delivery_results_id_seq'::regclass);


--
-- Name: open_task_devices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_devices ALTER COLUMN id SET DEFAULT nextval('public.open_task_devices_id_seq'::regclass);


--
-- Name: open_task_installation_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_installation_results ALTER COLUMN id SET DEFAULT nextval('public.open_task_installation_results_id_seq'::regclass);


--
-- Name: open_task_pre_offers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_pre_offers ALTER COLUMN id SET DEFAULT nextval('public.open_task_pre_offers_id_seq'::regclass);


--
-- Name: open_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks ALTER COLUMN id SET DEFAULT nextval('public.open_tasks_id_seq'::regclass);


--
-- Name: permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions ALTER COLUMN id SET DEFAULT nextval('public.permissions_id_seq'::regclass);


--
-- Name: referral_sheets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_sheets ALTER COLUMN id SET DEFAULT nextval('public.referral_sheets_id_seq'::regclass);


--
-- Name: referrers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrers ALTER COLUMN id SET DEFAULT nextval('public.referrers_id_seq'::regclass);


--
-- Name: role_job_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_job_tasks ALTER COLUMN id SET DEFAULT nextval('public.role_job_tasks_id_seq'::regclass);


--
-- Name: role_permission_grants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission_grants ALTER COLUMN id SET DEFAULT nextval('public.role_permission_grants_id_seq'::regclass);


--
-- Name: role_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions ALTER COLUMN id SET DEFAULT nextval('public.role_permissions_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: route_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_points ALTER COLUMN id SET DEFAULT nextval('public.route_points_id_seq'::regclass);


--
-- Name: routes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes ALTER COLUMN id SET DEFAULT nextval('public.routes_id_seq'::regclass);


--
-- Name: scope_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scope_tasks ALTER COLUMN id SET DEFAULT nextval('public.scope_tasks_id_seq'::regclass);


--
-- Name: service_agreements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_agreements ALTER COLUMN id SET DEFAULT nextval('public.service_agreements_id_seq'::regclass);


--
-- Name: spare_parts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spare_parts ALTER COLUMN id SET DEFAULT nextval('public.spare_parts_id_seq'::regclass);


--
-- Name: system_lists id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_lists ALTER COLUMN id SET DEFAULT nextval('public.system_lists_id_seq'::regclass);


--
-- Name: system_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings ALTER COLUMN id SET DEFAULT nextval('public.system_settings_id_seq'::regclass);


--
-- Name: task_activity_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_activity_log ALTER COLUMN id SET DEFAULT nextval('public.task_activity_log_id_seq'::regclass);


--
-- Name: tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks ALTER COLUMN id SET DEFAULT nextval('public.tasks_id_seq'::regclass);


--
-- Name: training_attendance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_attendance ALTER COLUMN id SET DEFAULT nextval('public.training_attendance_id_seq'::regclass);


--
-- Name: training_course_trainees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_course_trainees ALTER COLUMN id SET DEFAULT nextval('public.training_course_trainees_id_seq'::regclass);


--
-- Name: training_courses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_courses ALTER COLUMN id SET DEFAULT nextval('public.training_courses_id_seq'::regclass);


--
-- Name: user_branch_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branch_assignments ALTER COLUMN id SET DEFAULT nextval('public.user_branch_assignments_id_seq'::regclass);


--
-- Name: visit_escalation_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_escalation_alerts ALTER COLUMN id SET DEFAULT nextval('public.visit_escalation_alerts_id_seq'::regclass);


--
-- Name: visit_geo_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_geo_logs ALTER COLUMN id SET DEFAULT nextval('public.visit_geo_logs_id_seq'::regclass);


--
-- Name: visit_sources id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_sources ALTER COLUMN id SET DEFAULT nextval('public.visit_sources_id_seq'::regclass);


--
-- Name: visit_surveys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_surveys ALTER COLUMN id SET DEFAULT nextval('public.visit_surveys_id_seq'::regclass);


--
-- Name: visit_task_device_activation_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_activation_results ALTER COLUMN id SET DEFAULT nextval('public.visit_task_device_activation_results_id_seq'::regclass);


--
-- Name: visit_task_device_delivery_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_delivery_results ALTER COLUMN id SET DEFAULT nextval('public.visit_task_device_delivery_results_id_seq'::regclass);


--
-- Name: visit_task_device_demo_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_demo_results ALTER COLUMN id SET DEFAULT nextval('public.visit_task_device_demo_results_id_seq'::regclass);


--
-- Name: visit_task_device_installation_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_installation_results ALTER COLUMN id SET DEFAULT nextval('public.visit_task_device_installation_results_id_seq'::regclass);


--
-- Name: visit_task_emergency_financials id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_emergency_financials ALTER COLUMN id SET DEFAULT nextval('public.visit_task_emergency_financials_id_seq'::regclass);


--
-- Name: visit_task_emergency_parts_used id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_emergency_parts_used ALTER COLUMN id SET DEFAULT nextval('public.visit_task_emergency_parts_used_id_seq'::regclass);


--
-- Name: visit_task_emergency_technical_states id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_emergency_technical_states ALTER COLUMN id SET DEFAULT nextval('public.visit_task_emergency_technical_states_id_seq'::regclass);


--
-- Name: visit_task_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_results ALTER COLUMN id SET DEFAULT nextval('public.visit_task_results_id_seq'::regclass);


--
-- Name: visit_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_tasks ALTER COLUMN id SET DEFAULT nextval('public.visit_tasks_id_seq'::regclass);


--
-- Name: work_scopes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_scopes ALTER COLUMN id SET DEFAULT nextval('public.work_scopes_id_seq'::regclass);


--
-- PostgreSQL database dump complete
--


--
-- PostgreSQL database dump
--


-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: geo_units; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (35, 'ط§ظ„ط­ظ…ظٹط¯ظٹط©', 3, 1, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (36, 'ط§ظ„طµط§ظ„ط­ظٹط©', 3, 1, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (37, 'ط§ظ„ظ…ط§ظ„ظƒظٹ', 3, 1, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (38, 'ط¨ط§ط¨ طھظˆظ…ط§', 3, 2, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (39, 'ط§ظ„طھظ„', 3, 2, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (40, 'ظ…ظٹط²ظ‡', 3, 2, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (41, 'ط¬ط±ظ…ط§ظ†ط§ ط§ظ„ظ‚ط¯ظٹظ…ط©', 3, 3, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (42, 'ظ…ط­ط±ط¯ط©', 3, 3, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (43, 'ط¨ظٹطھ ط¬ظ†ط¯', 3, 3, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (44, 'ظ…ط²ط© ط§ظ„ظ‚ط¯ظٹظ…ط©', 3, 4, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (45, 'ط§ظ„ظ…ط¹ط±ط©', 3, 4, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (46, 'ط¨ظٹطھ طھظ…ط§ظ†ط©', 3, 4, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (47, 'ط¯ظˆظ…ط§ ط§ظ„ظ‚ط¯ظٹظ…ط©', 3, 5, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (48, 'ط§ظ„ظ…ط¹ط±ط¶', 3, 5, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (49, 'ط¨ظٹطھ ط³ط§ط¯ط±', 3, 5, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (50, 'ط§ظ„ظ‚ط·ظٹظپط© ط§ظ„ظ‚ط¯ظٹظ…ط©', 3, 6, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (51, 'ط§ظ„ط¹ط¨ط§ط³ظٹظٹظ†', 3, 6, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (52, 'ظƒظپط± ط³ظˆط³ط©', 3, 6, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (53, 'ط§ظ„ظ…ط¤طھظ…ظ†ط©', 3, 7, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (54, 'ط¬ط¨ط§ط¯ظٹط©', 3, 7, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (55, 'ط§ظ„ظƒظپط±', 3, 7, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (56, 'ط¯ط§ط±ظٹط§ ط§ظ„ظ‚ط¯ظٹظ…ط©', 3, 8, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (57, 'ط§ظ„ط®ظ„ظٹط¬', 3, 8, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (58, 'ط¨ظٹطھ ط­ط¬ط§ط±', 3, 8, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (59, 'ط­ظ„ط¨ ط§ظ„ظ‚ط¯ظٹظ…ط©', 3, 9, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (60, 'ط§ظ„ط¬ط¯ظٹط¯ط©', 3, 9, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (61, 'ط§ظ„ط´ظٹط® ظپط§ط¶ظ„', 3, 9, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (62, 'ط§ظ„ط´ظ‡ط¨ط§ط،', 3, 10, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (63, 'ط£ط±ظ…ط§ظ†', 3, 10, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (64, 'طµط§ظپظٹط­ط§ظ†', 3, 10, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (65, 'ط£ط¹ط²ط§ط²', 3, 11, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (66, 'ط¨ط§ط¨ ط­ط§طھظ…', 3, 11, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (67, 'طµط§ظ†ط§طھ', 3, 11, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (68, 'ط§ظ„ط³ظپظٹط±ط©', 3, 12, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (69, 'ط§ظ„ط®ط§ظ† ط§ظ„ط¹ظ„ظˆظ…', 3, 12, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (70, 'طµظٹظپ ط§ظ„ط¯ظˆظ„ط©', 3, 12, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (71, 'ط¨ط§ط¨ ط§ظ„ظپط±ط¬', 3, 13, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (72, 'ط§ظ„ظپط§ط¨ط±ظٹظ†', 3, 13, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (73, 'ط§ظ„ط®طµط§ط±', 3, 13, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (74, 'ط§ظ„ظ†ظٹط±ط¨', 3, 14, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (75, 'ط§ظ„ط¹ظ„ظٹ', 3, 14, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (76, 'ط§ظ„ظ…ط­ط·ط©', 3, 14, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (77, 'ط§ظ„ط£طھط§ط±ط¨', 3, 15, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (78, 'ط³ط¨ظٹظ†ط©', 3, 15, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (79, 'ط§ظ„ط­ط¯ط§ط¯', 3, 15, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (80, 'ط§ظ„ط­ط¶ط±', 3, 16, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (81, 'ط§ظ„ط­ظˆط§ط´', 3, 16, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (82, 'ط§ظ„ط¨ظˆط³ط±ط©', 3, 16, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (83, 'ط§ظ„ظ„ط§ط°ظ‚ظٹط©', 3, 17, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (84, 'ط³ظ„ظ†ظپط©', 3, 17, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (85, 'طµظٹط§ط¯ط©', 3, 17, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (86, 'ط¬ط¨ظ„ط©', 3, 18, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (87, 'ط§ظ„ط±ط¨ظٹط¹ط©', 3, 18, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (88, 'ط¨ط¯ط±ظˆط³', 3, 18, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (89, 'ط§ظ„ظ‚ط±ط¯ط§ط­ط©', 3, 19, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (90, 'ظ‚ط¨ط± ط§ظ„ط´ظ…ط³', 3, 19, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (91, 'ط­ط§ط±ط©', 3, 19, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (92, 'ط§ظ„ط­ظپط©', 3, 20, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (93, 'ط¨ظ†ط³', 3, 20, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (94, 'ط§ظ„ط¬ط§ظ†ط¯ط§ط±ظٹط©', 3, 20, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (95, 'طµظ„ط§ظ†ظپط©', 3, 21, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (96, 'ط£ط±ظˆط§ط¯', 3, 21, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (97, 'ط§ظ„ظ‚ظ…ظٹط´ظ„ظٹ', 3, 21, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (98, 'ط­ظ…طµ ط§ظ„ظ‚ط¯ظٹظ…ط©', 3, 22, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (99, 'ط§ظ„ط¹ط¯ط§ظˆظٹط©', 3, 22, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (100, 'ط¨ط§ط¨ طھط¯ظ…ط±', 3, 22, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (101, 'ط§ظ„ظˆط§ط¹ط±', 3, 23, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (102, 'ط§ظ„ط¯ط¨ظ„', 3, 23, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (103, 'ط§ظ„ط¬ظˆط´ط§ظ†', 3, 23, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (104, 'ط§ظ„ظ…ط®ط±ظ…', 3, 24, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (105, 'ط§ظ„ظ…ط´ط±ظپط©', 3, 24, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (106, 'ط§ظ„طھط§ظ„ظٹط©', 3, 24, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (107, 'ط§ظ„ظ‚طµظٹط±', 3, 25, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (108, 'ط§ظ„ط³ظ‚ظ„ط¨ظٹط©', 3, 25, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (109, 'ط´ط§ط±ط¹ط© ظپظٹطµظ„', 3, 25, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (110, 'ط§ظ„ط±ط³طھظ†', 3, 26, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (111, 'ط§ظ„طھط±ط®ط§ظٹط§', 3, 26, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (112, 'ط¹ط§ظ„ظٹط§', 3, 26, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (113, 'طھط§ظ„ط¯ظˆ', 3, 27, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (114, 'ط´ظٹظ†', 3, 27, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (115, 'ط§ظ„ط¹ط´ط§ط±ظ†ط©', 3, 27, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (116, 'ظ…طµظٹط§ظپ', 3, 28, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (117, 'ط¬ظˆط±ظٹظ†', 3, 28, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (118, 'ظ…ظٹط±ط§ظٹ', 3, 28, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (119, 'ط§ظ„ظ…ط´طھط©', 3, 29, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (120, 'ط§ظ„ط­ط³ظٹط§ط،', 3, 29, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (121, 'ط§ظ„ظپط±ظ‚ظ„ط³', 3, 29, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (122, 'ط·ط±ط·ظˆط³', 3, 30, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (123, 'ط§ظ„ط¨ط³ظٹطھ', 3, 30, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (124, 'ط§ظ„ط±ظٹط­ط§ظ†ظٹط©', 3, 30, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (125, 'ط¨ظ†ظٹط§ط³', 3, 31, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (126, 'ط§ظ„ظ…ظ†ط´ظٹط©', 3, 31, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (127, 'ط§ظ„ط¨ط§ط¯ظٹط©', 3, 31, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (128, 'ط§ظ„طµط§ظپظٹط©', 3, 32, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (129, 'ط§ظ„ط´ظٹط® ط¨ط¯ط±', 3, 32, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (130, 'ط§ظ„ط¹ظ…ظٹظ‚ط§طھ', 3, 32, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (131, 'ط§ظ„ط¯ط±ظٹظƒظٹط´', 3, 33, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (132, 'ط§ظ„ط¨طµط§ط·ط©', 3, 33, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (133, 'ط§ظ„ط±ط¨ظٹط¶ط©', 3, 33, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (134, 'ط´ظٹط® ط¨ط¯ط±', 3, 34, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (135, 'ط¨ط¹ظٹط¯ط©', 3, 34, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (136, 'ط§ظ„ط´ظٹط® ط§ظ„ط³ط§ظ‚ط·', 3, 34, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (137, 'ط¨ط§ط¨ ط´ط±ظ‚ظٹ', 4, 35, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (138, 'ط§ظ„ظ…ظ‡ط§ط¬ط±ظٹظ†', 4, 35, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (139, 'ط¨ط§ط¨ طھظˆظ…ط§', 4, 35, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (140, 'ط³ظˆظ‚ ط§ظ„ط­ظ…ظٹط¯ظٹط©', 4, 35, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (141, 'ط§ظ„ط´ط§ط؛ظˆط±', 4, 36, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (142, 'ظ…ط³ظƒظ† ط§ظ„طµط§ظ„ط­ظٹط©', 4, 36, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (143, 'ظ…ظ†ط·ظ‚ط© ط¨ط±ط§ظ…ظƒظ‡', 4, 36, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (144, 'ط§ظ„ظ…ط§ظ„ظƒظٹ', 4, 37, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (145, 'ط´ط§ط±ط¹ ط¨ط±ظƒط©', 4, 37, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (146, 'ط¬ط§ظ…ط¹ ط§ظ„ط£ظ…ظˆظٹ', 4, 37, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (147, 'ط¨ط§ط¨ طھظˆظ…ط§', 4, 38, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (148, 'طھظ„', 4, 38, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (149, 'ظ…ط²ظ‡', 4, 40, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (150, 'ط§ظ„ط³ط§ط­ط©', 4, 39, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (151, 'ط¬ط±ظ…ط§ظ†ط§ ط§ظ„ظ‚ط¯ظٹظ…ط©', 4, 41, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (152, 'ط¹ظٹظ† ط§ظ„ظپظٹط¬ط©', 4, 41, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (153, 'ط¨ظٹطھ ط¬ظ†ط¯', 4, 43, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (154, 'ظ…ط­ط±ط¯ط©', 4, 42, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (155, 'ط§ظ„ظ…ط²ط© ط§ظ„ظ‚ط¯ظٹظ…ط©', 4, 44, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (156, 'ط§ظ„ظ…ط¹ط±ط©', 4, 45, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (157, 'ط¨ظٹطھ طھظ…ط§ظ†ط©', 4, 46, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (158, 'ط¯ظˆظ…ط§ ط§ظ„ظ‚ط¯ظٹظ…ط©', 4, 47, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (159, 'ط§ظ„ظ…ط¹ط±ط¶', 4, 48, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (160, 'ط¨ظٹطھ ط³ط§ط¯ط±', 4, 49, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (161, 'ط§ظ„ظ‚ط·ظٹظپط©', 4, 50, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (162, 'ط§ظ„ط¹ط¨ط§ط³ظٹظٹظ†', 4, 51, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (163, 'ظƒظپط± ط³ظˆط³ط©', 4, 52, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (164, 'ط§ظ„ظ…ط¤طھظ…ظ†ط©', 4, 53, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (165, 'ط¬ط¨ط§ط¯ظٹط©', 4, 54, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (166, 'ط§ظ„ظƒظپط±', 4, 55, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (167, 'ط¯ط§ط±ظٹط§', 4, 56, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (168, 'ط§ظ„ط®ظ„ظٹط¬', 4, 57, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (169, 'ط¨ظٹطھ ط­ط¬ط§ط±', 4, 58, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (170, 'ط­ظ„ط¨ ط§ظ„ظ‚ط¯ظٹظ…ط©', 4, 59, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (171, 'ط§ظ„ط¬ط¯ظٹط¯ط©', 4, 60, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (172, 'ط§ظ„ط´ظٹط® ظپط§ط¶ظ„', 4, 61, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (173, 'ط§ظ„ط´ظ‡ط¨ط§ط،', 4, 62, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (174, 'ط£ط±ظ…ط§ظ†', 4, 63, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (175, 'طµط§ظپظٹط­ط§ظ†', 4, 64, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (176, 'ط£ط¹ط²ط§ط²', 4, 65, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (177, 'ط¨ط§ط¨ ط­ط§طھظ…', 4, 66, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (178, 'طµط§ظ†ط§طھ', 4, 67, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (179, 'ط§ظ„ط³ظپظٹط±ط©', 4, 68, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (180, 'ط§ظ„ط®ط§ظ† ط§ظ„ط¹ظ„ظˆظ…', 4, 69, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (181, 'طµظٹظپ ط§ظ„ط¯ظˆظ„ط©', 4, 70, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (182, 'ط¨ط§ط¨ ط§ظ„ظپط±ط¬', 4, 71, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (183, 'ط§ظ„ظپط§ط¨ط±ظٹظ†', 4, 72, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (184, 'ط§ظ„ط®طµط§ط±', 4, 73, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (185, 'ط§ظ„ظ†ظٹط±ط¨', 4, 74, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (186, 'ط§ظ„ط¹ظ„ظٹ', 4, 75, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (187, 'ط§ظ„ظ…ط­ط·ط©', 4, 76, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (188, 'ط§ظ„ط£طھط§ط±ط¨', 4, 77, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (189, 'ط³ط¨ظٹظ†ط©', 4, 78, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (190, 'ط§ظ„ط­ط¯ط§ط¯', 4, 79, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (191, 'ط§ظ„ط­ط¶ط±', 4, 80, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (192, 'ط§ظ„ط­ظˆط§ط´', 4, 81, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (193, 'ط§ظ„ط¨ظˆط³ط±ط©', 4, 82, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (194, 'ط§ظ„ظ„ط§ط°ظ‚ظٹط©', 4, 83, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (195, 'ط³ظ„ظ†ظپط©', 4, 84, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (196, 'طµظٹط§ط¯ط©', 4, 85, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (197, 'ط¬ط¨ظ„ط©', 4, 86, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (198, 'ط§ظ„ط±ط¨ظٹط¹ط©', 4, 87, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (199, 'ط¨ط¯ط±ظˆط³', 4, 88, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (200, 'ط§ظ„ظ‚ط±ط¯ط§ط­ط©', 4, 89, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (201, 'ظ‚ط¨ط± ط§ظ„ط´ظ…ط³', 4, 90, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (202, 'ط­ط§ط±ط©', 4, 91, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (203, 'ط§ظ„ط­ظپط©', 4, 92, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (204, 'ط¨ظ†ط³', 4, 93, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (205, 'ط§ظ„ط¬ط§ظ†ط¯ط§ط±ظٹط©', 4, 94, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (206, 'طµظ„ط§ظ†ظپط©', 4, 95, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (207, 'ط£ط±ظˆط§ط¯', 4, 96, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (208, 'ط§ظ„ظ‚ظ…ظٹط´ظ„ظٹ', 4, 97, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (209, 'ط­ظ…طµ ط§ظ„ظ‚ط¯ظٹظ…ط©', 4, 98, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (210, 'ط§ظ„ط¹ط¯ط§ظˆظٹط©', 4, 99, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (211, 'ط¨ط§ط¨ طھط¯ظ…ط±', 4, 100, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (212, 'ط§ظ„ظˆط§ط¹ط±', 4, 101, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (213, 'ط§ظ„ط¯ط¨ظ„', 4, 102, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (214, 'ط§ظ„ط¬ظˆط´ط§ظ†', 4, 103, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (215, 'ط§ظ„ظ…ط®ط±ظ…', 4, 104, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (216, 'ط§ظ„ظ…ط´ط±ظپط©', 4, 105, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (217, 'ط§ظ„طھط§ظ„ظٹط©', 4, 106, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (218, 'ط§ظ„ظ‚طµظٹط±', 4, 107, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (219, 'ط§ظ„ط³ظ‚ظ„ط¨ظٹط©', 4, 108, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (220, 'ط´ط§ط±ط¹ط© ظپظٹطµظ„', 4, 109, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (221, 'ط§ظ„ط±ط³طھظ†', 4, 110, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (222, 'ط§ظ„طھط±ط®ط§ظٹط§', 4, 111, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (223, 'ط¹ط§ظ„ظٹط§', 4, 112, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (224, 'طھط§ظ„ط¯ظˆ', 4, 113, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (225, 'ط´ظٹظ†', 4, 114, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (226, 'ط§ظ„ط¹ط´ط§ط±ظ†ط©', 4, 115, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (227, 'ظ…طµظٹط§ظپ', 4, 116, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (228, 'ط¬ظˆط±ظٹظ†', 4, 117, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (229, 'ظ…ظٹط±ط§ظٹ', 4, 118, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (230, 'ط§ظ„ظ…ط´طھط©', 4, 119, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (231, 'ط§ظ„ط­ط³ظٹط§ط،', 4, 120, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (232, 'ط§ظ„ظپط±ظ‚ظ„ط³', 4, 121, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (233, 'ط·ط±ط·ظˆط³', 4, 122, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (234, 'ط§ظ„ط¨ط³ظٹطھ', 4, 123, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (235, 'ط§ظ„ط±ظٹط­ط§ظ†ظٹط©', 4, 124, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (236, 'ط¨ظ†ظٹط§ط³', 4, 125, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (237, 'ط§ظ„ظ…ظ†ط´ظٹط©', 4, 126, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (238, 'ط§ظ„ط¨ط§ط¯ظٹط©', 4, 127, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (239, 'ط§ظ„طµط§ظپظٹط©', 4, 128, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (240, 'ط§ظ„ط´ظٹط® ط¨ط¯ط±', 4, 129, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (241, 'ط§ظ„ط¹ظ…ظٹظ‚ط§طھ', 4, 130, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (242, 'ط§ظ„ط¯ط±ظٹظƒظٹط´', 4, 131, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (243, 'ط§ظ„ط¨طµط§ط·ط©', 4, 132, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (244, 'ط§ظ„ط±ط¨ظٹط¶ط©', 4, 133, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (245, 'ط´ظٹط® ط¨ط¯ط±', 4, 134, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (246, 'ط¨ط¹ظٹط¯ط©', 4, 135, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (247, 'ط§ظ„ط´ظٹط® ط§ظ„ط³ط§ظ‚ط·', 4, 136, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (248, 'ط¯ظ…ط´ظ‚', 1, NULL, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (249, 'ط±ظٹظپ ط¯ظ…ط´ظ‚', 1, NULL, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (250, 'ط­ظ„ط¨', 1, NULL, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (251, 'ط­ظ…طµ', 1, NULL, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (252, 'ط­ظ…ط§ط©', 1, NULL, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (253, 'ط§ظ„ظ„ط§ط°ظ‚ظٹط©', 1, NULL, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (254, 'ط·ط±ط·ظˆط³', 1, NULL, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (255, 'ط¥ط¯ظ„ط¨', 1, NULL, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (256, 'ط§ظ„ط±ظ‚ط©', 1, NULL, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (257, 'ط¯ظٹط± ط§ظ„ط²ظˆط±', 1, NULL, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (258, 'ط§ظ„ط­ط³ظƒط©', 1, NULL, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (259, 'ط¯ط±ط¹ط§', 1, NULL, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (260, 'ط§ظ„ط³ظˆظٹط¯ط§ط،', 1, NULL, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (261, 'ط§ظ„ظ‚ظ†ظٹط·ط±ط©', 1, NULL, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (1, 'ط¯ظ…ط´ظ‚ ط§ظ„ظ‚ط¯ظٹظ…ط©', 2, 248, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (2, 'ظ…ط±ط¬ ط§ظ„طµط§ظپط­ط©', 2, 248, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (3, 'ط¬ط±ظ…ط§ظ†ط§', 2, 248, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (4, 'ظ…ط²ط©', 2, 248, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (5, 'ط¯ظˆظ…ط§', 2, 248, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (6, 'ط§ظ„ظ‚ط·ظٹظپط©', 2, 248, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (7, 'ط§ظ„ظ…ط¤طھظ…ظ†ط©', 2, 248, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (8, 'ط¯ط§ط±ظٹط§', 2, 248, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (9, 'ط­ظ„ط¨ ط§ظ„ظ‚ط¯ظٹظ…ط©', 2, 250, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (10, 'ط§ظ„ط´ظ‡ط¨ط§ط،', 2, 250, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (11, 'ط£ط¹ط²ط§ط²', 2, 250, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (12, 'ط§ظ„ط³ظپظٹط±ط©', 2, 250, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (13, 'ط¨ط§ط¨ ط§ظ„ظپط±ط¬', 2, 250, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (14, 'ط§ظ„ظ†ظٹط±ط¨', 2, 250, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (15, 'ط§ظ„ط£طھط§ط±ط¨', 2, 250, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (16, 'ط§ظ„ط­ط¶ط±', 2, 250, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (17, 'ط§ظ„ظ„ط§ط°ظ‚ظٹط©', 2, 253, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (18, 'ط¬ط¨ظ„ط©', 2, 253, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (19, 'ط§ظ„ظ‚ط±ط¯ط§ط­ط©', 2, 253, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (20, 'ط§ظ„ط­ظپط©', 2, 253, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (21, 'طµظ„ط§ظ†ظپط©', 2, 253, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (22, 'ط­ظ…طµ ط§ظ„ظ‚ط¯ظٹظ…ط©', 2, 251, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (23, 'ط§ظ„ظˆط§ط¹ط±', 2, 251, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (24, 'ط§ظ„ظ…ط®ط±ظ…', 2, 251, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (25, 'ط§ظ„ظ‚طµظٹط±', 2, 251, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (26, 'ط§ظ„ط±ط³طھظ†', 2, 251, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (27, 'طھط§ظ„ط¯ظˆ', 2, 251, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (28, 'ظ…طµظٹط§ظپ', 2, 251, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (29, 'ط§ظ„ظ…ط´طھط©', 2, 251, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (30, 'ط·ط±ط·ظˆط³', 2, 254, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (31, 'ط¨ظ†ظٹط§ط³', 2, 254, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (32, 'ط§ظ„طµط§ظپظٹط©', 2, 254, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (33, 'ط§ظ„ط¯ط±ظٹظƒظٹط´', 2, 254, 'active');
INSERT INTO public.geo_units (id, name, level, parent_id, status) VALUES (34, 'ط´ظٹط® ط¨ط¯ط±', 2, 254, 'active');


--
-- Data for Name: branches; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.branches (id, name, location_geo_id, status, created_at, contact_info, detailed_address) VALUES (2, 'ظپط±ط¹ ط¯ظ…ط´ظ‚', NULL, 'active', '2026-05-29 15:43:46.938697+03', '[]', NULL);
INSERT INTO public.branches (id, name, location_geo_id, status, created_at, contact_info, detailed_address) VALUES (1, 'ط؛ظٹط± ظ…ط­ط¯ط¯', NULL, 'inactive', '2026-05-29 15:42:33.4296+03', '[]', NULL);


--
-- Data for Name: emergency_action_types; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.emergency_action_types (id, arabic_label, description, display_order, is_active, created_at, updated_at) VALUES (1, 'ظپط­طµ ظˆطھط´ط®ظٹطµ', NULL, 1, true, '2026-05-29 15:43:02.366555+03', '2026-05-29 15:43:02.366555+03');
INSERT INTO public.emergency_action_types (id, arabic_label, description, display_order, is_active, created_at, updated_at) VALUES (2, 'طھط؛ظٹظٹط± ظپظ„طھط±', NULL, 2, true, '2026-05-29 15:43:02.366555+03', '2026-05-29 15:43:02.366555+03');
INSERT INTO public.emergency_action_types (id, arabic_label, description, display_order, is_active, created_at, updated_at) VALUES (3, 'ط¥طµظ„ط§ط­ طھط³ط±ط¨', NULL, 3, true, '2026-05-29 15:43:02.366555+03', '2026-05-29 15:43:02.366555+03');
INSERT INTO public.emergency_action_types (id, arabic_label, description, display_order, is_active, created_at, updated_at) VALUES (4, 'طھط؛ظٹظٹط± ظ…ط¶ط®ط©', NULL, 4, true, '2026-05-29 15:43:02.366555+03', '2026-05-29 15:43:02.366555+03');
INSERT INTO public.emergency_action_types (id, arabic_label, description, display_order, is_active, created_at, updated_at) VALUES (5, 'طھط؛ظٹظٹط± ط£ط؛ط´ظٹط©', NULL, 5, true, '2026-05-29 15:43:02.366555+03', '2026-05-29 15:43:02.366555+03');
INSERT INTO public.emergency_action_types (id, arabic_label, description, display_order, is_active, created_at, updated_at) VALUES (6, 'ظپط­طµ ظƒظ‡ط±ط¨ط§ط¦ظٹ', NULL, 6, true, '2026-05-29 15:43:02.366555+03', '2026-05-29 15:43:02.366555+03');
INSERT INTO public.emergency_action_types (id, arabic_label, description, display_order, is_active, created_at, updated_at) VALUES (7, 'طھظ†ط¸ظٹظپ ط§ظ„ط¬ظ‡ط§ط²', NULL, 7, true, '2026-05-29 15:43:02.366555+03', '2026-05-29 15:43:02.366555+03');
INSERT INTO public.emergency_action_types (id, arabic_label, description, display_order, is_active, created_at, updated_at) VALUES (8, 'ط§ط³طھط¨ط¯ط§ظ„ ظ‚ط·ط¹ط©', NULL, 8, true, '2026-05-29 15:43:02.366555+03', '2026-05-29 15:43:02.366555+03');


--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (35, 'jobs.interviews.conduct', 'jobs', 'interviews', 'conduct', 'ط¥ط¬ط±ط§ط، ط§ظ„ظ…ظ‚ط§ط¨ظ„ط§طھ', 52, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (40, 'planning.schedule.appear', 'planning', 'schedule', 'appear', 'ط§ظ„ط¸ظ‡ظˆط± ظپظٹ ط¬ط¯ظˆظ„ط© ط§ظ„ظپط±ظ‚', 153, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (41, 'jobs.training.be_trainer', 'jobs', 'training', 'be_trainer', 'ط§ظ„طھط¯ط±ظٹط¨ ظƒظ…ط¯ط±ط¨', 74, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (43, 'telemarketing.targets.view', 'telemarketing', 'targets', 'view', 'ط¹ط±ط¶ ط£ظ‡ط¯ط§ظپ ط§ظ„طھظٹظ„ظ…ط§ط±ظƒطھط±', 160, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (44, 'telemarketing.lists.view', 'telemarketing', 'lists', 'view', 'ط¹ط±ط¶ ظ‚ظˆط§ط¦ظ… ط§ظ„ط§طھطµط§ظ„', 161, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (45, 'telemarketing.lists.generate', 'telemarketing', 'lists', 'generate', 'طھظˆظ„ظٹط¯ ظ‚ط§ط¦ظ…ط© ط§ظ„ط§طھطµط§ظ„ ط§ظ„ظٹظˆظ…ظٹط©', 162, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (46, 'telemarketing.calls.create', 'telemarketing', 'calls', 'create', 'طھط³ط¬ظٹظ„ ظ†طھظٹط¬ط© ط§طھطµط§ظ„', 163, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (47, 'telemarketing.appointments.create', 'telemarketing', 'appointments', 'create', 'ط­ط¬ط² ظ…ظˆط¹ط¯ ط²ظٹط§ط±ط© طھط³ظˆظٹظ‚ظٹط©', 164, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (48, 'telemarketing.calls.view_history', 'telemarketing', 'calls', 'view_history', 'ط¹ط±ط¶ ط³ط¬ظ„ ط§ظ„ط§طھطµط§ظ„ط§طھ', 165, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (49, 'telemarketing.appointments.view', 'telemarketing', 'appointments', 'view', 'ط¹ط±ط¶ ظ…ظˆط§ط¹ظٹط¯ ط§ظ„طھظٹظ„ظ…ط§ط±ظƒطھط±', 166, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (23, 'users.branch_assignments.view', 'users', 'branch_assignments', 'view', 'ط¹ط±ط¶ ظپط±ظˆط¹ ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ† ط§ظ„ظ…ط³ظ…ظˆط­ط©', 10, '{GLOBAL}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (24, 'users.branch_assignments.manage', 'users', 'branch_assignments', 'manage', 'ط¥ط¯ط§ط±ط© ظپط±ظˆط¹ ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ† ط§ظ„ظ…ط³ظ…ظˆط­ط©', 20, '{GLOBAL}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (25, 'admin.roles.view', 'admin', 'roles', 'view', 'ط¹ط±ط¶ ط§ظ„ط£ط¯ظˆط§ط±', 40, '{GLOBAL}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (26, 'admin.roles.manage', 'admin', 'roles', 'manage', 'ط¥ط¯ط§ط±ط© ط§ظ„ط£ط¯ظˆط§ط±', 41, '{GLOBAL}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (27, 'admin.system_lists.view', 'admin', 'system_lists', 'view', 'ط¹ط±ط¶ ط§ظ„ظ‚ظˆط§ط¦ظ… ط§ظ„ظ†ط¸ط§ظ…ظٹط©', 42, '{GLOBAL}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (28, 'admin.system_lists.manage', 'admin', 'system_lists', 'manage', 'ط¥ط¯ط§ط±ط© ط§ظ„ظ‚ظˆط§ط¦ظ… ط§ظ„ظ†ط¸ط§ظ…ظٹط©', 43, '{GLOBAL}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (29, 'branches.view', 'branches', 'management', 'view', 'ط¹ط±ط¶ ط§ظ„ظپط±ظˆط¹', 190, '{GLOBAL}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (30, 'branches.manage', 'branches', 'management', 'manage', 'ط¥ط¯ط§ط±ط© ط§ظ„ظپط±ظˆط¹', 191, '{GLOBAL}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (33, 'settings.view', 'settings', 'system', 'view', 'ط¹ط±ط¶ ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ظ†ط¸ط§ظ…', 200, '{GLOBAL}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (34, 'settings.manage', 'settings', 'system', 'manage', 'طھط¹ط¯ظٹظ„ ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ظ†ط¸ط§ظ…', 201, '{GLOBAL}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (1, 'candidates.view_list', 'candidates', 'candidates', 'view_list', 'ط¹ط±ط¶ ط§ظ„ظ…ط±ط´ط­ظٹظ†', 10, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (2, 'candidates.create', 'candidates', 'candidates', 'create', 'ط¥ظ†ط´ط§ط، ظ…ط±ط´ط­', 20, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (3, 'candidates.edit', 'candidates', 'candidates', 'edit', 'طھط¹ط¯ظٹظ„ ظ…ط±ط´ط­', 30, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (4, 'candidates.delete', 'candidates', 'candidates', 'delete', 'ط­ط°ظپ ظ…ط±ط´ط­', 40, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (5, 'referral_sheets.view_list', 'referral_sheets', 'referral_sheets', 'view_list', 'ط¹ط±ط¶ ط£ظˆط±ط§ظ‚ ط§ظ„ط¥ط­ط§ظ„ط©', 10, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (6, 'referral_sheets.create', 'referral_sheets', 'referral_sheets', 'create', 'ط¥ظ†ط´ط§ط، ظˆط±ظ‚ط© ط¥ط­ط§ظ„ط©', 20, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (7, 'referral_sheets.edit', 'referral_sheets', 'referral_sheets', 'edit', 'طھط¹ط¯ظٹظ„ ظˆط±ظ‚ط© ط¥ط­ط§ظ„ط©', 30, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (8, 'referral_sheets.delete', 'referral_sheets', 'referral_sheets', 'delete', 'ط­ط°ظپ ظˆط±ظ‚ط© ط¥ط­ط§ظ„ط©', 40, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (9, 'clients.view_list', 'clients', 'clients', 'view_list', 'ط¹ط±ط¶ ظ‚ط§ط¦ظ…ط© ط§ظ„ط²ط¨ط§ط¦ظ†', 10, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (10, 'clients.view', 'clients', 'clients', 'view', 'ط¹ط±ط¶ ط§ظ„ط²ط¨ظˆظ†', 20, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (11, 'clients.create', 'clients', 'clients', 'create', 'ط¥ظ†ط´ط§ط، ط²ط¨ظˆظ†', 30, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (12, 'clients.edit', 'clients', 'clients', 'edit', 'طھط¹ط¯ظٹظ„ ط²ط¨ظˆظ†', 40, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (13, 'clients.delete', 'clients', 'clients', 'delete', 'ط­ط°ظپ ط²ط¨ظˆظ†', 50, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (14, 'contracts.create', 'contracts', 'contracts', 'create', 'ط¥ظ†ط´ط§ط، ط¹ظ‚ط¯', 10, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (15, 'tasks.create', 'tasks', 'tasks', 'create', 'ط¥ظ†ط´ط§ط، ظ…ظ‡ظ…ط©', 10, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (16, 'contracts.view_list', 'contracts', 'contracts', 'view_list', 'ط¹ط±ط¶ ظ‚ط§ط¦ظ…ط© ط§ظ„ط¹ظ‚ظˆط¯', 10, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (17, 'contracts.edit', 'contracts', 'contracts', 'edit', 'طھط¹ط¯ظٹظ„ ط¹ظ‚ط¯', 30, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (18, 'contracts.delete', 'contracts', 'contracts', 'delete', 'ط­ط°ظپ ط¹ظ‚ط¯', 40, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (19, 'tasks.view_list', 'tasks', 'tasks', 'view_list', 'ط¹ط±ط¶ ظ‚ط§ط¦ظ…ط© ط§ظ„ظ…ظ‡ط§ظ…', 10, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (20, 'tasks.edit', 'tasks', 'tasks', 'edit', 'طھط¹ط¯ظٹظ„ ظ…ظ‡ظ…ط©', 30, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (21, 'tasks.delete', 'tasks', 'tasks', 'delete', 'ط­ط°ظپ ظ…ظ‡ظ…ط©', 40, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (22, 'departments.view_list', 'departments', 'departments', 'view_list', 'ط¹ط±ط¶ ظ‚ط§ط¦ظ…ط© ط§ظ„ط£ظ‚ط³ط§ظ…', 10, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (31, 'geo.view', 'geo', 'geography', 'view', 'ط¹ط±ط¶ ط§ظ„ظ…ظ†ط§ط·ظ‚ ط§ظ„ط¬ط؛ط±ط§ظپظٹط©', 180, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (32, 'geo.manage', 'geo', 'geography', 'manage', 'ط¥ط¯ط§ط±ط© ط§ظ„ظ…ظ†ط§ط·ظ‚ ظˆط§ظ„ظ…ط³طھظˆظٹط§طھ', 181, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (36, 'candidates.name_lists.view_list', 'candidates', 'name_lists', 'view_list', 'ط¹ط±ط¶ ظ„ظˆط§ط¦ط­ ط§ظ„ط£ط³ظ…ط§ط،', 50, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (37, 'candidates.name_lists.create', 'candidates', 'name_lists', 'create', 'ط¥ظ†ط´ط§ط، ظ„ط§ط¦ط­ط© ط£ط³ظ…ط§ط،', 60, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (38, 'candidates.name_lists.edit', 'candidates', 'name_lists', 'edit', 'طھط¹ط¯ظٹظ„ ظ„ط§ط¦ط­ط© ط£ط³ظ…ط§ط،', 70, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (39, 'candidates.name_lists.delete', 'candidates', 'name_lists', 'delete', 'ط­ط°ظپ ظ„ط§ط¦ط­ط© ط£ط³ظ…ط§ط،', 80, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (42, 'clients.can_be_assigned', 'clients', 'clients', 'can_be_assigned', 'ط¥ظ…ظƒط§ظ†ظٹط© ط§ظ„ط¥ط³ظ†ط§ط¯ ظ„ظ„ط²ط¨ط§ط¦ظ†', 95, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (50, 'marketing_visits.view', 'marketing_visits', 'visits', 'view', 'ط¹ط±ط¶ ط²ظٹط§ط±ط§طھ ط§ظ„طھط³ظˆظٹظ‚', 167, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (51, 'marketing_visits.update_result', 'marketing_visits', 'visits', 'update_result', 'طھط³ط¬ظٹظ„ ظ†طھظٹط¬ط© ط²ظٹط§ط±ط© ط§ظ„طھط³ظˆظٹظ‚', 168, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (52, 'jobs.vacancies.view_list', 'jobs', 'vacancies', 'view_list', 'ط¹ط±ط¶ ط§ظ„ظˆط¸ط§ط¦ظپ ط§ظ„ط´ط§ط؛ط±ط©', 1, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (53, 'jobs.vacancies.view_detail', 'jobs', 'vacancies', 'view_detail', 'ط¹ط±ط¶ طھظپط§طµظٹظ„ ظˆط¸ظٹظپط© ط´ط§ط؛ط±ط©', 2, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (54, 'jobs.vacancies.create', 'jobs', 'vacancies', 'create', 'ط¥ظ†ط´ط§ط، ظˆط¸ظٹظپط© ط´ط§ط؛ط±ط©', 3, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (55, 'jobs.vacancies.edit', 'jobs', 'vacancies', 'edit', 'طھط¹ط¯ظٹظ„ ظˆط¸ظٹظپط© ط´ط§ط؛ط±ط©', 4, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (56, 'jobs.vacancies.change_status', 'jobs', 'vacancies', 'change_status', 'طھط؛ظٹظٹط± ط­ط§ظ„ط© ظˆط¸ظٹظپط© ط´ط§ط؛ط±ط©', 5, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (57, 'jobs.interviews.view_list', 'jobs', 'interviews', 'view_list', 'ط¹ط±ط¶ ط§ظ„ظ…ظ‚ط§ط¨ظ„ط§طھ', 10, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (58, 'jobs.interviews.view_detail', 'jobs', 'interviews', 'view_detail', 'ط¹ط±ط¶ طھظپط§طµظٹظ„ ظ…ظ‚ط§ط¨ظ„ط©', 11, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (59, 'jobs.interviews.schedule', 'jobs', 'interviews', 'schedule', 'ط¬ط¯ظˆظ„ط© ظ…ظ‚ط§ط¨ظ„ط©', 12, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (60, 'jobs.interviews.edit', 'jobs', 'interviews', 'edit', 'طھط¹ط¯ظٹظ„ ظ…ظ‚ط§ط¨ظ„ط©', 13, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (61, 'jobs.interviews.record_result', 'jobs', 'interviews', 'record_result', 'طھط³ط¬ظٹظ„ ظ†طھظٹط¬ط© ظ…ظ‚ط§ط¨ظ„ط©', 14, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (62, 'jobs.interviews.view_eligible', 'jobs', 'interviews', 'view_eligible', 'ط¹ط±ط¶ ط§ظ„ظ…ط±ط´ط­ظٹظ† ط§ظ„ظ…ط¤ظ‡ظ„ظٹظ†', 15, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (63, 'jobs.training.view_list', 'jobs', 'training', 'view_list', 'ط¹ط±ط¶ ط§ظ„ط¯ظˆط±ط§طھ ط§ظ„طھط¯ط±ظٹط¨ظٹط©', 20, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (64, 'jobs.training.view_detail', 'jobs', 'training', 'view_detail', 'ط¹ط±ط¶ طھظپط§طµظٹظ„ ط¯ظˆط±ط© طھط¯ط±ظٹط¨ظٹط©', 21, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (65, 'jobs.training.create', 'jobs', 'training', 'create', 'ط¥ظ†ط´ط§ط، ط¯ظˆط±ط© طھط¯ط±ظٹط¨ظٹط©', 22, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (66, 'jobs.training.start', 'jobs', 'training', 'start', 'ط¨ط¯ط، ط¯ظˆط±ط© طھط¯ط±ظٹط¨ظٹط©', 23, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (67, 'jobs.training.record_attendance', 'jobs', 'training', 'record_attendance', 'طھط³ط¬ظٹظ„ ط­ط¶ظˆط± ط¯ظˆط±ط©', 24, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (68, 'jobs.training.complete', 'jobs', 'training', 'complete', 'ط¥ظ†ظ‡ط§ط، ط¯ظˆط±ط© طھط¯ط±ظٹط¨ظٹط©', 25, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (69, 'jobs.training.record_result', 'jobs', 'training', 'record_result', 'طھط³ط¬ظٹظ„ ظ†طھظٹط¬ط© ظ…طھط¯ط±ط¨', 26, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (70, 'jobs.training.add_trainees', 'jobs', 'training', 'add_trainees', 'ط¥ط¶ط§ظپط© ظ…طھط¯ط±ط¨ظٹظ† ظ„ط¯ظˆط±ط©', 27, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (71, 'jobs.training.view_eligible', 'jobs', 'training', 'view_eligible', 'ط¹ط±ط¶ ط§ظ„ظ…ط±ط´ط­ظٹظ† ط§ظ„ظ…ط¤ظ‡ظ„ظٹظ† ظ„ظ„طھط¯ط±ظٹط¨', 28, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (72, 'jobs.applications.view_list', 'jobs', 'applications', 'view_list', 'ط¹ط±ط¶ ط·ظ„ط¨ط§طھ ط§ظ„طھظˆط¸ظٹظپ', 30, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (73, 'jobs.applications.create', 'jobs', 'applications', 'create', 'ط¥ظ†ط´ط§ط، ط·ظ„ط¨ طھظˆط¸ظٹظپ', 31, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (74, 'jobs.applications.view_detail', 'jobs', 'applications', 'view_detail', 'ط¹ط±ط¶ طھظپط§طµظٹظ„ ط·ظ„ط¨ طھظˆط¸ظٹظپ', 32, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (75, 'jobs.applications.change_stage', 'jobs', 'applications', 'change_stage', 'طھط؛ظٹظٹط± ظ…ط±ط­ظ„ط© ط·ظ„ط¨ ط§ظ„طھظˆط¸ظٹظپ', 33, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (76, 'jobs.applications.hire', 'jobs', 'applications', 'hire', 'طھظˆط¸ظٹظپ ظ…ط±ط´ط­', 34, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (77, 'jobs.applications.record_decision', 'jobs', 'applications', 'record_decision', 'طھط³ط¬ظٹظ„ ظ‚ط±ط§ط± ط§ظ„طھظˆط¸ظٹظپ', 35, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (78, 'jobs.applications.escalate', 'jobs', 'applications', 'escalate', 'طھطµط¹ظٹط¯ ط·ظ„ط¨ طھظˆط¸ظٹظپ', 36, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (79, 'jobs.applications.edit_notes', 'jobs', 'applications', 'edit_notes', 'طھط¹ط¯ظٹظ„ ظ…ظ„ط§ط­ط¸ط§طھ ط·ظ„ط¨ ط§ظ„طھظˆط¸ظٹظپ', 37, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (80, 'jobs.applications.archive', 'jobs', 'applications', 'archive', 'ط£ط±ط´ظپط© ط·ظ„ط¨ طھظˆط¸ظٹظپ', 38, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (81, 'jobs.applications.view_audit_logs', 'jobs', 'applications', 'view_audit_logs', 'ط¹ط±ط¶ ط³ط¬ظ„ طھط¯ظ‚ظٹظ‚ ط·ظ„ط¨ ط§ظ„طھظˆط¸ظٹظپ', 39, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (82, 'planning.view', 'planning', 'general', 'view', 'ط¹ط±ط¶ ط®ط·ط· ظˆط¬ط¯ط§ظˆظ„ ط§ظ„ظپط±ط¹', 151, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (83, 'planning.manage', 'planning', 'general', 'manage', 'ط¥ط¯ط§ط±ط© ط§ظ„ط¬ط¯ظˆظ„ط© ظˆطھط¹ظٹظٹظ† ط§ظ„ظ…ط³ط§ط±ط§طھ', 152, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (84, 'telemarketing.appointments.book', 'telemarketing', 'appointments', 'book', 'ط­ط¬ط² ظ…ظˆط¹ط¯ ط²ظٹط§ط±ط© طھط³ظˆظٹظ‚ظٹط© (طھظٹظ„ظ…ط§ط±ظƒطھط±)', 165, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (85, 'admin.task_types.view', 'admin', 'task_types', 'view', 'ط¹ط±ط¶ ط¥ط¹ط¯ط§ط¯ط§طھ ط£ظ†ظˆط§ط¹ ط§ظ„ظ…ظ‡ط§ظ…', 210, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (86, 'admin.task_types.manage', 'admin', 'task_types', 'manage', 'ط¥ط¯ط§ط±ط© ط¥ط¹ط¯ط§ط¯ط§طھ ط£ظ†ظˆط§ط¹ ط§ظ„ظ…ظ‡ط§ظ…', 211, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (87, 'admin.emergency_action_types.view', 'admin', 'emergency_action_types', 'view', 'ط¹ط±ط¶ ط£ظ†ظˆط§ط¹ ط¥ط¬ط±ط§ط،ط§طھ ط§ظ„ط·ظˆط§ط±ط¦', 220, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (88, 'admin.emergency_action_types.manage', 'admin', 'emergency_action_types', 'manage', 'ط¥ط¯ط§ط±ط© ط£ظ†ظˆط§ط¹ ط¥ط¬ط±ط§ط،ط§طھ ط§ظ„ط·ظˆط§ط±ط¦', 221, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (89, 'jobs.applications.resolve_escalation', 'jobs', 'applications', 'resolve_escalation', 'ظپظƒ طھطµط¹ظٹط¯ ط·ظ„ط¨ ط§ظ„طھظˆط¸ظٹظپ', 40, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (90, 'sales.can_close', 'sales', 'closing', 'close', 'ط§ظ„ظ‚ط¯ط±ط© ط¹ظ„ظ‰ طھط³ظƒظٹط± ط§ظ„ط¹ط±ظˆط¶ ظˆط§ظ„ظ…ط¨ظٹط¹ط§طھ', 0, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (91, 'tasks.delivery.view', 'tasks', 'delivery', 'view', 'ط¹ط±ط¶ ظ…ظ‡ط§ظ… ط§ظ„طھط³ظ„ظٹظ… ظˆط§ظ„طھط±ظƒظٹط¨', 300, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (92, 'tasks.delivery.create', 'tasks', 'delivery', 'create', 'ط¥ظ†ط´ط§ط، ظ…ظ‡ظ…ط© طھط³ظ„ظٹظ… ظٹط¯ظˆظٹ', 301, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (93, 'tasks.delivery.result', 'tasks', 'delivery', 'result', 'طھط³ط¬ظٹظ„ ظ†طھظٹط¬ط© طھط³ظ„ظٹظ…', 302, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (94, 'tasks.installation.create', 'tasks', 'installation', 'create', 'ط¥ظ†ط´ط§ط، ظ…ظ‡ظ…ط© طھط±ظƒظٹط¨', 303, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (95, 'tasks.activation.create', 'tasks', 'activation', 'create', 'ط¥ظ†ط´ط§ط، ظ…ظ‡ظ…ط© طھط´ط؛ظٹظ„', 304, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (96, 'tasks.installation.view', 'tasks', 'installation', 'view', 'ط¹ط±ط¶ ظ†طھط§ط¦ط¬ ط§ظ„طھط±ظƒظٹط¨', 305, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (97, 'tasks.installation.result', 'tasks', 'installation', 'result', 'طھط³ط¬ظٹظ„ ظ†طھظٹط¬ط© طھط±ظƒظٹط¨', 306, '{GLOBAL,BRANCH,ASSIGNED}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (98, 'branches.edit', 'branches', 'management', 'edit', 'طھط¹ط¯ظٹظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظپط±ط¹', 11, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (99, 'open_tasks.view', 'open_tasks', 'tasks', 'view', 'ط¹ط±ط¶ ط§ظ„ظ…ظ‡ط§ظ… ط§ظ„ظ…ظپطھظˆط­ط©', 200, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (100, 'open_tasks.edit', 'open_tasks', 'tasks', 'edit', 'طھط¹ط¯ظٹظ„ ط§ظ„ظ…ظ‡ط§ظ… ط§ظ„ظ…ظپطھظˆط­ط©', 201, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (101, 'field_visits.view', 'field_visits', 'visits', 'view', 'ط¹ط±ط¶ ط§ظ„ط²ظٹط§ط±ط§طھ ط§ظ„ظ…ظٹط¯ط§ظ†ظٹط©', 210, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (102, 'field_visits.edit', 'field_visits', 'visits', 'edit', 'طھط¹ط¯ظٹظ„ ط§ظ„ط²ظٹط§ط±ط§طھ ط§ظ„ظ…ظٹط¯ط§ظ†ظٹط©', 211, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (103, 'catalog.manage', 'catalog', 'devices', 'manage', 'ط¥ط¯ط§ط±ط© ظƒطھط§ظ„ظˆط¬ ط§ظ„ط£ط¬ظ‡ط²ط© ظˆظ‚ط·ط¹ ط§ظ„ط؛ظٹط§ط±', 210, '{GLOBAL}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (104, 'devices.discounts.manage', 'catalog', 'discounts', 'manage', 'ط¥ط¯ط§ط±ط© ط­ظ…ظ„ط§طھ ط®طµظˆظ…ط§طھ ط§ظ„ط£ط¬ظ‡ط²ط©', 211, '{GLOBAL}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (105, 'contracts.approve', 'contracts', 'contracts', 'approve', 'ط§ظ„ظ…ظˆط§ظپظ‚ط© ط¹ظ„ظ‰ ط¹ظ‚ط¯ ط£ظˆ ط±ظپط¶ظ‡', 35, '{GLOBAL,BRANCH}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (106, 'field_visits.reopen_closed', 'field_visits', 'field_visits', 'reopen_closed', 'ظپطھط­ ط²ظٹط§ط±ط© ظ…ظڈظ‚ظپظ„ط©', 90, '{GLOBAL}');
INSERT INTO public.permissions (id, key, module, sub_module, action, display_name, display_order, allowed_scopes) VALUES (107, 'clients.cooldown_unlock', 'clients', 'clients', 'cooldown_unlock', 'ظپظƒ ظپطھط±ط© ط§ظ„طھظ‡ط¯ط¦ط© (cooldown) ظ„ظ„ط²ط¨ظˆظ†', 85, '{GLOBAL,BRANCH}');


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.roles (id, name, display_name, description, is_system, is_active, created_at, updated_at, branch_id, is_template, template_id, is_protected, is_hidden, protected_reason, team_slot_type) VALUES (1, 'SYSTEM_ADMIN', 'ظ…ط¯ظٹط± ط§ظ„ظ†ط¸ط§ظ…', 'ط¯ظˆط± ط§ظ„ظ†ط¸ط§ظ… ط§ظ„ظƒط§ظ…ظ„ â€” ظٹظ…ظ„ظƒ ظƒظ„ ط§ظ„طµظ„ط§ط­ظٹط§طھ ط¨ظ†ط·ط§ظ‚ GLOBAL. ظ…ط­ظ…ظٹ ظ…ظ† ط§ظ„طھط¹ط¯ظٹظ„ ظˆط§ظ„ط­ط°ظپ.', true, true, '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03', NULL, true, NULL, true, true, 'ط¯ظˆط± ظ†ط¸ط§ظ…ظٹ ط£ط³ط§ط³ظٹ ظ„ط§ ظٹظ…ظƒظ† ط­ط°ظپظ‡ ط£ظˆ طھط¹ط¯ظٹظ„ طµظ„ط§ط­ظٹط§طھظ‡', NULL);
INSERT INTO public.roles (id, name, display_name, description, is_system, is_active, created_at, updated_at, branch_id, is_template, template_id, is_protected, is_hidden, protected_reason, team_slot_type) VALUES (2, 'CUSTOMER_SERVICE_SUPERVISOR', 'ظ…ط´ط±ظپط© ط®ط¯ظ…ط© ط²ط¨ط§ط¦ظ†', 'ط¯ظˆط± ظ…ط´ط±ظپط© ط®ط¯ظ…ط© ط§ظ„ط²ط¨ط§ط¦ظ† â€” طµظ„ط§ط­ظٹط§طھ ط¥ط¯ط§ط±ط© ط§ظ„ط¹ظ…ظ„ط§ط، ظˆط§ظ„ظ…ط±ط´ط­ظٹظ† ط¶ظ…ظ† ظ†ط·ط§ظ‚ ط§ظ„ظپط±ط¹ ظˆط§ظ„طھظƒظ„ظٹظپ', false, true, '2026-05-29 15:42:33.717512+03', '2026-05-29 15:42:33.717512+03', NULL, true, NULL, false, true, NULL, 'SUPERVISOR');


--
-- Data for Name: role_permission_grants; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (1, 1, 1, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (2, 1, 2, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (3, 1, 3, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (4, 1, 4, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (5, 1, 5, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (6, 1, 6, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (7, 1, 7, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (8, 1, 8, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (14, 1, 14, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (15, 1, 15, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (16, 1, 16, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (17, 1, 17, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (18, 1, 18, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (19, 1, 19, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (20, 1, 20, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (21, 1, 21, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (22, 1, 22, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (23, 1, 23, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (24, 1, 24, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.685622+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (25, 1, 25, 'GLOBAL', '2026-05-29 15:42:33.694985+03', '2026-05-29 15:42:33.694985+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (26, 1, 26, 'GLOBAL', '2026-05-29 15:42:33.694985+03', '2026-05-29 15:42:33.694985+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (27, 1, 27, 'GLOBAL', '2026-05-29 15:42:33.694985+03', '2026-05-29 15:42:33.694985+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (28, 1, 28, 'GLOBAL', '2026-05-29 15:42:33.694985+03', '2026-05-29 15:42:33.694985+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (29, 1, 29, 'GLOBAL', '2026-05-29 15:42:33.694985+03', '2026-05-29 15:42:33.694985+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (30, 1, 30, 'GLOBAL', '2026-05-29 15:42:33.694985+03', '2026-05-29 15:42:33.694985+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (31, 1, 31, 'GLOBAL', '2026-05-29 15:42:33.694985+03', '2026-05-29 15:42:33.694985+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (32, 1, 32, 'GLOBAL', '2026-05-29 15:42:33.694985+03', '2026-05-29 15:42:33.694985+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (33, 1, 33, 'GLOBAL', '2026-05-29 15:42:33.694985+03', '2026-05-29 15:42:33.694985+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (34, 1, 34, 'GLOBAL', '2026-05-29 15:42:33.694985+03', '2026-05-29 15:42:33.694985+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (35, 1, 35, 'GLOBAL', '2026-05-29 15:42:33.710117+03', '2026-05-29 15:42:33.710117+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (36, 2, 1, 'BRANCH', '2026-05-29 15:42:33.717512+03', '2026-05-29 15:42:33.717512+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (37, 2, 2, 'BRANCH', '2026-05-29 15:42:33.717512+03', '2026-05-29 15:42:33.717512+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (38, 2, 3, 'BRANCH', '2026-05-29 15:42:33.717512+03', '2026-05-29 15:42:33.717512+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (41, 2, 11, 'BRANCH', '2026-05-29 15:42:33.717512+03', '2026-05-29 15:42:33.717512+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (43, 2, 27, 'GLOBAL', '2026-05-29 15:42:33.717512+03', '2026-05-29 15:42:33.717512+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (44, 2, 31, 'GLOBAL', '2026-05-29 15:42:33.717512+03', '2026-05-29 15:42:33.717512+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (9, 1, 9, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.717512+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (10, 1, 10, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.717512+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (11, 1, 11, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.717512+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (12, 1, 12, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.717512+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (13, 1, 13, 'GLOBAL', '2026-05-29 15:42:33.685622+03', '2026-05-29 15:42:33.717512+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (50, 1, 36, 'GLOBAL', '2026-05-29 15:42:33.723373+03', '2026-05-29 15:42:33.723373+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (51, 1, 37, 'GLOBAL', '2026-05-29 15:42:33.723373+03', '2026-05-29 15:42:33.723373+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (52, 1, 38, 'GLOBAL', '2026-05-29 15:42:33.723373+03', '2026-05-29 15:42:33.723373+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (53, 1, 39, 'GLOBAL', '2026-05-29 15:42:33.723373+03', '2026-05-29 15:42:33.723373+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (54, 1, 40, 'GLOBAL', '2026-05-29 15:42:33.755532+03', '2026-05-29 15:42:33.755532+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (55, 1, 41, 'GLOBAL', '2026-05-29 15:42:33.759593+03', '2026-05-29 15:42:33.759593+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (56, 1, 43, 'GLOBAL', '2026-05-29 15:42:33.836311+03', '2026-05-29 15:42:33.836311+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (57, 1, 44, 'GLOBAL', '2026-05-29 15:42:33.836311+03', '2026-05-29 15:42:33.836311+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (58, 1, 45, 'GLOBAL', '2026-05-29 15:42:33.836311+03', '2026-05-29 15:42:33.836311+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (59, 1, 46, 'GLOBAL', '2026-05-29 15:42:33.836311+03', '2026-05-29 15:42:33.836311+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (60, 1, 47, 'GLOBAL', '2026-05-29 15:42:33.836311+03', '2026-05-29 15:42:33.836311+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (61, 1, 48, 'GLOBAL', '2026-05-29 15:42:33.836311+03', '2026-05-29 15:42:33.836311+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (62, 1, 49, 'GLOBAL', '2026-05-29 15:42:33.836311+03', '2026-05-29 15:42:33.836311+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (63, 2, 43, 'BRANCH', '2026-05-29 15:42:33.836311+03', '2026-05-29 15:42:33.836311+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (64, 2, 44, 'BRANCH', '2026-05-29 15:42:33.836311+03', '2026-05-29 15:42:33.836311+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (65, 2, 46, 'BRANCH', '2026-05-29 15:42:33.836311+03', '2026-05-29 15:42:33.836311+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (66, 2, 47, 'BRANCH', '2026-05-29 15:42:33.836311+03', '2026-05-29 15:42:33.836311+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (67, 2, 48, 'BRANCH', '2026-05-29 15:42:33.836311+03', '2026-05-29 15:42:33.836311+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (68, 2, 49, 'BRANCH', '2026-05-29 15:42:33.836311+03', '2026-05-29 15:42:33.836311+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (69, 1, 50, 'GLOBAL', '2026-05-29 15:42:33.949289+03', '2026-05-29 15:42:33.949289+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (70, 1, 51, 'GLOBAL', '2026-05-29 15:42:33.949289+03', '2026-05-29 15:42:33.949289+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (73, 1, 52, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (74, 1, 53, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (75, 1, 54, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (76, 1, 55, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (77, 1, 56, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (78, 1, 57, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (79, 1, 58, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (80, 1, 59, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (81, 1, 60, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (82, 1, 61, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (83, 1, 62, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (84, 1, 63, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (85, 1, 64, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (86, 1, 65, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (87, 1, 66, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (88, 1, 67, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (89, 1, 68, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (90, 1, 69, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (91, 1, 70, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (92, 1, 71, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (93, 1, 72, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (94, 1, 73, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (95, 1, 74, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (96, 1, 75, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (97, 1, 76, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (98, 1, 77, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (99, 1, 78, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (100, 1, 79, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (101, 1, 80, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (102, 1, 81, 'GLOBAL', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (103, 2, 35, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (104, 2, 41, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (105, 2, 52, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (106, 2, 53, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (107, 2, 54, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (108, 2, 55, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (109, 2, 56, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (110, 2, 57, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (111, 2, 58, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (112, 2, 59, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (113, 2, 60, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (114, 2, 61, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (115, 2, 62, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (116, 2, 63, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (117, 2, 64, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (118, 2, 65, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (119, 2, 66, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (120, 2, 67, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (121, 2, 68, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (122, 2, 69, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (123, 2, 70, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (124, 2, 71, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (125, 2, 72, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (126, 2, 73, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (127, 2, 74, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (128, 2, 75, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (129, 2, 76, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (130, 2, 77, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (131, 2, 78, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (132, 2, 79, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (133, 2, 80, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (134, 2, 81, 'BRANCH', '2026-05-29 15:42:34.017797+03', '2026-05-29 15:42:34.017797+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (135, 1, 82, 'GLOBAL', '2026-05-29 15:42:34.0771+03', '2026-05-29 15:42:34.0771+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (136, 1, 83, 'GLOBAL', '2026-05-29 15:42:34.0771+03', '2026-05-29 15:42:34.0771+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (137, 1, 89, 'GLOBAL', '2026-05-29 15:43:02.485401+03', '2026-05-29 15:43:02.485401+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (138, 1, 99, 'GLOBAL', '2026-05-29 15:43:39.246404+03', '2026-05-29 15:43:39.246404+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (139, 1, 100, 'GLOBAL', '2026-05-29 15:43:39.246404+03', '2026-05-29 15:43:39.246404+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (140, 1, 101, 'GLOBAL', '2026-05-29 15:43:39.265012+03', '2026-05-29 15:43:39.265012+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (141, 1, 102, 'GLOBAL', '2026-05-29 15:43:39.265012+03', '2026-05-29 15:43:39.265012+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (142, 1, 103, 'GLOBAL', '2026-05-29 15:43:39.270203+03', '2026-05-29 15:43:39.270203+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (143, 1, 104, 'GLOBAL', '2026-05-29 15:43:39.270203+03', '2026-05-29 15:43:39.270203+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (144, 1, 106, 'GLOBAL', '2026-06-01 01:42:50.855536+03', '2026-06-01 01:42:50.855536+03');
INSERT INTO public.role_permission_grants (id, role_id, permission_id, scope_type, created_at, updated_at) VALUES (145, 1, 107, 'GLOBAL', '2026-06-01 01:42:50.855536+03', '2026-06-01 01:42:50.855536+03');


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (1, 1, 1);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (2, 1, 2);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (3, 1, 3);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (4, 1, 4);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (5, 1, 5);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (6, 1, 6);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (7, 1, 7);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (8, 1, 8);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (9, 1, 9);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (10, 1, 10);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (11, 1, 11);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (12, 1, 12);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (13, 1, 13);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (14, 1, 14);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (15, 1, 15);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (16, 1, 16);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (17, 1, 17);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (18, 1, 18);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (19, 1, 19);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (20, 1, 20);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (21, 1, 21);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (22, 1, 22);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (23, 1, 23);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (24, 1, 24);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (25, 1, 25);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (26, 1, 26);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (27, 1, 27);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (28, 1, 28);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (29, 1, 29);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (30, 1, 30);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (31, 1, 31);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (32, 1, 32);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (33, 1, 33);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (34, 1, 34);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (35, 1, 35);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (36, 2, 1);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (37, 2, 2);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (38, 2, 3);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (39, 2, 9);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (40, 2, 10);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (41, 2, 11);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (42, 2, 12);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (43, 2, 27);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (44, 2, 31);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (50, 1, 36);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (51, 1, 37);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (52, 1, 38);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (53, 1, 39);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (54, 1, 40);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (55, 1, 41);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (56, 1, 43);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (57, 1, 44);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (58, 1, 45);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (59, 1, 46);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (60, 1, 47);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (61, 1, 48);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (62, 1, 49);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (63, 2, 43);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (64, 2, 44);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (65, 2, 46);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (66, 2, 47);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (67, 2, 48);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (68, 2, 49);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (69, 1, 50);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (70, 1, 51);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (71, 1, 82);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (72, 1, 83);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (73, 1, 84);
INSERT INTO public.role_permissions (id, role_id, permission_id) VALUES (74, 2, 84);


--
-- Data for Name: system_lists; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (1, 'job_title', 'ظ…ط´ط±ظپط©', true, 1, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (2, 'job_title', 'ظپظ†ظٹ', true, 2, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (3, 'job_title', 'طھظٹظ„ظ…ط§ط±ظƒطھط±', true, 3, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (4, 'job_title', 'ظپظ†ظٹ طµظٹط§ظ†ط© ط£ط¬ظ‡ط²ط©', true, 4, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (5, 'job_title', 'ظ…ظ†ط¯ظˆط¨ ظ…ط¨ظٹط¹ط§طھ', true, 5, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (6, 'job_title', 'ظپظ†ظٹ طھط±ظƒظٹط¨', true, 6, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (7, 'job_title', 'ظ…ط³ط¤ظˆظ„ ط®ط¯ظ…ط© ط§ظ„ط¹ظ…ظ„ط§ط،', true, 7, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (8, 'job_title', 'ظ…ط­ط§ط³ط¨', true, 8, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (9, 'certificate', 'ط§ط¨طھط¯ط§ط¦ظٹط©', true, 1, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (10, 'certificate', 'ظ…طھظˆط³ط·ط©', true, 2, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (11, 'certificate', 'ط¥ط¹ط¯ط§ط¯ظٹط©', true, 3, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (12, 'certificate', 'ط¯ط¨ظ„ظˆظ…', true, 4, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (13, 'certificate', 'ط¨ظƒط§ظ„ظˆط±ظٹظˆط³', true, 5, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (14, 'certificate', 'ظ…ط§ط¬ط³طھظٹط±', true, 6, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (15, 'certificate', 'ط¯ظƒطھظˆط±ط§ظ‡', true, 7, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (16, 'major:ط¯ط¨ظ„ظˆظ…', 'طھظ‚ظ†ظٹط§طھ ط­ط§ط³ط¨ط§طھ', true, 1, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (17, 'major:ط¯ط¨ظ„ظˆظ…', 'ط¥ط¯ط§ط±ط© ط£ط¹ظ…ط§ظ„', true, 2, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (18, 'major:ط¯ط¨ظ„ظˆظ…', 'ظ…ط­ط§ط³ط¨ط©', true, 3, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (19, 'major:ط¨ظƒط§ظ„ظˆط±ظٹظˆط³', 'ظ‡ظ†ط¯ط³ط© ط­ط§ط³ط¨ط§طھ', true, 1, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (20, 'major:ط¨ظƒط§ظ„ظˆط±ظٹظˆط³', 'ظ‡ظ†ط¯ط³ط© ظƒظ‡ط±ط¨ط§ط،', true, 2, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (21, 'major:ط¨ظƒط§ظ„ظˆط±ظٹظˆط³', 'ط¥ط¯ط§ط±ط© ط£ط¹ظ…ط§ظ„', true, 3, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (22, 'major:ط¨ظƒط§ظ„ظˆط±ظٹظˆط³', 'ظ…ط­ط§ط³ط¨ط©', true, 4, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (23, 'major:ظ…ط§ط¬ط³طھظٹط±', 'ظ‡ظ†ط¯ط³ط© ط­ط§ط³ط¨ط§طھ', true, 1, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (24, 'major:ظ…ط§ط¬ط³طھظٹط±', 'ط¥ط¯ط§ط±ط© ط£ط¹ظ…ط§ظ„', true, 2, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (25, 'major:ط¯ظƒطھظˆط±ط§ظ‡', 'ظ‡ظ†ط¯ط³ط© ط­ط§ط³ط¨ط§طھ', true, 1, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (26, 'application_source', 'ط¥ظ†طھط±ظ†طھ (Website)', true, 1, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (27, 'application_source', 'طھط³ط¬ظٹظ„ ط¯ط§ط®ظ„ظٹ', true, 2, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (28, 'application_source', 'ظ†ظ…ط§ط°ط¬ ظˆط±ظ‚ظٹط©', true, 3, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (29, 'application_source', 'طµظپط­ط© ظپظٹط³ط¨ظˆظƒ', true, 4, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (30, 'foreign_language', 'ط§ظ„ط¥ظ†ط¬ظ„ظٹط²ظٹط©', true, 1, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (31, 'foreign_language', 'ط§ظ„ظپط±ظ†ط³ظٹط©', true, 2, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (32, 'foreign_language', 'ط§ظ„ظƒط±ط¯ظٹط©', true, 3, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (33, 'foreign_language', 'ط§ظ„طھط±ظƒظٹط©', true, 4, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (34, 'foreign_language', 'ط§ظ„ط£ظ„ظ…ط§ظ†ظٹط©', true, 5, '2026-05-29 15:42:33.354691+03', '2026-05-29 15:42:33.354691+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (35, 'department_type', 'ظ…ط¨ظٹط¹ط§طھ', true, 1, '2026-05-29 15:42:33.531906+03', '2026-05-29 15:42:33.531906+03', NULL, '{"canSelectDevice": false}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (36, 'department_type', 'طھط³ظˆظٹظ‚', true, 2, '2026-05-29 15:42:33.531906+03', '2026-05-29 15:42:33.531906+03', NULL, '{"canSelectDevice": false}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (37, 'department_type', 'طµظٹط§ظ†ط©', true, 3, '2026-05-29 15:42:33.531906+03', '2026-05-29 15:42:33.531906+03', NULL, '{"canSelectDevice": true}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (38, 'department_type', 'ط®ط¯ظ…ط© ط¹ظ…ظ„ط§ط،', true, 4, '2026-05-29 15:42:33.531906+03', '2026-05-29 15:42:33.531906+03', NULL, '{"canSelectDevice": false}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (39, 'department_type', 'ظ…ظˆط§ط±ط¯ ط¨ط´ط±ظٹط©', true, 5, '2026-05-29 15:42:33.531906+03', '2026-05-29 15:42:33.531906+03', NULL, '{"canSelectDevice": false}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (40, 'department_type', 'ط¥ط¯ط§ط±ط©', true, 6, '2026-05-29 15:42:33.531906+03', '2026-05-29 15:42:33.531906+03', NULL, '{"canSelectDevice": false}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (41, 'department_type', 'ظ…ط­ط§ط³ط¨ط©', true, 7, '2026-05-29 15:42:33.531906+03', '2026-05-29 15:42:33.531906+03', NULL, '{"canSelectDevice": false}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (42, 'department_type', 'ظ…ط³طھظˆط¯ط¹', true, 8, '2026-05-29 15:42:33.531906+03', '2026-05-29 15:42:33.531906+03', NULL, '{"canSelectDevice": true}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (43, 'department_type', 'طھظ‚ظ†ظٹط© ظ…ط¹ظ„ظˆظ…ط§طھ', true, 9, '2026-05-29 15:42:33.531906+03', '2026-05-29 15:42:33.531906+03', NULL, '{"canSelectDevice": true}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (44, 'military_service', 'ظ…ظ†ظ‡ظٹ', true, 1, '2026-05-29 15:42:33.551677+03', '2026-05-29 15:42:33.551677+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (45, 'military_service', 'ظ…ط¹ظپظ‰', true, 2, '2026-05-29 15:42:33.551677+03', '2026-05-29 15:42:33.551677+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (46, 'military_service', 'ظ…ط¤ط¬ظ„', true, 3, '2026-05-29 15:42:33.551677+03', '2026-05-29 15:42:33.551677+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (47, 'military_service', 'ط؛ظٹط± ظ…ط·ظ„ظˆط¨', true, 4, '2026-05-29 15:42:33.551677+03', '2026-05-29 15:42:33.551677+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (48, 'contract_type', 'ط¯ط§ط¦ظ…', true, 1, '2026-05-29 15:42:33.551677+03', '2026-05-29 15:42:33.551677+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (49, 'contract_type', 'ظ…ط¤ظ‚طھ', true, 2, '2026-05-29 15:42:33.551677+03', '2026-05-29 15:42:33.551677+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (50, 'contract_type', 'طھط¬ط±ط¨ط©', true, 3, '2026-05-29 15:42:33.551677+03', '2026-05-29 15:42:33.551677+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (51, 'contract_type', 'ط¬ط²ط¦ظٹ', true, 4, '2026-05-29 15:42:33.551677+03', '2026-05-29 15:42:33.551677+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (57, 'job_title', 'ظ…طھط¯ط±ط¨', true, 9, '2026-05-29 15:42:33.81304+03', '2026-05-29 15:42:33.81304+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (58, 'telemarketing_rejection_reason', 'طھط¬ط§ظˆط² ط¹ط¯ط¯ ظ…ط­ط§ظˆظ„ط§طھ ط§ظ„ط§طھطµط§ظ„', true, 1, '2026-05-29 15:43:02.095345+03', '2026-05-29 15:43:02.095345+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (59, 'telemarketing_rejection_reason', 'ط§ظ„ط±ظ‚ظ… ط®ط§ط·ط¦ ط£ظˆ ط؛ظٹط± طµط§ظ„ط­', true, 2, '2026-05-29 15:43:02.095345+03', '2026-05-29 15:43:02.095345+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (60, 'telemarketing_rejection_reason', 'ط·ظ„ط¨ ط¹ط¯ظ… ط§ظ„ط§طھطµط§ظ„ ط¨ظ‡', true, 3, '2026-05-29 15:43:02.095345+03', '2026-05-29 15:43:02.095345+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (61, 'telemarketing_rejection_reason', 'ط؛ظٹط± ظ…ظ‡طھظ… ظ†ظ‡ط§ط¦ظٹط§ظ‹', true, 4, '2026-05-29 15:43:02.095345+03', '2026-05-29 15:43:02.095345+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (62, 'telemarketing_rejection_reason', 'ط®ط§ط±ط¬ ظ†ط·ط§ظ‚ ط§ظ„ط®ط¯ظ…ط©', true, 5, '2026-05-29 15:43:02.095345+03', '2026-05-29 15:43:02.095345+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (63, 'telemarketing_rejection_reason', 'ط£ط®ط±ظ‰', true, 6, '2026-05-29 15:43:02.095345+03', '2026-05-29 15:43:02.095345+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (64, 'telemarketing_reschedule_reason', 'ط§ظ„ط²ط¨ظˆظ† ظ…ط´ط؛ظˆظ„ ط­ط§ظ„ظٹط§ظ‹', true, 1, '2026-05-29 15:43:02.095345+03', '2026-05-29 15:43:02.095345+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (65, 'telemarketing_reschedule_reason', 'ط·ظ„ط¨ ط§ظ„ظ…طھط§ط¨ط¹ط© ظ„ط§ط­ظ‚ط§ظ‹', true, 2, '2026-05-29 15:43:02.095345+03', '2026-05-29 15:43:02.095345+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (66, 'telemarketing_reschedule_reason', 'ظ„ط¯ظٹظ‡ ط¬ظ‡ط§ط² ظ…ظ† ط´ط±ظƒط© ط£ط®ط±ظ‰', true, 3, '2026-05-29 15:43:02.095345+03', '2026-05-29 15:43:02.095345+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (67, 'telemarketing_reschedule_reason', 'ط§ط·ظ‘ظ„ط¹ ط¹ظ„ظ‰ ط§ظ„ط¹ط±ط¶ ط³ط§ط¨ظ‚ط§ظ‹', true, 4, '2026-05-29 15:43:02.095345+03', '2026-05-29 15:43:02.095345+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (68, 'telemarketing_reschedule_reason', 'ط£ط®ط±ظ‰', true, 5, '2026-05-29 15:43:02.095345+03', '2026-05-29 15:43:02.095345+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (69, 'part_no_retrieval_reason', 'ط§ظ„ط²ط¨ظˆظ† ط§ط­طھظپط¸ ط¨ظ‡ط§', true, 1, '2026-05-29 15:43:02.43279+03', '2026-05-29 15:43:02.43279+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (70, 'part_no_retrieval_reason', 'ظƒط§ظ†طھ ظ…طھظƒط³ط±ط©', true, 2, '2026-05-29 15:43:02.43279+03', '2026-05-29 15:43:02.43279+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (71, 'part_no_retrieval_reason', 'طھط¹ط°ط± ط§ظ„ظˆطµظˆظ„ ط¥ظ„ظٹظ‡ط§', true, 3, '2026-05-29 15:43:02.43279+03', '2026-05-29 15:43:02.43279+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (72, 'part_no_retrieval_reason', 'ط³ط¨ط¨ ط¢ط®ط±', true, 4, '2026-05-29 15:43:02.43279+03', '2026-05-29 15:43:02.43279+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (73, 'discount_reason', 'ط´ظƒظˆظ‰ ظ…طھظƒط±ط±ط©', true, 1, '2026-05-29 15:43:02.43279+03', '2026-05-29 15:43:02.43279+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (74, 'discount_reason', 'ط¶ظٹظ‚ ظ…ط§ط¯ظٹ', true, 2, '2026-05-29 15:43:02.43279+03', '2026-05-29 15:43:02.43279+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (75, 'discount_reason', 'ط®ط¯ظ…ط© طھط±ط­ظٹط¨ظٹط©', true, 3, '2026-05-29 15:43:02.43279+03', '2026-05-29 15:43:02.43279+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (76, 'discount_reason', 'ظ‚ط±ط§ط± ط¥ط¯ط§ط±ظٹ', true, 4, '2026-05-29 15:43:02.43279+03', '2026-05-29 15:43:02.43279+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (77, 'discount_reason', 'ط®ط·ط£ ظ…ظ† ط§ظ„ظپظ†ظٹ', true, 5, '2026-05-29 15:43:02.43279+03', '2026-05-29 15:43:02.43279+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (78, 'emergency_resolved_reason', 'طھط؛ظٹظٹط± ظپظ„طھط±', true, 1, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (79, 'emergency_resolved_reason', 'ط¥طµظ„ط§ط­ طھط³ط±ط¨', true, 2, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (80, 'emergency_resolved_reason', 'طھط؛ظٹظٹط± ظ…ط¶ط®ط©', true, 3, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (81, 'emergency_resolved_reason', 'طھظ†ط¸ظٹظپ ط§ظ„ط¬ظ‡ط§ط²', true, 4, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (82, 'emergency_resolved_reason', 'ط§ط³طھط¨ط¯ط§ظ„ ط؛ط´ط§ط،', true, 5, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (83, 'emergency_resolved_reason', 'ط¥طµظ„ط§ط­ ظƒظ‡ط±ط¨ط§ط¦ظٹ', true, 6, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (84, 'emergency_resolved_reason', 'ط³ط¨ط¨ ط¢ط®ط±', true, 7, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (85, 'emergency_unresolved_reason', 'ظ‚ط·ط¹ط© ط؛ظٹط± ظ…طھظˆظپط±ط©', true, 1, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (86, 'emergency_unresolved_reason', 'طھط­طھط§ط¬ ظپظ†ظٹ ظ…طھط®طµطµ', true, 2, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (87, 'emergency_unresolved_reason', 'ظ…ط´ظƒظ„ط© ط£ط¹ظ…ظ‚ ظ…ظ† ط§ظ„ظ…طھظˆظ‚ط¹', true, 3, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (88, 'emergency_unresolved_reason', 'طھط¹ط°ط± ط§ظ„ظˆطµظˆظ„ ظ„ظ„ط¬ظ‡ط§ط²', true, 4, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (89, 'emergency_unresolved_reason', 'ط³ط¨ط¨ ط¢ط®ط±', true, 5, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (90, 'emergency_cancelled_reason', 'ط±ظپط¶ ط§ظ„ط²ط¨ظˆظ† ط§ظ„ط®ط¯ظ…ط©', true, 1, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (91, 'emergency_cancelled_reason', 'ط§ظ„ط²ط¨ظˆظ† ط؛ظٹط± ظ…طھظˆط§ط¬ط¯', true, 2, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (92, 'emergency_cancelled_reason', 'ط§ظ„ط¹ظ‚ط¯ ظ…ظ†طھظ‡ظچ', true, 3, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (93, 'emergency_cancelled_reason', 'ظ‚ط±ط§ط± ط¥ط¯ط§ط±ظٹ', true, 4, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (94, 'emergency_cancelled_reason', 'ط³ط¨ط¨ ط¢ط®ط±', true, 5, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (95, 'emergency_followup_reason', 'ط§ظ†طھط¸ط§ط± ظ‚ط·ط¹ط©', true, 1, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (96, 'emergency_followup_reason', 'ط§ظ„ط²ط¨ظˆظ† ط·ظ„ط¨ ظ…ظˆط¹ط¯ط§ظ‹ ظ„ط§ط­ظ‚ط§ظ‹', true, 2, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (97, 'emergency_followup_reason', 'طھط­طھط§ط¬ ظپظ†ظٹ ظ…طھط®طµطµ', true, 3, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (98, 'emergency_followup_reason', 'ط§ظ„ط¹ظ…ظ„ ط؛ظٹط± ظ…ظƒطھظ…ظ„', true, 4, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (99, 'emergency_followup_reason', 'ط³ط¨ط¨ ط¢ط®ط±', true, 5, '2026-05-29 15:43:02.45812+03', '2026-05-29 15:43:02.45812+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (100, 'transfer_company', 'ط´ط§ظ… ظƒط§ط´', true, 1, '2026-05-29 15:43:02.469999+03', '2026-05-29 15:43:02.469999+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (101, 'transfer_company', 'ط³ظٹط±ظٹطھظٹظ„ ظƒط§ط´', true, 2, '2026-05-29 15:43:02.469999+03', '2026-05-29 15:43:02.469999+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (102, 'transfer_company', 'MTN ظƒط§ط´', true, 3, '2026-05-29 15:43:02.469999+03', '2026-05-29 15:43:02.469999+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (103, 'transfer_company', 'ط¨ظٹظ…ظˆ', true, 4, '2026-05-29 15:43:02.469999+03', '2026-05-29 15:43:02.469999+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (104, 'transfer_company', 'ط³ط¨ط£', true, 5, '2026-05-29 15:43:02.469999+03', '2026-05-29 15:43:02.469999+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (105, 'transfer_company', 'ط£ط®ط±ظ‰', true, 6, '2026-05-29 15:43:02.469999+03', '2026-05-29 15:43:02.469999+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (106, 'no_closing_reasons', 'ظ„ظ… ظٹطھظ… ط§ظ„طھط³ظƒظٹط±', true, 1, '2026-05-29 15:43:02.649571+03', '2026-05-29 15:43:02.649571+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (107, 'no_closing_reasons', 'ظ…طھط§ط¨ط¹ط© ظ„ط§ط­ظ‚ط©', true, 2, '2026-05-29 15:43:02.649571+03', '2026-05-29 15:43:02.649571+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (108, 'no_closing_reasons', 'ط§ظ„ط¹ظ…ظٹظ„ ظ…ط´ط؛ظˆظ„', true, 3, '2026-05-29 15:43:02.649571+03', '2026-05-29 15:43:02.649571+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (109, 'no_closing_reasons', 'ط³ط¨ط¨ ط³ط¹ط±ظٹ', true, 4, '2026-05-29 15:43:02.649571+03', '2026-05-29 15:43:02.649571+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (110, 'no_closing_reasons', 'ط£ط®ط±ظ‰', true, 5, '2026-05-29 15:43:02.649571+03', '2026-05-29 15:43:02.649571+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (111, 'contract_sale_source', 'طھط·ط¨ظٹظ‚', true, 1, '2026-05-29 15:43:02.676395+03', '2026-05-29 15:43:02.676395+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (112, 'contract_sale_source', 'طھظˆط§طµظ„ ط§ط¬طھظ…ط§ط¹ظٹ', true, 2, '2026-05-29 15:43:02.676395+03', '2026-05-29 15:43:02.676395+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (113, 'contract_sale_source', 'ظ…ط¨ط§ط´ط±', true, 3, '2026-05-29 15:43:02.676395+03', '2026-05-29 15:43:02.676395+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (114, 'contract_sale_source', 'ط¥ط­ط§ظ„ط©', true, 4, '2026-05-29 15:43:02.676395+03', '2026-05-29 15:43:02.676395+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (115, 'visit_cancellation_reasons', 'ط±ظپط¶ ط§ظ„ط²ط¨ظˆظ† ط§ظ„ط²ظٹط§ط±ط©', true, 1, '2026-05-29 15:43:39.134601+03', '2026-05-29 15:43:39.134601+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (116, 'visit_cancellation_reasons', 'ط§ظ„ط²ط¨ظˆظ† ط؛ظٹط± ظ…طھظˆط§ط¬ط¯', true, 2, '2026-05-29 15:43:39.134601+03', '2026-05-29 15:43:39.134601+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (117, 'visit_cancellation_reasons', 'طھط¹ط°ظ‘ط± ط§ظ„ظˆطµظˆظ„ ظ„ظ„ط¹ظ†ظˆط§ظ†', true, 3, '2026-05-29 15:43:39.134601+03', '2026-05-29 15:43:39.134601+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (118, 'visit_cancellation_reasons', 'ط·ظ„ط¨ ط§ظ„ط²ط¨ظˆظ† ط§ظ„طھط£ط¬ظٹظ„', true, 4, '2026-05-29 15:43:39.134601+03', '2026-05-29 15:43:39.134601+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (119, 'visit_cancellation_reasons', 'ظ‚ط±ط§ط± ط¥ط¯ط§ط±ظٹ ظ…ظ† ط§ظ„ط´ط±ظƒط©', true, 5, '2026-05-29 15:43:39.134601+03', '2026-05-29 15:43:39.134601+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (120, 'visit_cancellation_reasons', 'ط³ط¨ط¨ ط¢ط®ط±', true, 6, '2026-05-29 15:43:39.134601+03', '2026-05-29 15:43:39.134601+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (121, 'area_evaluation_options', 'ظ…ظ…طھط§ط²ط©', true, 1, '2026-06-01 01:42:50.72802+03', '2026-06-01 01:42:50.72802+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (122, 'area_evaluation_options', 'ط¬ظٹط¯ط©', true, 2, '2026-06-01 01:42:50.72802+03', '2026-06-01 01:42:50.72802+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (123, 'area_evaluation_options', 'ظ…طھظˆط³ط·ط©', true, 3, '2026-06-01 01:42:50.72802+03', '2026-06-01 01:42:50.72802+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (124, 'area_evaluation_options', 'ط¶ط¹ظٹظپط©', true, 4, '2026-06-01 01:42:50.72802+03', '2026-06-01 01:42:50.72802+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (125, 'survey_skip_reasons', 'ط£ط®ط±ظ‰', true, 99, '2026-06-01 01:42:50.72802+03', '2026-06-01 01:42:50.72802+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (126, 'customer_followup_reasons', 'ط£ط®ط±ظ‰', true, 99, '2026-06-01 01:42:50.849804+03', '2026-06-01 01:42:50.849804+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (127, 'visit_cancellation_reasons', 'ط£ط®ط±ظ‰', true, 99, '2026-06-01 01:42:50.849804+03', '2026-06-01 01:42:50.849804+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (128, 'location_missing_reasons', 'ط£ط®ط±ظ‰', true, 99, '2026-06-01 01:42:50.849804+03', '2026-06-01 01:42:50.849804+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (129, 'cooldown_manual_reasons', 'ط£ط®ط±ظ‰', true, 99, '2026-06-01 01:42:50.849804+03', '2026-06-01 01:42:50.849804+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (130, 'visit_not_completed_reasons', 'ط£ط®ط±ظ‰', true, 99, '2026-06-01 01:42:50.849804+03', '2026-06-01 01:42:50.849804+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (131, 'not_interested_reasons', 'ط£ط®ط±ظ‰', true, 99, '2026-06-01 01:42:50.849804+03', '2026-06-01 01:42:50.849804+03', NULL, '{}');
INSERT INTO public.system_lists (id, category, value, is_active, display_order, created_at, updated_at, linked_role_id, metadata) VALUES (132, 'visit_task_reasons', 'ط£ط®ط±ظ‰', true, 99, '2026-06-01 01:42:50.849804+03', '2026-06-01 01:42:50.849804+03', NULL, '{}');


--
-- Data for Name: system_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.system_settings (id, key, value, value_type, category, description, is_editable, updated_by, created_at, updated_at) VALUES (1, 'default_cooldown_days', '7', 'integer', 'telemarketing', 'ط§ظ„ظ…ط¯ط© ط§ظ„ط§ظپطھط±ط§ط¶ظٹط© ظ„ظ€ cooldown ط¹ظ†ط¯ طھظپط¹ظٹظ„ظ‡ طھظ„ظ‚ط§ط¦ظٹط§ظ‹ ط¨ط¹ط¯ ظ†طھظٹط¬ط© not_interested (DEC-005 D29)', true, NULL, '2026-06-01 01:42:50.756743+03', '2026-06-01 01:42:50.756743+03');
INSERT INTO public.system_settings (id, key, value, value_type, category, description, is_editable, updated_by, created_at, updated_at) VALUES (2, 'contact_target_cleanup_time', '22:00', 'time', 'telemarketing', 'ظˆظ‚طھ طھط´ط؛ظٹظ„ CRON ظٹظˆظ…ظٹ ظ„ط¥ط؛ظ„ط§ظ‚ contact_targets ط§ظ„ظ‚ط¯ظٹظ…ط© (DEC-005 D26)', true, NULL, '2026-06-01 01:42:50.756743+03', '2026-06-01 01:42:50.756743+03');
INSERT INTO public.system_settings (id, key, value, value_type, category, description, is_editable, updated_by, created_at, updated_at) VALUES (3, 'attempt_alert_threshold', '5', 'integer', 'telemarketing', 'ط¹طھط¨ط© ظ…ط­ط§ظˆظ„ط§طھ ط§ظ„ط§طھطµط§ظ„ ط§ظ„طھظٹ طھظڈط·ظ„ظ‚ طھظ†ط¨ظٹظ‡ط§ظ‹ ظ„ظ„ظ…ط´ط±ظپ. ظ„ط§ ط¥ط؛ظ„ط§ظ‚ ظ‚ط³ط±ظٹ (DEC-006 D37)', true, NULL, '2026-06-01 01:42:50.756743+03', '2026-06-01 01:42:50.756743+03');
INSERT INTO public.system_settings (id, key, value, value_type, category, description, is_editable, updated_by, created_at, updated_at) VALUES (4, 'visit_undocumented_alert_hours_l1', '24', 'integer', 'visits', 'ط¨ط¹ط¯ ظƒظ… ط³ط§ط¹ط© ظ…ظ† ط¨ط¯ط،/ط¥ظ†ظ‡ط§ط، ط§ظ„ط²ظٹط§ط±ط© ط¨ط¯ظˆظ† طھظˆط«ظٹظ‚ ظٹظڈط±ط³ظ„ طھظ†ط¨ظٹظ‡ ظ„ظ„ظپظ†ظٹ (DEC-006 D38 L1)', true, NULL, '2026-06-01 01:42:50.756743+03', '2026-06-01 01:42:50.756743+03');
INSERT INTO public.system_settings (id, key, value, value_type, category, description, is_editable, updated_by, created_at, updated_at) VALUES (5, 'visit_undocumented_alert_hours_l2', '48', 'integer', 'visits', 'ط¨ط¹ط¯ ظƒظ… ط³ط§ط¹ط© ظٹظڈط±ط³ظ„ طھظ†ط¨ظٹظ‡ ظ„ظ„ظ…ط´ط±ظپ + ظٹظڈظ…ظ†ط¹ ط§ظ„ظپظ†ظٹ ظ…ظ† ط¨ط¯ط، ط²ظٹط§ط±ط© ط¬ط¯ظٹط¯ط© (DEC-006 D38 L2)', true, NULL, '2026-06-01 01:42:50.756743+03', '2026-06-01 01:42:50.756743+03');
INSERT INTO public.system_settings (id, key, value, value_type, category, description, is_editable, updated_by, created_at, updated_at) VALUES (6, 'visit_undocumented_alert_hours_l3', '72', 'integer', 'visits', 'ط¨ط¹ط¯ ظƒظ… ط³ط§ط¹ط© ظٹظڈطµط¹ظژظ‘ط¯ ظ„ظ…ط¯ظٹط± ط§ظ„ظپط±ط¹ (DEC-006 D38 L3)', true, NULL, '2026-06-01 01:42:50.756743+03', '2026-06-01 01:42:50.756743+03');


--
-- Data for Name: task_type_config; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('device_demo', 'marketing', 'ط¹ط±ط¶ ط¬ظ‡ط§ط²', 'expected_window', 'expected_date', 7, false, false, false, 1, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'client', 'marketing');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('device_purchase', 'sales', 'ط´ط±ط§ط، ط¬ظ‡ط§ط² (طھظˆظ‚ظٹط¹ ط¹ظ‚ط¯)', 'immediate', 'none', NULL, true, false, false, 2, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'client', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('gift_delivery', 'delivery', 'طھط³ظ„ظٹظ… ظ‡ط¯ظٹط©', 'short_window', 'due_date', 7, false, true, true, 10, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'client', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('device_checkup', 'marketing', 'طھط´ظٹظٹظƒ ط¹ظ„ظ‰ ط§ظ„ط¬ظ‡ط§ط²', 'long_window', 'due_date', 30, true, false, true, 11, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'client', 'marketing');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('device_delivery', 'delivery', 'طھط³ظ„ظٹظ… ط§ظ„ط¬ظ‡ط§ط²', 'short_window', 'due_date', 3, true, false, true, 3, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('device_installation', 'delivery', 'طھط±ظƒظٹط¨ ط§ظ„ط¬ظ‡ط§ط²', 'short_window', 'due_date', 3, true, false, true, 4, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('device_activation', 'delivery', 'طھط´ط؛ظٹظ„ ط§ظ„ط¬ظ‡ط§ط²', 'short_window', 'due_date', 3, true, false, true, 5, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('periodic_maintenance', 'maintenance', 'ط§ظ„طµظٹط§ظ†ط© ط§ظ„ط¯ظˆط±ظٹط©', 'long_window', 'due_date', 30, true, true, true, 6, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('emergency_maintenance', 'emergency', 'ط§ظ„طµظٹط§ظ†ط© ط§ظ„ط·ط§ط±ط¦ط©', 'immediate', 'none', NULL, true, true, false, 7, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('installment_collection', 'collection', 'طھط­طµظٹظ„ ظ‚ط³ط· ط¬ظ‡ط§ط²', 'long_window', 'due_date', 15, true, true, true, 8, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'collection');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('maintenance_collection', 'collection', 'طھط­طµظٹظ„ ط°ظ…ط© طµظٹط§ظ†ط©', 'long_window', 'due_date', 15, true, true, true, 9, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'collection');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('parts_sale', 'service', 'ط´ط±ط§ط، ظ‚ط·ط¹ط© ط¯ظˆظ† طھط¨ط¯ظٹظ„', 'immediate', 'none', NULL, true, true, false, 12, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('device_retrieval', 'service', 'ط³ط­ط¨ ط§ظ„ط¬ظ‡ط§ط² ظ„ظ„ط´ط±ظƒط©', 'immediate', 'none', NULL, true, true, false, 13, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('device_repair', 'service', 'ظپط­طµ ظˆط¥طµظ„ط§ط­ ط¨ط§ظ„ط´ط±ظƒط©', 'immediate', 'none', NULL, true, true, false, 14, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('device_return', 'service', 'ط¥ط¹ط§ط¯ط© ط§ظ„ط¬ظ‡ط§ط² ط¨ط¹ط¯ ط§ظ„طµظٹط§ظ†ط©', 'short_window', 'due_date', 3, true, true, true, 15, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('golden_warranty', 'warranty', 'ظ…ظ†ط­ ظƒظپط§ظ„ط© ط°ظ‡ط¨ظٹط©', 'immediate', 'none', NULL, true, false, false, 16, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('warranty_cancellation', 'warranty', 'ط¥ظ„ط؛ط§ط، ط§ظ„ظƒظپط§ظ„ط© ط§ظ„ط£ط³ط§ط³ظٹط©', 'immediate', 'none', NULL, true, false, false, 17, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('warranty_reactivation', 'warranty', 'ط¥ط¹ط§ط¯ط© طھظپط¹ظٹظ„ ط§ظ„ظƒظپط§ظ„ط©', 'immediate', 'none', NULL, true, false, false, 18, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('device_disconnection', 'service', 'طھظˆظ‚ظٹظپ ط§ظ„ط¬ظ‡ط§ط² ظ…ط¤ظ‚طھط§ظ‹', 'immediate', 'none', NULL, true, false, false, 19, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'service');
INSERT INTO public.task_type_config (task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active, created_at, updated_at, location_basis, contact_target_visit_type) VALUES ('device_transfer', 'service', 'ظ†ظ‚ظ„ ط§ظ„ط¬ظ‡ط§ط² ظ„ط¹ظ†ظˆط§ظ† ط¬ط¯ظٹط¯', 'immediate', 'none', NULL, true, false, false, 20, true, '2026-05-29 15:43:02.258667+03', '2026-05-29 15:43:02.258667+03', 'contract', 'service');


--
-- Name: branches_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.branches_id_seq', 2, true);


--
-- Name: emergency_action_types_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.emergency_action_types_id_seq', 8, true);


--
-- Name: geo_units_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.geo_units_id_seq', 261, true);


--
-- Name: permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.permissions_id_seq', 107, true);


--
-- Name: role_permission_grants_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.role_permission_grants_id_seq', 145, true);


--
-- Name: role_permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.role_permissions_id_seq', 74, true);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.roles_id_seq', 2, true);


--
-- Name: system_lists_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.system_lists_id_seq', 132, true);


--
-- Name: system_settings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.system_settings_id_seq', 6, true);


--
-- PostgreSQL database dump complete
--


--
-- PostgreSQL database dump
--


-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

--
-- Name: applicants applicants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applicants
    ADD CONSTRAINT applicants_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: branch_geo_coverage branch_geo_coverage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_geo_coverage
    ADD CONSTRAINT branch_geo_coverage_pkey PRIMARY KEY (branch_id, geo_unit_id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: call_task_links call_task_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_task_links
    ADD CONSTRAINT call_task_links_pkey PRIMARY KEY (call_id, task_id);


--
-- Name: candidate_assignments candidate_assignments_candidate_id_hr_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_assignments
    ADD CONSTRAINT candidate_assignments_candidate_id_hr_user_id_key UNIQUE (candidate_id, hr_user_id);


--
-- Name: candidate_assignments candidate_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_assignments
    ADD CONSTRAINT candidate_assignments_pkey PRIMARY KEY (id);


--
-- Name: candidates candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_pkey PRIMARY KEY (id);


--
-- Name: client_assignments client_assignments_client_id_hr_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_assignments
    ADD CONSTRAINT client_assignments_client_id_hr_user_id_key UNIQUE (client_id, hr_user_id);


--
-- Name: client_assignments client_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_assignments
    ADD CONSTRAINT client_assignments_pkey PRIMARY KEY (id);


--
-- Name: client_audit_log client_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_audit_log
    ADD CONSTRAINT client_audit_log_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: contact_targets contact_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_targets
    ADD CONSTRAINT contact_targets_pkey PRIMARY KEY (id);


--
-- Name: contract_documents contract_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_documents
    ADD CONSTRAINT contract_documents_pkey PRIMARY KEY (id);


--
-- Name: contract_installments contract_installments_contract_id_installment_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_installments
    ADD CONSTRAINT contract_installments_contract_id_installment_number_key UNIQUE (contract_id, installment_number);


--
-- Name: contract_installments contract_installments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_installments
    ADD CONSTRAINT contract_installments_pkey PRIMARY KEY (id);


--
-- Name: contract_line_items contract_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_line_items
    ADD CONSTRAINT contract_line_items_pkey PRIMARY KEY (id);


--
-- Name: contract_payment_entries contract_payment_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_payment_entries
    ADD CONSTRAINT contract_payment_entries_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_contract_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_contract_number_key UNIQUE (contract_number);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: customer_call_logs customer_call_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_call_logs
    ADD CONSTRAINT customer_call_logs_pkey PRIMARY KEY (id);


--
-- Name: customer_device_pre_offers customer_device_pre_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_device_pre_offers
    ADD CONSTRAINT customer_device_pre_offers_pkey PRIMARY KEY (id);


--
-- Name: day_schedules day_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_schedules
    ADD CONSTRAINT day_schedules_pkey PRIMARY KEY (date);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: device_discounts device_discounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_discounts
    ADD CONSTRAINT device_discounts_pkey PRIMARY KEY (id);


--
-- Name: device_installed_parts device_installed_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_installed_parts
    ADD CONSTRAINT device_installed_parts_pkey PRIMARY KEY (id);


--
-- Name: device_models device_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_models
    ADD CONSTRAINT device_models_pkey PRIMARY KEY (id);


--
-- Name: device_possession_log device_possession_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_possession_log
    ADD CONSTRAINT device_possession_log_pkey PRIMARY KEY (id);


--
-- Name: device_technical_states device_technical_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_technical_states
    ADD CONSTRAINT device_technical_states_pkey PRIMARY KEY (id);


--
-- Name: device_warranties device_warranties_device_id_warranty_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_warranties
    ADD CONSTRAINT device_warranties_device_id_warranty_type_key UNIQUE (device_id, warranty_type);


--
-- Name: device_warranties device_warranties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_warranties
    ADD CONSTRAINT device_warranties_pkey PRIMARY KEY (id);


--
-- Name: direct_suggestions direct_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_suggestions
    ADD CONSTRAINT direct_suggestions_pkey PRIMARY KEY (id);


--
-- Name: dues dues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dues
    ADD CONSTRAINT dues_pkey PRIMARY KEY (id);


--
-- Name: emergency_action_types emergency_action_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_action_types
    ADD CONSTRAINT emergency_action_types_pkey PRIMARY KEY (id);


--
-- Name: emergency_installments emergency_installments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_installments
    ADD CONSTRAINT emergency_installments_pkey PRIMARY KEY (id);


--
-- Name: emergency_maintenance_actions emergency_maintenance_actions_open_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_maintenance_actions
    ADD CONSTRAINT emergency_maintenance_actions_open_task_id_key UNIQUE (open_task_id);


--
-- Name: emergency_maintenance_actions emergency_maintenance_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_maintenance_actions
    ADD CONSTRAINT emergency_maintenance_actions_pkey PRIMARY KEY (id);


--
-- Name: emergency_payment_entries emergency_payment_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_payment_entries
    ADD CONSTRAINT emergency_payment_entries_pkey PRIMARY KEY (id);


--
-- Name: emergency_result_costs emergency_result_costs_open_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_result_costs
    ADD CONSTRAINT emergency_result_costs_open_task_id_key UNIQUE (open_task_id);


--
-- Name: emergency_result_costs emergency_result_costs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_result_costs
    ADD CONSTRAINT emergency_result_costs_pkey PRIMARY KEY (id);


--
-- Name: emergency_result_parts emergency_result_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_result_parts
    ADD CONSTRAINT emergency_result_parts_pkey PRIMARY KEY (id);


--
-- Name: emergency_tickets emergency_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_tickets
    ADD CONSTRAINT emergency_tickets_pkey PRIMARY KEY (id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: field_visits field_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_visits
    ADD CONSTRAINT field_visits_pkey PRIMARY KEY (id);


--
-- Name: geo_units geo_units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_units
    ADD CONSTRAINT geo_units_pkey PRIMARY KEY (id);


--
-- Name: hr_users hr_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_users
    ADD CONSTRAINT hr_users_pkey PRIMARY KEY (id);


--
-- Name: hr_users hr_users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_users
    ADD CONSTRAINT hr_users_username_key UNIQUE (username);


--
-- Name: installed_devices installed_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installed_devices
    ADD CONSTRAINT installed_devices_pkey PRIMARY KEY (id);


--
-- Name: interviews interviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_pkey PRIMARY KEY (id);


--
-- Name: job_applications job_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_applications
    ADD CONSTRAINT job_applications_pkey PRIMARY KEY (id);


--
-- Name: job_vacancies job_vacancies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_vacancies
    ADD CONSTRAINT job_vacancies_pkey PRIMARY KEY (id);


--
-- Name: maintenance_requests maintenance_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_requests
    ADD CONSTRAINT maintenance_requests_pkey PRIMARY KEY (id);


--
-- Name: open_task_delivery_results open_task_delivery_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_delivery_results
    ADD CONSTRAINT open_task_delivery_results_pkey PRIMARY KEY (id);


--
-- Name: open_task_devices open_task_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_devices
    ADD CONSTRAINT open_task_devices_pkey PRIMARY KEY (id);


--
-- Name: open_task_installation_results open_task_installation_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_installation_results
    ADD CONSTRAINT open_task_installation_results_pkey PRIMARY KEY (id);


--
-- Name: open_task_pre_offers open_task_pre_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_pre_offers
    ADD CONSTRAINT open_task_pre_offers_pkey PRIMARY KEY (id);


--
-- Name: open_tasks open_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks
    ADD CONSTRAINT open_tasks_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_key_key UNIQUE (key);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: referral_sheets referral_sheets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_sheets
    ADD CONSTRAINT referral_sheets_pkey PRIMARY KEY (id);


--
-- Name: referrers referrers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrers
    ADD CONSTRAINT referrers_pkey PRIMARY KEY (id);


--
-- Name: role_job_tasks role_job_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_job_tasks
    ADD CONSTRAINT role_job_tasks_pkey PRIMARY KEY (id);


--
-- Name: role_permission_grants role_permission_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission_grants
    ADD CONSTRAINT role_permission_grants_pkey PRIMARY KEY (id);


--
-- Name: role_permission_grants role_permission_grants_role_id_permission_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission_grants
    ADD CONSTRAINT role_permission_grants_role_id_permission_id_key UNIQUE (role_id, permission_id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_role_id_permission_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_permission_id_key UNIQUE (role_id, permission_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: route_assignments route_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_assignments
    ADD CONSTRAINT route_assignments_pkey PRIMARY KEY (key);


--
-- Name: route_points route_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_points
    ADD CONSTRAINT route_points_pkey PRIMARY KEY (id);


--
-- Name: routes routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_pkey PRIMARY KEY (id);


--
-- Name: scope_tasks scope_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scope_tasks
    ADD CONSTRAINT scope_tasks_pkey PRIMARY KEY (id);


--
-- Name: scope_tasks scope_tasks_scope_id_open_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scope_tasks
    ADD CONSTRAINT scope_tasks_scope_id_open_task_id_key UNIQUE (scope_id, open_task_id);


--
-- Name: service_agreements service_agreements_agreement_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_agreements
    ADD CONSTRAINT service_agreements_agreement_number_key UNIQUE (agreement_number);


--
-- Name: service_agreements service_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_agreements
    ADD CONSTRAINT service_agreements_pkey PRIMARY KEY (id);


--
-- Name: spare_parts spare_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spare_parts
    ADD CONSTRAINT spare_parts_pkey PRIMARY KEY (id);


--
-- Name: system_lists system_lists_category_value_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_lists
    ADD CONSTRAINT system_lists_category_value_unique UNIQUE (category, value);


--
-- Name: system_lists system_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_lists
    ADD CONSTRAINT system_lists_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_key_key UNIQUE (key);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: task_activity_log task_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_activity_log
    ADD CONSTRAINT task_activity_log_pkey PRIMARY KEY (id);


--
-- Name: task_type_config task_type_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_type_config
    ADD CONSTRAINT task_type_config_pkey PRIMARY KEY (task_type);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: telemarketing_appointments telemarketing_appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemarketing_appointments
    ADD CONSTRAINT telemarketing_appointments_pkey PRIMARY KEY (id);


--
-- Name: telemarketing_call_logs telemarketing_call_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemarketing_call_logs
    ADD CONSTRAINT telemarketing_call_logs_pkey PRIMARY KEY (id);


--
-- Name: telemarketing_task_list_items telemarketing_task_list_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemarketing_task_list_items
    ADD CONSTRAINT telemarketing_task_list_items_pkey PRIMARY KEY (id);


--
-- Name: telemarketing_task_lists telemarketing_task_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemarketing_task_lists
    ADD CONSTRAINT telemarketing_task_lists_pkey PRIMARY KEY (id);


--
-- Name: telemarketing_task_lists telemarketing_task_lists_team_key_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemarketing_task_lists
    ADD CONSTRAINT telemarketing_task_lists_team_key_date_key UNIQUE (team_key, date);


--
-- Name: training_attendance training_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_attendance
    ADD CONSTRAINT training_attendance_pkey PRIMARY KEY (id);


--
-- Name: training_attendance training_attendance_training_course_id_application_id_atten_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_attendance
    ADD CONSTRAINT training_attendance_training_course_id_application_id_atten_key UNIQUE (training_course_id, application_id, attendance_date);


--
-- Name: training_course_trainees training_course_trainees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_course_trainees
    ADD CONSTRAINT training_course_trainees_pkey PRIMARY KEY (id);


--
-- Name: training_course_trainees training_course_trainees_training_course_id_application_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_course_trainees
    ADD CONSTRAINT training_course_trainees_training_course_id_application_id_key UNIQUE (training_course_id, application_id);


--
-- Name: training_courses training_courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_courses
    ADD CONSTRAINT training_courses_pkey PRIMARY KEY (id);


--
-- Name: contact_targets uq_contact_targets_per_day_zone; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_targets
    ADD CONSTRAINT uq_contact_targets_per_day_zone UNIQUE (branch_id, target_type, target_id, visit_type, source_type, date, zone_id);


--
-- Name: field_visits uq_field_visits_legacy; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_visits
    ADD CONSTRAINT uq_field_visits_legacy UNIQUE (source_legacy_type, source_legacy_id);


--
-- Name: open_task_delivery_results uq_open_task_delivery_result; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_delivery_results
    ADD CONSTRAINT uq_open_task_delivery_result UNIQUE (open_task_id);


--
-- Name: open_task_installation_results uq_open_task_installation_result; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_installation_results
    ADD CONSTRAINT uq_open_task_installation_result UNIQUE (open_task_id);


--
-- Name: visit_task_results uq_visit_task_results_task; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_results
    ADD CONSTRAINT uq_visit_task_results_task UNIQUE (visit_task_id);


--
-- Name: visit_tasks uq_visit_tasks_legacy; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_tasks
    ADD CONSTRAINT uq_visit_tasks_legacy UNIQUE (source_legacy_type, source_legacy_id);


--
-- Name: visit_task_device_activation_results uq_vtdar_result; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_activation_results
    ADD CONSTRAINT uq_vtdar_result UNIQUE (visit_task_result_id);


--
-- Name: visit_task_device_demo_results uq_vtddr_result; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_demo_results
    ADD CONSTRAINT uq_vtddr_result UNIQUE (visit_task_result_id);


--
-- Name: visit_task_device_delivery_results uq_vtdelivery_result; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_delivery_results
    ADD CONSTRAINT uq_vtdelivery_result UNIQUE (visit_task_result_id);


--
-- Name: visit_task_device_installation_results uq_vtdir_result; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_installation_results
    ADD CONSTRAINT uq_vtdir_result UNIQUE (visit_task_result_id);


--
-- Name: visit_task_emergency_financials uq_vtef_result; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_emergency_financials
    ADD CONSTRAINT uq_vtef_result UNIQUE (visit_task_result_id);


--
-- Name: visit_task_emergency_technical_states uq_vtets_result; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_emergency_technical_states
    ADD CONSTRAINT uq_vtets_result UNIQUE (visit_task_result_id);


--
-- Name: user_branch_assignments user_branch_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branch_assignments
    ADD CONSTRAINT user_branch_assignments_pkey PRIMARY KEY (id);


--
-- Name: user_branch_assignments user_branch_assignments_user_id_branch_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branch_assignments
    ADD CONSTRAINT user_branch_assignments_user_id_branch_id_key UNIQUE (user_id, branch_id);


--
-- Name: visit_escalation_alerts visit_escalation_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_escalation_alerts
    ADD CONSTRAINT visit_escalation_alerts_pkey PRIMARY KEY (id);


--
-- Name: visit_escalation_alerts visit_escalation_alerts_visit_id_tier_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_escalation_alerts
    ADD CONSTRAINT visit_escalation_alerts_visit_id_tier_key UNIQUE (visit_id, tier);


--
-- Name: visit_geo_logs visit_geo_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_geo_logs
    ADD CONSTRAINT visit_geo_logs_pkey PRIMARY KEY (id);


--
-- Name: visit_geo_logs visit_geo_logs_visit_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_geo_logs
    ADD CONSTRAINT visit_geo_logs_visit_id_key UNIQUE (visit_id);


--
-- Name: visit_sources visit_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_sources
    ADD CONSTRAINT visit_sources_pkey PRIMARY KEY (id);


--
-- Name: visit_sources visit_sources_visit_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_sources
    ADD CONSTRAINT visit_sources_visit_id_key UNIQUE (visit_id);


--
-- Name: visit_surveys visit_surveys_field_visit_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_surveys
    ADD CONSTRAINT visit_surveys_field_visit_id_key UNIQUE (field_visit_id);


--
-- Name: visit_surveys visit_surveys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_surveys
    ADD CONSTRAINT visit_surveys_pkey PRIMARY KEY (id);


--
-- Name: visit_task_device_activation_results visit_task_device_activation_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_activation_results
    ADD CONSTRAINT visit_task_device_activation_results_pkey PRIMARY KEY (id);


--
-- Name: visit_task_device_delivery_results visit_task_device_delivery_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_delivery_results
    ADD CONSTRAINT visit_task_device_delivery_results_pkey PRIMARY KEY (id);


--
-- Name: visit_task_device_demo_results visit_task_device_demo_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_demo_results
    ADD CONSTRAINT visit_task_device_demo_results_pkey PRIMARY KEY (id);


--
-- Name: visit_task_device_installation_results visit_task_device_installation_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_installation_results
    ADD CONSTRAINT visit_task_device_installation_results_pkey PRIMARY KEY (id);


--
-- Name: visit_task_emergency_financials visit_task_emergency_financials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_emergency_financials
    ADD CONSTRAINT visit_task_emergency_financials_pkey PRIMARY KEY (id);


--
-- Name: visit_task_emergency_parts_used visit_task_emergency_parts_used_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_emergency_parts_used
    ADD CONSTRAINT visit_task_emergency_parts_used_pkey PRIMARY KEY (id);


--
-- Name: visit_task_emergency_technical_states visit_task_emergency_technical_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_emergency_technical_states
    ADD CONSTRAINT visit_task_emergency_technical_states_pkey PRIMARY KEY (id);


--
-- Name: visit_task_results visit_task_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_results
    ADD CONSTRAINT visit_task_results_pkey PRIMARY KEY (id);


--
-- Name: visit_tasks visit_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_tasks
    ADD CONSTRAINT visit_tasks_pkey PRIMARY KEY (id);


--
-- Name: visits visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_pkey PRIMARY KEY (id);


--
-- Name: work_scopes work_scopes_date_team_key_branch_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_scopes
    ADD CONSTRAINT work_scopes_date_team_key_branch_id_key UNIQUE (date, team_key, branch_id);


--
-- Name: work_scopes work_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_scopes
    ADD CONSTRAINT work_scopes_pkey PRIMARY KEY (id);


--
-- Name: geo_units_name_level_parent_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX geo_units_name_level_parent_unique ON public.geo_units USING btree (lower((name)::text), level, COALESCE(parent_id, 0));


--
-- Name: idx_audit_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_client ON public.client_audit_log USING btree (client_id);


--
-- Name: idx_audit_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_time ON public.client_audit_log USING btree (changed_at);


--
-- Name: idx_call_task_links_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_task_links_task ON public.call_task_links USING btree (task_id);


--
-- Name: idx_candidate_assignments_candidate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidate_assignments_candidate ON public.candidate_assignments USING btree (candidate_id);


--
-- Name: idx_candidate_assignments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidate_assignments_user ON public.candidate_assignments USING btree (hr_user_id);


--
-- Name: idx_candidates_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidates_branch ON public.candidates USING btree (branch_id);


--
-- Name: idx_cdpo_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cdpo_branch ON public.customer_device_pre_offers USING btree (branch_id);


--
-- Name: idx_cdpo_customer_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cdpo_customer_state ON public.customer_device_pre_offers USING btree (customer_id, response_state, created_at DESC);


--
-- Name: idx_client_assignments_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_assignments_client ON public.client_assignments USING btree (client_id);


--
-- Name: idx_client_assignments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_assignments_user ON public.client_assignments USING btree (hr_user_id);


--
-- Name: idx_clients_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_active ON public.clients USING btree (deleted_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_clients_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_branch ON public.clients USING btree (branch_id);


--
-- Name: idx_clients_cooldown_until; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_cooldown_until ON public.clients USING btree (cooldown_until) WHERE (cooldown_until IS NOT NULL);


--
-- Name: idx_clients_do_not_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_do_not_contact ON public.clients USING btree (do_not_contact) WHERE (do_not_contact = true);


--
-- Name: idx_clients_referrers; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_referrers ON public.clients USING gin (referrers);


--
-- Name: idx_contact_targets_branch_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_targets_branch_status ON public.contact_targets USING btree (branch_id, status);


--
-- Name: idx_contact_targets_closed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_targets_closed_at ON public.contact_targets USING btree (closed_at) WHERE (closed_at IS NOT NULL);


--
-- Name: idx_contact_targets_date_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_targets_date_status ON public.contact_targets USING btree (date, status);


--
-- Name: idx_contact_targets_latest_visit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_targets_latest_visit ON public.contact_targets USING btree (latest_visit_id) WHERE (latest_visit_id IS NOT NULL);


--
-- Name: idx_contact_targets_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_targets_source ON public.contact_targets USING btree (source_type, source_id);


--
-- Name: idx_contact_targets_supervisor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_targets_supervisor ON public.contact_targets USING btree (supervisor_hr_user_id);


--
-- Name: idx_contact_targets_work_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_targets_work_location ON public.contact_targets USING btree (work_location_geo_unit_id) WHERE (work_location_geo_unit_id IS NOT NULL);


--
-- Name: idx_contact_targets_zone_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_targets_zone_date ON public.contact_targets USING btree (zone_id, date);


--
-- Name: idx_contract_documents_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_documents_contract ON public.contract_documents USING btree (contract_id);


--
-- Name: idx_contract_installments_collection_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_installments_collection_owner ON public.contract_installments USING btree (collection_owner_id) WHERE (collection_owner_id IS NOT NULL);


--
-- Name: idx_contract_installments_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_installments_contract ON public.contract_installments USING btree (contract_id);


--
-- Name: idx_contract_items_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_items_contract ON public.contract_line_items USING btree (contract_id);


--
-- Name: idx_contract_payments_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_payments_contract ON public.contract_payment_entries USING btree (contract_id);


--
-- Name: idx_contract_payments_installment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_payments_installment ON public.contract_payment_entries USING btree (installment_id) WHERE (installment_id IS NOT NULL);


--
-- Name: idx_contracts_applied_discount; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_applied_discount ON public.contracts USING btree (applied_device_discount_id);


--
-- Name: idx_contracts_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_branch ON public.contracts USING btree (branch_id);


--
-- Name: idx_contracts_sale_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_sale_owner ON public.contracts USING btree (sale_owner_id) WHERE (sale_owner_id IS NOT NULL);


--
-- Name: idx_contracts_sale_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_sale_ref ON public.contracts USING btree (sale_reference_number) WHERE (sale_reference_number IS NOT NULL);


--
-- Name: idx_contracts_source_open_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_source_open_task ON public.contracts USING btree (source_open_task_id) WHERE (source_open_task_id IS NOT NULL);


--
-- Name: idx_customer_call_logs_contact_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_call_logs_contact_id ON public.customer_call_logs USING btree (customer_id, contact_id);


--
-- Name: idx_customer_call_logs_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_call_logs_customer ON public.customer_call_logs USING btree (customer_id);


--
-- Name: idx_customer_call_logs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_call_logs_date ON public.customer_call_logs USING btree (call_date);


--
-- Name: idx_customer_call_logs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_call_logs_status ON public.customer_call_logs USING btree (status);


--
-- Name: idx_departments_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_departments_branch ON public.departments USING btree (branch_id);


--
-- Name: idx_departments_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_departments_type ON public.departments USING btree (department_type_id);


--
-- Name: idx_device_discounts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_discounts_active ON public.device_discounts USING btree (is_active, start_date, end_date);


--
-- Name: idx_device_discounts_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_discounts_model ON public.device_discounts USING btree (device_model_id);


--
-- Name: idx_device_discounts_unique_label; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_device_discounts_unique_label ON public.device_discounts USING btree (device_model_id, label);


--
-- Name: idx_device_installed_parts_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_installed_parts_device ON public.device_installed_parts USING btree (device_id);


--
-- Name: idx_device_installed_parts_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_installed_parts_task ON public.device_installed_parts USING btree (open_task_id);


--
-- Name: idx_device_models_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_device_models_code_unique ON public.device_models USING btree (code) WHERE (code IS NOT NULL);


--
-- Name: idx_device_possession_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_possession_device ON public.device_possession_log USING btree (device_id);


--
-- Name: idx_device_possession_holder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_possession_holder ON public.device_possession_log USING btree (holder_type, holder_id);


--
-- Name: idx_device_warranties_activated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_warranties_activated_at ON public.device_warranties USING btree (activated_at) WHERE (activated_at IS NOT NULL);


--
-- Name: idx_device_warranties_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_warranties_device ON public.device_warranties USING btree (device_id);


--
-- Name: idx_device_warranties_end; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_warranties_end ON public.device_warranties USING btree (end_date) WHERE (is_active = true);


--
-- Name: idx_device_warranties_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_warranties_status ON public.device_warranties USING btree (status);


--
-- Name: idx_direct_suggestions_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_direct_suggestions_client ON public.direct_suggestions USING btree (client_id);


--
-- Name: idx_direct_suggestions_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_direct_suggestions_task ON public.direct_suggestions USING btree (visit_task_id);


--
-- Name: idx_dts_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dts_contract ON public.device_technical_states USING btree (contract_id);


--
-- Name: idx_dts_phase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dts_phase ON public.device_technical_states USING btree (phase);


--
-- Name: idx_dts_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dts_task ON public.device_technical_states USING btree (open_task_id);


--
-- Name: idx_employees_birth_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_birth_date ON public.employees USING btree (birth_date);


--
-- Name: idx_employees_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_branch ON public.employees USING btree (branch_id);


--
-- Name: idx_employees_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_department ON public.employees USING btree (department_id);


--
-- Name: idx_employees_direct_manager; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_direct_manager ON public.employees USING btree (direct_manager_id);


--
-- Name: idx_employees_employee_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_employees_employee_number ON public.employees USING btree (employee_number) WHERE (employee_number IS NOT NULL);


--
-- Name: idx_employees_residence_governorate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_residence_governorate ON public.employees USING btree (residence_governorate_id);


--
-- Name: idx_employees_residence_neighborhood; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_residence_neighborhood ON public.employees USING btree (residence_neighborhood_id);


--
-- Name: idx_employees_residence_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_residence_region ON public.employees USING btree (residence_region_id);


--
-- Name: idx_employees_residence_sub_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_residence_sub_area ON public.employees USING btree (residence_sub_area_id);


--
-- Name: idx_erp_placement_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_erp_placement_state ON public.emergency_result_parts USING btree (placement_state);


--
-- Name: idx_erp_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_erp_task ON public.emergency_result_parts USING btree (open_task_id);


--
-- Name: idx_field_visits_booked_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_visits_booked_by ON public.field_visits USING btree (booked_by_telemarketer_id);


--
-- Name: idx_field_visits_branch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_visits_branch_date ON public.field_visits USING btree (branch_id, scheduled_date);


--
-- Name: idx_field_visits_cancel_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_visits_cancel_reason ON public.field_visits USING btree (cancellation_reason_id);


--
-- Name: idx_field_visits_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_visits_client ON public.field_visits USING btree (client_id);


--
-- Name: idx_field_visits_legacy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_visits_legacy ON public.field_visits USING btree (source_legacy_type, source_legacy_id);


--
-- Name: idx_field_visits_origin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_visits_origin ON public.field_visits USING btree (origin_type, origin_id) WHERE (origin_type IS NOT NULL);


--
-- Name: idx_field_visits_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_visits_status ON public.field_visits USING btree (status);


--
-- Name: idx_field_visits_team_responsible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_visits_team_responsible ON public.field_visits USING btree (team_responsible_user_id) WHERE (team_responsible_user_id IS NOT NULL);


--
-- Name: idx_hr_users_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hr_users_branch ON public.hr_users USING btree (branch_id);


--
-- Name: idx_installed_devices_activated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_installed_devices_activated_at ON public.installed_devices USING btree (activated_at) WHERE (activated_at IS NOT NULL);


--
-- Name: idx_installed_devices_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_installed_devices_branch ON public.installed_devices USING btree (branch_id);


--
-- Name: idx_installed_devices_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_installed_devices_customer ON public.installed_devices USING btree (customer_id);


--
-- Name: idx_installed_devices_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_installed_devices_model ON public.installed_devices USING btree (device_model_id);


--
-- Name: idx_installed_devices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_installed_devices_status ON public.installed_devices USING btree (status);


--
-- Name: idx_interviews_interviewer_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interviews_interviewer_user_id ON public.interviews USING btree (interviewer_user_id);


--
-- Name: idx_job_applications_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_applications_branch ON public.job_applications USING btree (branch_id);


--
-- Name: idx_job_vacancies_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_vacancies_branch ON public.job_vacancies USING btree (branch_id);


--
-- Name: idx_job_vacancies_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_vacancies_department ON public.job_vacancies USING btree (department_id);


--
-- Name: idx_open_task_devices_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_open_task_devices_task ON public.open_task_devices USING btree (task_id);


--
-- Name: idx_open_tasks_assigned_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_open_tasks_assigned_by ON public.open_tasks USING btree (assigned_by) WHERE (assigned_by IS NOT NULL);


--
-- Name: idx_open_tasks_branch_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_open_tasks_branch_status ON public.open_tasks USING btree (branch_id, status);


--
-- Name: idx_open_tasks_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_open_tasks_client ON public.open_tasks USING btree (client_id);


--
-- Name: idx_open_tasks_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_open_tasks_contract ON public.open_tasks USING btree (contract_id);


--
-- Name: idx_open_tasks_creation_origin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_open_tasks_creation_origin ON public.open_tasks USING btree (creation_origin);


--
-- Name: idx_open_tasks_device_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_open_tasks_device_id ON public.open_tasks USING btree (device_id);


--
-- Name: idx_open_tasks_expected_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_open_tasks_expected_date ON public.open_tasks USING btree (expected_date);


--
-- Name: idx_open_tasks_installment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_open_tasks_installment ON public.open_tasks USING btree (installment_id) WHERE (installment_id IS NOT NULL);


--
-- Name: idx_open_tasks_last_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_open_tasks_last_attempt ON public.open_tasks USING btree (last_attempt_at);


--
-- Name: idx_open_tasks_type_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_open_tasks_type_status ON public.open_tasks USING btree (task_type, status);


--
-- Name: idx_open_tasks_unique_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_open_tasks_unique_active ON public.open_tasks USING btree (client_id, task_type) WHERE (((status)::text = ANY ((ARRAY['open'::character varying, 'needs_follow_up'::character varying])::text[])) AND ((task_type)::text <> 'emergency_maintenance'::text));


--
-- Name: idx_open_tasks_waiting_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_open_tasks_waiting_reason ON public.open_tasks USING btree (waiting_reason_id) WHERE (waiting_reason_id IS NOT NULL);


--
-- Name: idx_otpo_source_customer_pre_offer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otpo_source_customer_pre_offer ON public.open_task_pre_offers USING btree (source_customer_pre_offer_id);


--
-- Name: idx_otpo_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otpo_task ON public.open_task_pre_offers USING btree (open_task_id);


--
-- Name: idx_referral_sheets_assigned_hr_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referral_sheets_assigned_hr_user_id ON public.referral_sheets USING btree (assigned_hr_user_id);


--
-- Name: idx_referral_sheets_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referral_sheets_branch ON public.referral_sheets USING btree (branch_id);


--
-- Name: idx_referral_sheets_field_visit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referral_sheets_field_visit ON public.referral_sheets USING btree (field_visit_id);


--
-- Name: idx_role_job_tasks_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_job_tasks_role_id ON public.role_job_tasks USING btree (role_id, display_order, id);


--
-- Name: idx_role_permission_grants_permission_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_permission_grants_permission_id ON public.role_permission_grants USING btree (permission_id);


--
-- Name: idx_role_permission_grants_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_permission_grants_role_id ON public.role_permission_grants USING btree (role_id);


--
-- Name: idx_roles_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_branch ON public.roles USING btree (branch_id);


--
-- Name: idx_scope_tasks_open_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scope_tasks_open_task ON public.scope_tasks USING btree (open_task_id);


--
-- Name: idx_scope_tasks_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scope_tasks_scope ON public.scope_tasks USING btree (scope_id);


--
-- Name: idx_scope_tasks_team_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scope_tasks_team_key ON public.scope_tasks USING btree (team_key, branch_id);


--
-- Name: idx_service_agreements_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_agreements_branch ON public.service_agreements USING btree (branch_id);


--
-- Name: idx_service_agreements_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_agreements_customer ON public.service_agreements USING btree (customer_id);


--
-- Name: idx_service_agreements_legacy_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_agreements_legacy_contract ON public.service_agreements USING btree (legacy_contract_id) WHERE (legacy_contract_id IS NOT NULL);


--
-- Name: idx_service_agreements_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_agreements_status ON public.service_agreements USING btree (status);


--
-- Name: idx_system_lists_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_lists_category ON public.system_lists USING btree (category);


--
-- Name: idx_system_settings_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_settings_category ON public.system_settings USING btree (category);


--
-- Name: idx_task_activity_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_activity_log_created ON public.task_activity_log USING btree (created_at);


--
-- Name: idx_task_activity_log_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_activity_log_task ON public.task_activity_log USING btree (task_id);


--
-- Name: idx_tasks_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_branch ON public.tasks USING btree (branch_id);


--
-- Name: idx_telemarketing_appointments_contact_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemarketing_appointments_contact_target ON public.telemarketing_appointments USING btree (contact_target_id);


--
-- Name: idx_telemarketing_call_logs_contact_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemarketing_call_logs_contact_target ON public.telemarketing_call_logs USING btree (contact_target_id);


--
-- Name: idx_telemarketing_task_list_items_contact_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemarketing_task_list_items_contact_target ON public.telemarketing_task_list_items USING btree (contact_target_id);


--
-- Name: idx_tm_appointments_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tm_appointments_branch ON public.telemarketing_appointments USING btree (branch_id);


--
-- Name: idx_tm_call_logs_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tm_call_logs_branch ON public.telemarketing_call_logs USING btree (branch_id);


--
-- Name: idx_tm_task_lists_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tm_task_lists_branch ON public.telemarketing_task_lists USING btree (branch_id);


--
-- Name: idx_training_courses_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_courses_branch ON public.training_courses USING btree (branch_id);


--
-- Name: idx_user_branch_assignments_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_branch_assignments_branch_id ON public.user_branch_assignments USING btree (branch_id);


--
-- Name: idx_user_branch_assignments_one_primary_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_user_branch_assignments_one_primary_per_user ON public.user_branch_assignments USING btree (user_id) WHERE (is_primary = true);


--
-- Name: idx_user_branch_assignments_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_branch_assignments_user_id ON public.user_branch_assignments USING btree (user_id);


--
-- Name: idx_visit_escalation_alerts_visit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visit_escalation_alerts_visit ON public.visit_escalation_alerts USING btree (visit_id);


--
-- Name: idx_visit_geo_logs_location_missing_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visit_geo_logs_location_missing_reason ON public.visit_geo_logs USING btree (location_missing_reason) WHERE (location_missing_reason IS NOT NULL);


--
-- Name: idx_visit_geo_logs_visit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visit_geo_logs_visit ON public.visit_geo_logs USING btree (visit_id);


--
-- Name: idx_visit_sources_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visit_sources_type ON public.visit_sources USING btree (source_type);


--
-- Name: idx_visit_sources_visit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visit_sources_visit ON public.visit_sources USING btree (visit_id);


--
-- Name: idx_visit_surveys_field_visit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visit_surveys_field_visit ON public.visit_surveys USING btree (field_visit_id);


--
-- Name: idx_visit_surveys_filled_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visit_surveys_filled_by ON public.visit_surveys USING btree (filled_by_user_id) WHERE (filled_by_user_id IS NOT NULL);


--
-- Name: idx_visit_task_results_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visit_task_results_task ON public.visit_task_results USING btree (visit_task_id);


--
-- Name: idx_visit_tasks_contract_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visit_tasks_contract_id ON public.visit_tasks USING btree (contract_id);


--
-- Name: idx_visit_tasks_field_visit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visit_tasks_field_visit ON public.visit_tasks USING btree (field_visit_id);


--
-- Name: idx_visit_tasks_open_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visit_tasks_open_task ON public.visit_tasks USING btree (source_open_task_id);


--
-- Name: idx_visit_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visit_tasks_status ON public.visit_tasks USING btree (status);


--
-- Name: idx_vtepu_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vtepu_result ON public.visit_task_emergency_parts_used USING btree (visit_task_result_id);


--
-- Name: idx_vtets_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vtets_result ON public.visit_task_emergency_technical_states USING btree (visit_task_result_id);


--
-- Name: idx_work_scopes_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_scopes_date ON public.work_scopes USING btree (date);


--
-- Name: idx_work_scopes_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_scopes_team ON public.work_scopes USING btree (team_key, branch_id);


--
-- Name: open_tasks_assigned_daily_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX open_tasks_assigned_daily_idx ON public.open_tasks USING btree (assigned_team_key, assigned_for_date, status) WHERE ((status)::text = 'assigned'::text);


--
-- Name: open_tasks_excluded_for_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX open_tasks_excluded_for_date_idx ON public.open_tasks USING btree (excluded_for_date) WHERE (excluded_for_date IS NOT NULL);


--
-- Name: roles_name_branch_uk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX roles_name_branch_uk ON public.roles USING btree (name, COALESCE(branch_id, 0));


--
-- Name: task_type_config_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_type_config_active_idx ON public.task_type_config USING btree (is_active, display_order);


--
-- Name: uidx_contract_documents_original_per_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uidx_contract_documents_original_per_contract ON public.contract_documents USING btree (contract_id) WHERE (is_amendment = false);


--
-- Name: uidx_device_possession_open_per_device; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uidx_device_possession_open_per_device ON public.device_possession_log USING btree (device_id) WHERE (end_at IS NULL);


--
-- Name: uidx_installed_devices_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uidx_installed_devices_contract ON public.installed_devices USING btree (contract_id);


--
-- Name: uq_referral_sheets_field_visit; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_referral_sheets_field_visit ON public.referral_sheets USING btree (field_visit_id) WHERE (field_visit_id IS NOT NULL);


--
-- Name: ux_employees_employee_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_employees_employee_number ON public.employees USING btree (employee_number) WHERE (employee_number IS NOT NULL);


--
-- Name: ux_hr_users_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_hr_users_employee_id ON public.hr_users USING btree (employee_id) WHERE (employee_id IS NOT NULL);


--
-- Name: open_tasks open_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER open_tasks_updated_at BEFORE UPDATE ON public.open_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: contracts trg_auto_create_installed_device; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auto_create_installed_device AFTER INSERT ON public.contracts FOR EACH ROW WHEN ((((new.contract_type)::text = 'sale_contract'::text) AND ((new.status)::text = 'active'::text))) EXECUTE FUNCTION public.auto_create_installed_device();


--
-- Name: contract_installments trg_contract_installments_completion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contract_installments_completion AFTER UPDATE OF status ON public.contract_installments FOR EACH ROW EXECUTE FUNCTION public.trg_installment_status_check_completion();


--
-- Name: contract_payment_entries trg_contract_payment_entries_recompute; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contract_payment_entries_recompute AFTER INSERT OR DELETE OR UPDATE ON public.contract_payment_entries FOR EACH ROW EXECUTE FUNCTION public.trg_payment_entry_recompute();


--
-- Name: contracts trg_contracts_replay_recompute_on_activation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contracts_replay_recompute_on_activation AFTER UPDATE OF status ON public.contracts FOR EACH ROW WHEN ((((new.status)::text = 'active'::text) AND ((old.status)::text IS DISTINCT FROM 'active'::text))) EXECUTE FUNCTION public.replay_recompute_on_activation();


--
-- Name: contracts trg_contracts_warranty_on_cancel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contracts_warranty_on_cancel AFTER UPDATE OF status ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.trg_warranty_on_contract_cancel();


--
-- Name: device_warranties trg_device_warranties_sync_is_active; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_device_warranties_sync_is_active BEFORE INSERT OR UPDATE OF status ON public.device_warranties FOR EACH ROW EXECUTE FUNCTION public.sync_device_warranty_is_active();


--
-- Name: device_warranties trg_device_warranties_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_device_warranties_updated_at BEFORE UPDATE ON public.device_warranties FOR EACH ROW EXECUTE FUNCTION public.set_device_warranties_updated_at();


--
-- Name: installed_devices trg_installed_devices_activation_snapshot; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_installed_devices_activation_snapshot BEFORE UPDATE OF status ON public.installed_devices FOR EACH ROW EXECUTE FUNCTION public.trg_installed_device_activation_snapshot();


--
-- Name: installed_devices trg_installed_devices_cascade_warranty; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_installed_devices_cascade_warranty AFTER UPDATE OF activated_at, status ON public.installed_devices FOR EACH ROW EXECUTE FUNCTION public.trg_cascade_warranty_activation();


--
-- Name: installed_devices trg_installed_devices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_installed_devices_updated_at BEFORE UPDATE ON public.installed_devices FOR EACH ROW EXECUTE FUNCTION public.set_installed_devices_updated_at();


--
-- Name: installed_devices trg_installed_devices_warranty_retrieval; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_installed_devices_warranty_retrieval AFTER UPDATE OF status ON public.installed_devices FOR EACH ROW EXECUTE FUNCTION public.trg_warranty_on_device_retrieval();


--
-- Name: contracts trg_materialize_device_on_activation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_materialize_device_on_activation AFTER UPDATE OF status ON public.contracts FOR EACH ROW WHEN ((((new.contract_type)::text = 'sale_contract'::text) AND ((new.status)::text = 'active'::text) AND ((old.status)::text IS DISTINCT FROM 'active'::text))) EXECUTE FUNCTION public.materialize_device_on_activation();


--
-- Name: service_agreements trg_service_agreements_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_service_agreements_updated_at BEFORE UPDATE ON public.service_agreements FOR EACH ROW EXECUTE FUNCTION public.set_service_agreements_updated_at();


--
-- Name: contracts trg_set_contract_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_contract_number BEFORE INSERT ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.fn_set_contract_number();


--
-- Name: branch_geo_coverage branch_geo_coverage_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_geo_coverage
    ADD CONSTRAINT branch_geo_coverage_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: branch_geo_coverage branch_geo_coverage_geo_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_geo_coverage
    ADD CONSTRAINT branch_geo_coverage_geo_unit_id_fkey FOREIGN KEY (geo_unit_id) REFERENCES public.geo_units(id) ON DELETE CASCADE;


--
-- Name: branches branches_location_geo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_location_geo_id_fkey FOREIGN KEY (location_geo_id) REFERENCES public.geo_units(id);


--
-- Name: call_task_links call_task_links_call_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_task_links
    ADD CONSTRAINT call_task_links_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.customer_call_logs(id) ON DELETE CASCADE;


--
-- Name: call_task_links call_task_links_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_task_links
    ADD CONSTRAINT call_task_links_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.open_tasks(id) ON DELETE CASCADE;


--
-- Name: candidate_assignments candidate_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_assignments
    ADD CONSTRAINT candidate_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: candidate_assignments candidate_assignments_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_assignments
    ADD CONSTRAINT candidate_assignments_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE;


--
-- Name: candidate_assignments candidate_assignments_hr_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_assignments
    ADD CONSTRAINT candidate_assignments_hr_user_id_fkey FOREIGN KEY (hr_user_id) REFERENCES public.hr_users(id) ON DELETE CASCADE;


--
-- Name: candidates candidates_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: candidates candidates_referral_sheet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_referral_sheet_id_fkey FOREIGN KEY (referral_sheet_id) REFERENCES public.referral_sheets(id) ON DELETE SET NULL;


--
-- Name: client_assignments client_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_assignments
    ADD CONSTRAINT client_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: client_assignments client_assignments_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_assignments
    ADD CONSTRAINT client_assignments_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_assignments client_assignments_hr_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_assignments
    ADD CONSTRAINT client_assignments_hr_user_id_fkey FOREIGN KEY (hr_user_id) REFERENCES public.hr_users(id) ON DELETE CASCADE;


--
-- Name: client_audit_log client_audit_log_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_audit_log
    ADD CONSTRAINT client_audit_log_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: clients clients_assigned_hr_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_assigned_hr_user_id_fkey FOREIGN KEY (assigned_hr_user_id) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: clients clients_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: clients clients_cooldown_set_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_cooldown_set_by_fkey FOREIGN KEY (cooldown_set_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: clients clients_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: clients clients_district_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_district_fkey FOREIGN KEY (district) REFERENCES public.geo_units(id) ON DELETE SET NULL;


--
-- Name: clients clients_governorate_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_governorate_fkey FOREIGN KEY (governorate) REFERENCES public.geo_units(id) ON DELETE SET NULL;


--
-- Name: clients clients_neighborhood_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_neighborhood_fkey FOREIGN KEY (neighborhood) REFERENCES public.geo_units(id) ON DELETE SET NULL;


--
-- Name: contact_targets contact_targets_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_targets
    ADD CONSTRAINT contact_targets_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: contact_targets contact_targets_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_targets
    ADD CONSTRAINT contact_targets_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: contact_targets contact_targets_supervisor_hr_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_targets
    ADD CONSTRAINT contact_targets_supervisor_hr_user_id_fkey FOREIGN KEY (supervisor_hr_user_id) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: contact_targets contact_targets_work_location_geo_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_targets
    ADD CONSTRAINT contact_targets_work_location_geo_unit_id_fkey FOREIGN KEY (work_location_geo_unit_id) REFERENCES public.geo_units(id) ON DELETE SET NULL;


--
-- Name: contract_documents contract_documents_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_documents
    ADD CONSTRAINT contract_documents_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_documents contract_documents_frozen_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_documents
    ADD CONSTRAINT contract_documents_frozen_by_fkey FOREIGN KEY (frozen_by) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: contract_installments contract_installments_collection_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_installments
    ADD CONSTRAINT contract_installments_collection_owner_id_fkey FOREIGN KEY (collection_owner_id) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: contract_installments contract_installments_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_installments
    ADD CONSTRAINT contract_installments_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_line_items contract_line_items_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_line_items
    ADD CONSTRAINT contract_line_items_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_line_items contract_line_items_spare_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_line_items
    ADD CONSTRAINT contract_line_items_spare_part_id_fkey FOREIGN KEY (spare_part_id) REFERENCES public.spare_parts(id) ON DELETE SET NULL;


--
-- Name: contract_payment_entries contract_payment_entries_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_payment_entries
    ADD CONSTRAINT contract_payment_entries_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_payment_entries contract_payment_entries_installment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_payment_entries
    ADD CONSTRAINT contract_payment_entries_installment_id_fkey FOREIGN KEY (installment_id) REFERENCES public.contract_installments(id) ON DELETE SET NULL;


--
-- Name: contract_payment_entries contract_payment_entries_received_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_payment_entries
    ADD CONSTRAINT contract_payment_entries_received_by_employee_id_fkey FOREIGN KEY (received_by_employee_id) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_applied_device_discount_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_applied_device_discount_id_fkey FOREIGN KEY (applied_device_discount_id) REFERENCES public.device_discounts(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: contracts contracts_closing_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_closing_employee_id_fkey FOREIGN KEY (closing_employee_id) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_device_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_device_model_id_fkey FOREIGN KEY (device_model_id) REFERENCES public.device_models(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_discount_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_discount_id_fkey FOREIGN KEY (discount_id) REFERENCES public.device_discounts(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_installed_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_installed_device_id_fkey FOREIGN KEY (installed_device_id) REFERENCES public.installed_devices(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_no_closing_reason_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_no_closing_reason_id_fkey FOREIGN KEY (no_closing_reason_id) REFERENCES public.system_lists(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_sale_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_sale_owner_id_fkey FOREIGN KEY (sale_owner_id) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_source_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_source_open_task_id_fkey FOREIGN KEY (source_open_task_id) REFERENCES public.open_tasks(id) ON DELETE SET NULL;


--
-- Name: customer_call_logs customer_call_logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_call_logs
    ADD CONSTRAINT customer_call_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: customer_call_logs customer_call_logs_caller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_call_logs
    ADD CONSTRAINT customer_call_logs_caller_id_fkey FOREIGN KEY (caller_id) REFERENCES public.hr_users(id);


--
-- Name: customer_call_logs customer_call_logs_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_call_logs
    ADD CONSTRAINT customer_call_logs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.clients(id);


--
-- Name: customer_device_pre_offers customer_device_pre_offers_applied_device_discount_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_device_pre_offers
    ADD CONSTRAINT customer_device_pre_offers_applied_device_discount_id_fkey FOREIGN KEY (applied_device_discount_id) REFERENCES public.device_discounts(id) ON DELETE SET NULL;


--
-- Name: customer_device_pre_offers customer_device_pre_offers_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_device_pre_offers
    ADD CONSTRAINT customer_device_pre_offers_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: customer_device_pre_offers customer_device_pre_offers_closed_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_device_pre_offers
    ADD CONSTRAINT customer_device_pre_offers_closed_by_employee_id_fkey FOREIGN KEY (closed_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: customer_device_pre_offers customer_device_pre_offers_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_device_pre_offers
    ADD CONSTRAINT customer_device_pre_offers_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: customer_device_pre_offers customer_device_pre_offers_device_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_device_pre_offers
    ADD CONSTRAINT customer_device_pre_offers_device_model_id_fkey FOREIGN KEY (device_model_id) REFERENCES public.device_models(id) ON DELETE RESTRICT;


--
-- Name: departments departments_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: departments departments_department_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_department_type_id_fkey FOREIGN KEY (department_type_id) REFERENCES public.system_lists(id) ON DELETE SET NULL;


--
-- Name: device_discounts device_discounts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_discounts
    ADD CONSTRAINT device_discounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: device_discounts device_discounts_device_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_discounts
    ADD CONSTRAINT device_discounts_device_model_id_fkey FOREIGN KEY (device_model_id) REFERENCES public.device_models(id) ON DELETE CASCADE;


--
-- Name: device_installed_parts device_installed_parts_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_installed_parts
    ADD CONSTRAINT device_installed_parts_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.installed_devices(id) ON DELETE CASCADE;


--
-- Name: device_installed_parts device_installed_parts_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_installed_parts
    ADD CONSTRAINT device_installed_parts_open_task_id_fkey FOREIGN KEY (open_task_id) REFERENCES public.open_tasks(id) ON DELETE SET NULL;


--
-- Name: device_installed_parts device_installed_parts_spare_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_installed_parts
    ADD CONSTRAINT device_installed_parts_spare_part_id_fkey FOREIGN KEY (spare_part_id) REFERENCES public.spare_parts(id) ON DELETE SET NULL;


--
-- Name: device_possession_log device_possession_log_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_possession_log
    ADD CONSTRAINT device_possession_log_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: device_possession_log device_possession_log_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_possession_log
    ADD CONSTRAINT device_possession_log_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.installed_devices(id) ON DELETE CASCADE;


--
-- Name: device_technical_states device_technical_states_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_technical_states
    ADD CONSTRAINT device_technical_states_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: device_technical_states device_technical_states_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_technical_states
    ADD CONSTRAINT device_technical_states_open_task_id_fkey FOREIGN KEY (open_task_id) REFERENCES public.open_tasks(id) ON DELETE SET NULL;


--
-- Name: device_technical_states device_technical_states_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_technical_states
    ADD CONSTRAINT device_technical_states_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: device_warranties device_warranties_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_warranties
    ADD CONSTRAINT device_warranties_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: device_warranties device_warranties_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_warranties
    ADD CONSTRAINT device_warranties_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.installed_devices(id) ON DELETE CASCADE;


--
-- Name: device_warranties device_warranties_source_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_warranties
    ADD CONSTRAINT device_warranties_source_task_id_fkey FOREIGN KEY (source_task_id) REFERENCES public.open_tasks(id) ON DELETE SET NULL;


--
-- Name: direct_suggestions direct_suggestions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_suggestions
    ADD CONSTRAINT direct_suggestions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: direct_suggestions direct_suggestions_visit_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_suggestions
    ADD CONSTRAINT direct_suggestions_visit_task_id_fkey FOREIGN KEY (visit_task_id) REFERENCES public.visit_tasks(id) ON DELETE CASCADE;


--
-- Name: dues dues_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dues
    ADD CONSTRAINT dues_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: emergency_installments emergency_installments_costs_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_installments
    ADD CONSTRAINT emergency_installments_costs_id_fkey FOREIGN KEY (costs_id) REFERENCES public.emergency_result_costs(id) ON DELETE CASCADE;


--
-- Name: emergency_installments emergency_installments_due_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_installments
    ADD CONSTRAINT emergency_installments_due_id_fkey FOREIGN KEY (due_id) REFERENCES public.dues(id) ON DELETE SET NULL;


--
-- Name: emergency_installments emergency_installments_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_installments
    ADD CONSTRAINT emergency_installments_open_task_id_fkey FOREIGN KEY (open_task_id) REFERENCES public.open_tasks(id) ON DELETE SET NULL;


--
-- Name: emergency_maintenance_actions emergency_maintenance_actions_action_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_maintenance_actions
    ADD CONSTRAINT emergency_maintenance_actions_action_type_id_fkey FOREIGN KEY (action_type_id) REFERENCES public.emergency_action_types(id) ON DELETE SET NULL;


--
-- Name: emergency_maintenance_actions emergency_maintenance_actions_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_maintenance_actions
    ADD CONSTRAINT emergency_maintenance_actions_open_task_id_fkey FOREIGN KEY (open_task_id) REFERENCES public.open_tasks(id) ON DELETE CASCADE;


--
-- Name: emergency_maintenance_actions emergency_maintenance_actions_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_maintenance_actions
    ADD CONSTRAINT emergency_maintenance_actions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: emergency_payment_entries emergency_payment_entries_costs_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_payment_entries
    ADD CONSTRAINT emergency_payment_entries_costs_id_fkey FOREIGN KEY (costs_id) REFERENCES public.emergency_result_costs(id) ON DELETE CASCADE;


--
-- Name: emergency_payment_entries emergency_payment_entries_transfer_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_payment_entries
    ADD CONSTRAINT emergency_payment_entries_transfer_company_id_fkey FOREIGN KEY (transfer_company_id) REFERENCES public.system_lists(id) ON DELETE SET NULL;


--
-- Name: emergency_result_costs emergency_result_costs_decision_reason_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_result_costs
    ADD CONSTRAINT emergency_result_costs_decision_reason_id_fkey FOREIGN KEY (decision_reason_id) REFERENCES public.system_lists(id) ON DELETE SET NULL;


--
-- Name: emergency_result_costs emergency_result_costs_discount_reason_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_result_costs
    ADD CONSTRAINT emergency_result_costs_discount_reason_id_fkey FOREIGN KEY (discount_reason_id) REFERENCES public.system_lists(id) ON DELETE SET NULL;


--
-- Name: emergency_result_costs emergency_result_costs_follow_up_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_result_costs
    ADD CONSTRAINT emergency_result_costs_follow_up_task_id_fkey FOREIGN KEY (follow_up_task_id) REFERENCES public.open_tasks(id) ON DELETE SET NULL;


--
-- Name: emergency_result_costs emergency_result_costs_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_result_costs
    ADD CONSTRAINT emergency_result_costs_open_task_id_fkey FOREIGN KEY (open_task_id) REFERENCES public.open_tasks(id) ON DELETE CASCADE;


--
-- Name: emergency_result_costs emergency_result_costs_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_result_costs
    ADD CONSTRAINT emergency_result_costs_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: emergency_result_costs emergency_result_costs_transfer_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_result_costs
    ADD CONSTRAINT emergency_result_costs_transfer_company_id_fkey FOREIGN KEY (transfer_company_id) REFERENCES public.system_lists(id) ON DELETE SET NULL;


--
-- Name: emergency_result_parts emergency_result_parts_no_retrieval_reason_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_result_parts
    ADD CONSTRAINT emergency_result_parts_no_retrieval_reason_id_fkey FOREIGN KEY (no_retrieval_reason_id) REFERENCES public.system_lists(id) ON DELETE SET NULL;


--
-- Name: emergency_result_parts emergency_result_parts_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_result_parts
    ADD CONSTRAINT emergency_result_parts_open_task_id_fkey FOREIGN KEY (open_task_id) REFERENCES public.open_tasks(id) ON DELETE CASCADE;


--
-- Name: emergency_result_parts emergency_result_parts_spare_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_result_parts
    ADD CONSTRAINT emergency_result_parts_spare_part_id_fkey FOREIGN KEY (spare_part_id) REFERENCES public.spare_parts(id) ON DELETE SET NULL;


--
-- Name: emergency_tickets emergency_tickets_action_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_tickets
    ADD CONSTRAINT emergency_tickets_action_type_id_fkey FOREIGN KEY (action_type_id) REFERENCES public.emergency_action_types(id) ON DELETE SET NULL;


--
-- Name: emergency_tickets emergency_tickets_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_tickets
    ADD CONSTRAINT emergency_tickets_open_task_id_fkey FOREIGN KEY (open_task_id) REFERENCES public.open_tasks(id);


--
-- Name: employees employees_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: employees employees_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;


--
-- Name: employees employees_direct_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_direct_manager_id_fkey FOREIGN KEY (direct_manager_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: employees employees_residence_governorate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_residence_governorate_id_fkey FOREIGN KEY (residence_governorate_id) REFERENCES public.geo_units(id) ON DELETE SET NULL;


--
-- Name: employees employees_residence_neighborhood_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_residence_neighborhood_id_fkey FOREIGN KEY (residence_neighborhood_id) REFERENCES public.geo_units(id) ON DELETE SET NULL;


--
-- Name: employees employees_residence_region_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_residence_region_id_fkey FOREIGN KEY (residence_region_id) REFERENCES public.geo_units(id) ON DELETE SET NULL;


--
-- Name: employees employees_residence_sub_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_residence_sub_area_id_fkey FOREIGN KEY (residence_sub_area_id) REFERENCES public.geo_units(id) ON DELETE SET NULL;


--
-- Name: field_visits field_visits_booked_by_telemarketer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_visits
    ADD CONSTRAINT field_visits_booked_by_telemarketer_id_fkey FOREIGN KEY (booked_by_telemarketer_id) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: field_visits field_visits_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_visits
    ADD CONSTRAINT field_visits_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: field_visits field_visits_cancellation_reason_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_visits
    ADD CONSTRAINT field_visits_cancellation_reason_id_fkey FOREIGN KEY (cancellation_reason_id) REFERENCES public.system_lists(id) ON DELETE SET NULL;


--
-- Name: field_visits field_visits_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_visits
    ADD CONSTRAINT field_visits_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: field_visits field_visits_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_visits
    ADD CONSTRAINT field_visits_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: field_visits field_visits_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_visits
    ADD CONSTRAINT field_visits_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: field_visits field_visits_reassigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_visits
    ADD CONSTRAINT field_visits_reassigned_by_fkey FOREIGN KEY (reassigned_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: field_visits field_visits_reassigned_supervisor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_visits
    ADD CONSTRAINT field_visits_reassigned_supervisor_id_fkey FOREIGN KEY (reassigned_supervisor_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: field_visits field_visits_reassigned_technician_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_visits
    ADD CONSTRAINT field_visits_reassigned_technician_id_fkey FOREIGN KEY (reassigned_technician_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: field_visits field_visits_reassigned_trainee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_visits
    ADD CONSTRAINT field_visits_reassigned_trainee_id_fkey FOREIGN KEY (reassigned_trainee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: field_visits field_visits_team_responsible_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_visits
    ADD CONSTRAINT field_visits_team_responsible_user_id_fkey FOREIGN KEY (team_responsible_user_id) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: contact_targets fk_contact_targets_latest_visit; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_targets
    ADD CONSTRAINT fk_contact_targets_latest_visit FOREIGN KEY (latest_visit_id) REFERENCES public.field_visits(id) ON DELETE SET NULL;


--
-- Name: geo_units geo_units_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_units
    ADD CONSTRAINT geo_units_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.geo_units(id) ON DELETE RESTRICT;


--
-- Name: hr_users hr_users_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_users
    ADD CONSTRAINT hr_users_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: hr_users hr_users_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_users
    ADD CONSTRAINT hr_users_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: hr_users hr_users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_users
    ADD CONSTRAINT hr_users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: installed_devices installed_devices_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installed_devices
    ADD CONSTRAINT installed_devices_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: installed_devices installed_devices_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installed_devices
    ADD CONSTRAINT installed_devices_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE RESTRICT;


--
-- Name: installed_devices installed_devices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installed_devices
    ADD CONSTRAINT installed_devices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: installed_devices installed_devices_device_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installed_devices
    ADD CONSTRAINT installed_devices_device_model_id_fkey FOREIGN KEY (device_model_id) REFERENCES public.device_models(id) ON DELETE SET NULL;


--
-- Name: installed_devices installed_devices_installation_geo_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installed_devices
    ADD CONSTRAINT installed_devices_installation_geo_unit_id_fkey FOREIGN KEY (installation_geo_unit_id) REFERENCES public.geo_units(id) ON DELETE SET NULL;


--
-- Name: interviews interviews_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.job_applications(id);


--
-- Name: interviews interviews_interviewer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_interviewer_user_id_fkey FOREIGN KEY (interviewer_user_id) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: job_applications job_applications_applicant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_applications
    ADD CONSTRAINT job_applications_applicant_id_fkey FOREIGN KEY (applicant_id) REFERENCES public.applicants(id);


--
-- Name: job_applications job_applications_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_applications
    ADD CONSTRAINT job_applications_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: job_applications job_applications_hired_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_applications
    ADD CONSTRAINT job_applications_hired_employee_id_fkey FOREIGN KEY (hired_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: job_applications job_applications_job_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_applications
    ADD CONSTRAINT job_applications_job_vacancy_id_fkey FOREIGN KEY (job_vacancy_id) REFERENCES public.job_vacancies(id);


--
-- Name: job_applications job_applications_referrer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_applications
    ADD CONSTRAINT job_applications_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.referrers(id);


--
-- Name: job_vacancies job_vacancies_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_vacancies
    ADD CONSTRAINT job_vacancies_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: job_vacancies job_vacancies_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_vacancies
    ADD CONSTRAINT job_vacancies_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;


--
-- Name: open_task_delivery_results open_task_delivery_results_delivered_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_delivery_results
    ADD CONSTRAINT open_task_delivery_results_delivered_by_employee_id_fkey FOREIGN KEY (delivered_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: open_task_delivery_results open_task_delivery_results_device_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_delivery_results
    ADD CONSTRAINT open_task_delivery_results_device_model_id_fkey FOREIGN KEY (device_model_id) REFERENCES public.device_models(id) ON DELETE SET NULL;


--
-- Name: open_task_delivery_results open_task_delivery_results_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_delivery_results
    ADD CONSTRAINT open_task_delivery_results_open_task_id_fkey FOREIGN KEY (open_task_id) REFERENCES public.open_tasks(id) ON DELETE CASCADE;


--
-- Name: open_task_devices open_task_devices_device_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_devices
    ADD CONSTRAINT open_task_devices_device_model_id_fkey FOREIGN KEY (device_model_id) REFERENCES public.device_models(id) ON DELETE SET NULL;


--
-- Name: open_task_devices open_task_devices_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_devices
    ADD CONSTRAINT open_task_devices_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.open_tasks(id) ON DELETE CASCADE;


--
-- Name: open_task_installation_results open_task_installation_results_installed_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_installation_results
    ADD CONSTRAINT open_task_installation_results_installed_by_employee_id_fkey FOREIGN KEY (installed_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: open_task_installation_results open_task_installation_results_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_installation_results
    ADD CONSTRAINT open_task_installation_results_open_task_id_fkey FOREIGN KEY (open_task_id) REFERENCES public.open_tasks(id) ON DELETE CASCADE;


--
-- Name: open_task_pre_offers open_task_pre_offers_applied_device_discount_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_pre_offers
    ADD CONSTRAINT open_task_pre_offers_applied_device_discount_id_fkey FOREIGN KEY (applied_device_discount_id) REFERENCES public.device_discounts(id) ON DELETE SET NULL;


--
-- Name: open_task_pre_offers open_task_pre_offers_closed_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_pre_offers
    ADD CONSTRAINT open_task_pre_offers_closed_by_employee_id_fkey FOREIGN KEY (closed_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: open_task_pre_offers open_task_pre_offers_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_pre_offers
    ADD CONSTRAINT open_task_pre_offers_open_task_id_fkey FOREIGN KEY (open_task_id) REFERENCES public.open_tasks(id) ON DELETE CASCADE;


--
-- Name: open_task_pre_offers open_task_pre_offers_source_customer_pre_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_task_pre_offers
    ADD CONSTRAINT open_task_pre_offers_source_customer_pre_offer_id_fkey FOREIGN KEY (source_customer_pre_offer_id) REFERENCES public.customer_device_pre_offers(id) ON DELETE SET NULL;


--
-- Name: open_tasks open_tasks_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks
    ADD CONSTRAINT open_tasks_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: open_tasks open_tasks_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks
    ADD CONSTRAINT open_tasks_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: open_tasks open_tasks_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks
    ADD CONSTRAINT open_tasks_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: open_tasks open_tasks_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks
    ADD CONSTRAINT open_tasks_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: open_tasks open_tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks
    ADD CONSTRAINT open_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: open_tasks open_tasks_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks
    ADD CONSTRAINT open_tasks_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.installed_devices(id) ON DELETE SET NULL;


--
-- Name: open_tasks open_tasks_em_action_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks
    ADD CONSTRAINT open_tasks_em_action_id_fkey FOREIGN KEY (em_action_id) REFERENCES public.emergency_maintenance_actions(id) ON DELETE SET NULL;


--
-- Name: open_tasks open_tasks_em_costs_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks
    ADD CONSTRAINT open_tasks_em_costs_id_fkey FOREIGN KEY (em_costs_id) REFERENCES public.emergency_result_costs(id) ON DELETE SET NULL;


--
-- Name: open_tasks open_tasks_em_post_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks
    ADD CONSTRAINT open_tasks_em_post_state_id_fkey FOREIGN KEY (em_post_state_id) REFERENCES public.device_technical_states(id) ON DELETE SET NULL;


--
-- Name: open_tasks open_tasks_em_pre_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks
    ADD CONSTRAINT open_tasks_em_pre_state_id_fkey FOREIGN KEY (em_pre_state_id) REFERENCES public.device_technical_states(id) ON DELETE SET NULL;


--
-- Name: open_tasks open_tasks_installment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks
    ADD CONSTRAINT open_tasks_installment_id_fkey FOREIGN KEY (installment_id) REFERENCES public.contract_installments(id) ON DELETE SET NULL;


--
-- Name: open_tasks open_tasks_task_type_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks
    ADD CONSTRAINT open_tasks_task_type_fk FOREIGN KEY (task_type) REFERENCES public.task_type_config(task_type) ON DELETE RESTRICT;


--
-- Name: open_tasks open_tasks_waiting_reason_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_tasks
    ADD CONSTRAINT open_tasks_waiting_reason_id_fkey FOREIGN KEY (waiting_reason_id) REFERENCES public.system_lists(id) ON DELETE SET NULL;


--
-- Name: referral_sheets referral_sheets_assigned_hr_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_sheets
    ADD CONSTRAINT referral_sheets_assigned_hr_user_id_fkey FOREIGN KEY (assigned_hr_user_id) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: referral_sheets referral_sheets_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_sheets
    ADD CONSTRAINT referral_sheets_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: referral_sheets referral_sheets_field_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_sheets
    ADD CONSTRAINT referral_sheets_field_visit_id_fkey FOREIGN KEY (field_visit_id) REFERENCES public.field_visits(id) ON DELETE SET NULL;


--
-- Name: referrers referrers_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrers
    ADD CONSTRAINT referrers_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: role_job_tasks role_job_tasks_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_job_tasks
    ADD CONSTRAINT role_job_tasks_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: role_permission_grants role_permission_grants_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission_grants
    ADD CONSTRAINT role_permission_grants_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permission_grants role_permission_grants_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission_grants
    ADD CONSTRAINT role_permission_grants_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: roles roles_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: roles roles_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.roles(id) ON DELETE SET NULL;


--
-- Name: route_points route_points_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_points
    ADD CONSTRAINT route_points_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE CASCADE;


--
-- Name: scope_tasks scope_tasks_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scope_tasks
    ADD CONSTRAINT scope_tasks_open_task_id_fkey FOREIGN KEY (open_task_id) REFERENCES public.open_tasks(id) ON DELETE CASCADE;


--
-- Name: service_agreements service_agreements_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_agreements
    ADD CONSTRAINT service_agreements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: service_agreements service_agreements_closing_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_agreements
    ADD CONSTRAINT service_agreements_closing_employee_id_fkey FOREIGN KEY (closing_employee_id) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: service_agreements service_agreements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_agreements
    ADD CONSTRAINT service_agreements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: service_agreements service_agreements_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_agreements
    ADD CONSTRAINT service_agreements_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: service_agreements service_agreements_legacy_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_agreements
    ADD CONSTRAINT service_agreements_legacy_contract_id_fkey FOREIGN KEY (legacy_contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: system_lists system_lists_linked_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_lists
    ADD CONSTRAINT system_lists_linked_role_id_fkey FOREIGN KEY (linked_role_id) REFERENCES public.roles(id) ON DELETE SET NULL;


--
-- Name: system_settings system_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: task_activity_log task_activity_log_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_activity_log
    ADD CONSTRAINT task_activity_log_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: task_activity_log task_activity_log_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_activity_log
    ADD CONSTRAINT task_activity_log_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.open_tasks(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: telemarketing_appointments telemarketing_appointments_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemarketing_appointments
    ADD CONSTRAINT telemarketing_appointments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: telemarketing_appointments telemarketing_appointments_contact_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemarketing_appointments
    ADD CONSTRAINT telemarketing_appointments_contact_target_id_fkey FOREIGN KEY (contact_target_id) REFERENCES public.contact_targets(id) ON DELETE SET NULL;


--
-- Name: telemarketing_appointments telemarketing_appointments_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemarketing_appointments
    ADD CONSTRAINT telemarketing_appointments_open_task_id_fkey FOREIGN KEY (open_task_id) REFERENCES public.open_tasks(id) ON DELETE SET NULL;


--
-- Name: telemarketing_call_logs telemarketing_call_logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemarketing_call_logs
    ADD CONSTRAINT telemarketing_call_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: telemarketing_call_logs telemarketing_call_logs_contact_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemarketing_call_logs
    ADD CONSTRAINT telemarketing_call_logs_contact_target_id_fkey FOREIGN KEY (contact_target_id) REFERENCES public.contact_targets(id) ON DELETE SET NULL;


--
-- Name: telemarketing_task_list_items telemarketing_task_list_items_contact_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemarketing_task_list_items
    ADD CONSTRAINT telemarketing_task_list_items_contact_target_id_fkey FOREIGN KEY (contact_target_id) REFERENCES public.contact_targets(id) ON DELETE SET NULL;


--
-- Name: telemarketing_task_list_items telemarketing_task_list_items_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemarketing_task_list_items
    ADD CONSTRAINT telemarketing_task_list_items_open_task_id_fkey FOREIGN KEY (open_task_id) REFERENCES public.open_tasks(id) ON DELETE SET NULL;


--
-- Name: telemarketing_task_list_items telemarketing_task_list_items_task_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemarketing_task_list_items
    ADD CONSTRAINT telemarketing_task_list_items_task_list_id_fkey FOREIGN KEY (task_list_id) REFERENCES public.telemarketing_task_lists(id) ON DELETE CASCADE;


--
-- Name: telemarketing_task_lists telemarketing_task_lists_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemarketing_task_lists
    ADD CONSTRAINT telemarketing_task_lists_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: training_attendance training_attendance_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_attendance
    ADD CONSTRAINT training_attendance_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.job_applications(id);


--
-- Name: training_attendance training_attendance_training_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_attendance
    ADD CONSTRAINT training_attendance_training_course_id_fkey FOREIGN KEY (training_course_id) REFERENCES public.training_courses(id);


--
-- Name: training_course_trainees training_course_trainees_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_course_trainees
    ADD CONSTRAINT training_course_trainees_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.job_applications(id);


--
-- Name: training_course_trainees training_course_trainees_training_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_course_trainees
    ADD CONSTRAINT training_course_trainees_training_course_id_fkey FOREIGN KEY (training_course_id) REFERENCES public.training_courses(id) ON DELETE CASCADE;


--
-- Name: training_courses training_courses_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_courses
    ADD CONSTRAINT training_courses_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: training_courses training_courses_job_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_courses
    ADD CONSTRAINT training_courses_job_vacancy_id_fkey FOREIGN KEY (job_vacancy_id) REFERENCES public.job_vacancies(id);


--
-- Name: user_branch_assignments user_branch_assignments_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branch_assignments
    ADD CONSTRAINT user_branch_assignments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: user_branch_assignments user_branch_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branch_assignments
    ADD CONSTRAINT user_branch_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.hr_users(id) ON DELETE CASCADE;


--
-- Name: visit_escalation_alerts visit_escalation_alerts_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_escalation_alerts
    ADD CONSTRAINT visit_escalation_alerts_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.field_visits(id) ON DELETE CASCADE;


--
-- Name: visit_geo_logs visit_geo_logs_ended_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_geo_logs
    ADD CONSTRAINT visit_geo_logs_ended_by_fkey FOREIGN KEY (ended_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: visit_geo_logs visit_geo_logs_location_missing_reason_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_geo_logs
    ADD CONSTRAINT visit_geo_logs_location_missing_reason_fkey FOREIGN KEY (location_missing_reason) REFERENCES public.system_lists(id) ON DELETE SET NULL;


--
-- Name: visit_geo_logs visit_geo_logs_started_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_geo_logs
    ADD CONSTRAINT visit_geo_logs_started_by_fkey FOREIGN KEY (started_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: visit_geo_logs visit_geo_logs_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_geo_logs
    ADD CONSTRAINT visit_geo_logs_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.field_visits(id) ON DELETE CASCADE;


--
-- Name: visit_sources visit_sources_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_sources
    ADD CONSTRAINT visit_sources_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.field_visits(id) ON DELETE CASCADE;


--
-- Name: visit_surveys visit_surveys_field_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_surveys
    ADD CONSTRAINT visit_surveys_field_visit_id_fkey FOREIGN KEY (field_visit_id) REFERENCES public.field_visits(id) ON DELETE CASCADE;


--
-- Name: visit_surveys visit_surveys_filled_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_surveys
    ADD CONSTRAINT visit_surveys_filled_by_user_id_fkey FOREIGN KEY (filled_by_user_id) REFERENCES public.hr_users(id);


--
-- Name: visit_task_device_activation_results visit_task_device_activation_resu_activated_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_activation_results
    ADD CONSTRAINT visit_task_device_activation_resu_activated_by_employee_id_fkey FOREIGN KEY (activated_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: visit_task_device_activation_results visit_task_device_activation_results_visit_task_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_activation_results
    ADD CONSTRAINT visit_task_device_activation_results_visit_task_result_id_fkey FOREIGN KEY (visit_task_result_id) REFERENCES public.visit_task_results(id) ON DELETE CASCADE;


--
-- Name: visit_task_device_delivery_results visit_task_device_delivery_result_delivered_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_delivery_results
    ADD CONSTRAINT visit_task_device_delivery_result_delivered_by_employee_id_fkey FOREIGN KEY (delivered_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: visit_task_device_delivery_results visit_task_device_delivery_results_device_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_delivery_results
    ADD CONSTRAINT visit_task_device_delivery_results_device_model_id_fkey FOREIGN KEY (device_model_id) REFERENCES public.device_models(id) ON DELETE SET NULL;


--
-- Name: visit_task_device_delivery_results visit_task_device_delivery_results_visit_task_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_delivery_results
    ADD CONSTRAINT visit_task_device_delivery_results_visit_task_result_id_fkey FOREIGN KEY (visit_task_result_id) REFERENCES public.visit_task_results(id) ON DELETE CASCADE;


--
-- Name: visit_task_device_demo_results visit_task_device_demo_results_closed_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_demo_results
    ADD CONSTRAINT visit_task_device_demo_results_closed_by_employee_id_fkey FOREIGN KEY (closed_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: visit_task_device_demo_results visit_task_device_demo_results_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_demo_results
    ADD CONSTRAINT visit_task_device_demo_results_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: visit_task_device_demo_results visit_task_device_demo_results_offered_device_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_demo_results
    ADD CONSTRAINT visit_task_device_demo_results_offered_device_model_id_fkey FOREIGN KEY (offered_device_model_id) REFERENCES public.device_models(id) ON DELETE SET NULL;


--
-- Name: visit_task_device_demo_results visit_task_device_demo_results_visit_task_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_demo_results
    ADD CONSTRAINT visit_task_device_demo_results_visit_task_result_id_fkey FOREIGN KEY (visit_task_result_id) REFERENCES public.visit_task_results(id) ON DELETE CASCADE;


--
-- Name: visit_task_device_installation_results visit_task_device_installation_re_installed_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_installation_results
    ADD CONSTRAINT visit_task_device_installation_re_installed_by_employee_id_fkey FOREIGN KEY (installed_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: visit_task_device_installation_results visit_task_device_installation_result_visit_task_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_device_installation_results
    ADD CONSTRAINT visit_task_device_installation_result_visit_task_result_id_fkey FOREIGN KEY (visit_task_result_id) REFERENCES public.visit_task_results(id) ON DELETE CASCADE;


--
-- Name: visit_task_emergency_financials visit_task_emergency_financials_visit_task_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_emergency_financials
    ADD CONSTRAINT visit_task_emergency_financials_visit_task_result_id_fkey FOREIGN KEY (visit_task_result_id) REFERENCES public.visit_task_results(id) ON DELETE CASCADE;


--
-- Name: visit_task_emergency_parts_used visit_task_emergency_parts_used_spare_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_emergency_parts_used
    ADD CONSTRAINT visit_task_emergency_parts_used_spare_part_id_fkey FOREIGN KEY (spare_part_id) REFERENCES public.spare_parts(id) ON DELETE SET NULL;


--
-- Name: visit_task_emergency_parts_used visit_task_emergency_parts_used_visit_task_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_emergency_parts_used
    ADD CONSTRAINT visit_task_emergency_parts_used_visit_task_result_id_fkey FOREIGN KEY (visit_task_result_id) REFERENCES public.visit_task_results(id) ON DELETE CASCADE;


--
-- Name: visit_task_emergency_technical_states visit_task_emergency_technical_states_visit_task_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_emergency_technical_states
    ADD CONSTRAINT visit_task_emergency_technical_states_visit_task_result_id_fkey FOREIGN KEY (visit_task_result_id) REFERENCES public.visit_task_results(id) ON DELETE CASCADE;


--
-- Name: visit_task_results visit_task_results_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_results
    ADD CONSTRAINT visit_task_results_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;


--
-- Name: visit_task_results visit_task_results_visit_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_task_results
    ADD CONSTRAINT visit_task_results_visit_task_id_fkey FOREIGN KEY (visit_task_id) REFERENCES public.visit_tasks(id) ON DELETE CASCADE;


--
-- Name: visit_tasks visit_tasks_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_tasks
    ADD CONSTRAINT visit_tasks_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: visit_tasks visit_tasks_field_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_tasks
    ADD CONSTRAINT visit_tasks_field_visit_id_fkey FOREIGN KEY (field_visit_id) REFERENCES public.field_visits(id) ON DELETE CASCADE;


--
-- Name: visit_tasks visit_tasks_source_open_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_tasks
    ADD CONSTRAINT visit_tasks_source_open_task_id_fkey FOREIGN KEY (source_open_task_id) REFERENCES public.open_tasks(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

-- Restore default search path for the migration runner bookkeeping insert.
SET search_path = public;
