CREATE OR REPLACE FUNCTION public.recalculate_client_balance(p_client_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_client_id IS NULL THEN
        RETURN;
    END IF;

    WITH balances AS (
        SELECT
            id,
            SUM(debit_amount - credit_amount) OVER (
                ORDER BY entry_date, id
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS balance
        FROM public.client_ledger_entries
        WHERE client_id = p_client_id
    )
    UPDATE public.client_ledger_entries ledger
    SET running_balance = balances.balance
    FROM balances
    WHERE balances.id = ledger.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_contract_payment_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_client_id INTEGER;
    v_old_client_id INTEGER;
    v_contract_number VARCHAR(100);
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        SELECT customer_id
        INTO v_old_client_id
        FROM public.contracts
        WHERE id = OLD.contract_id;

        DELETE FROM public.client_ledger_entries
        WHERE source_type = 'contract'
          AND source_entry_id = OLD.id
          AND entry_type IN ('contract_payment', 'refund');
    END IF;

    IF TG_OP <> 'DELETE' THEN
        SELECT customer_id, contract_number
        INTO v_client_id, v_contract_number
        FROM public.contracts
        WHERE id = NEW.contract_id;

        IF v_client_id IS NOT NULL THEN
            INSERT INTO public.client_ledger_entries (
                client_id,
                entry_date,
                entry_type,
                source_type,
                source_id,
                source_entry_id,
                description,
                reference_no,
                debit_amount,
                credit_amount,
                recorded_by,
                notes
            )
            VALUES (
                v_client_id,
                NEW.received_at,
                CASE WHEN NEW.entry_type = 'refund' THEN 'refund' ELSE 'contract_payment' END,
                'contract',
                NEW.contract_id,
                NEW.id,
                CASE
                    WHEN NEW.entry_type = 'refund'
                        THEN 'مبلغ مرتجع للعقد ' || COALESCE(v_contract_number, NEW.contract_id::text)
                    ELSE 'دفعة عقد ' || COALESCE(v_contract_number, NEW.contract_id::text)
                END,
                NEW.reference_number,
                CASE WHEN NEW.entry_type = 'refund' THEN NEW.amount_syp ELSE 0 END,
                CASE WHEN NEW.entry_type = 'refund' THEN 0 ELSE NEW.amount_syp END,
                NEW.received_by_employee_id,
                NEW.notes
            );
        END IF;
    END IF;

    PERFORM public.recalculate_client_balance(v_old_client_id);
    IF v_client_id IS DISTINCT FROM v_old_client_id THEN
        PERFORM public.recalculate_client_balance(v_client_id);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_contract_payment_entries_ledger
    ON public.contract_payment_entries;
CREATE TRIGGER trg_contract_payment_entries_ledger
AFTER INSERT OR UPDATE OR DELETE ON public.contract_payment_entries
FOR EACH ROW EXECUTE FUNCTION public.sync_contract_payment_ledger();

CREATE OR REPLACE FUNCTION public.sync_contract_installment_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_client_id INTEGER;
    v_old_client_id INTEGER;
    v_contract_number VARCHAR(100);
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        SELECT customer_id
        INTO v_old_client_id
        FROM public.contracts
        WHERE id = OLD.contract_id;

        DELETE FROM public.client_ledger_entries
        WHERE source_type = 'contract'
          AND source_entry_id = OLD.id
          AND entry_type = 'contract_installment';
    END IF;

    IF TG_OP <> 'DELETE' THEN
        SELECT customer_id, contract_number
        INTO v_client_id, v_contract_number
        FROM public.contracts
        WHERE id = NEW.contract_id;

        IF v_client_id IS NOT NULL THEN
            INSERT INTO public.client_ledger_entries (
                client_id,
                entry_date,
                entry_type,
                source_type,
                source_id,
                source_entry_id,
                description,
                reference_no,
                debit_amount,
                credit_amount
            )
            VALUES (
                v_client_id,
                NEW.due_date::timestamptz,
                'contract_installment',
                'contract',
                NEW.contract_id,
                NEW.id,
                'استحقاق قسط رقم ' || NEW.installment_number ||
                    ' للعقد ' || COALESCE(v_contract_number, NEW.contract_id::text),
                v_contract_number,
                NEW.amount_syp,
                0
            );
        END IF;
    END IF;

    PERFORM public.recalculate_client_balance(v_old_client_id);
    IF v_client_id IS DISTINCT FROM v_old_client_id THEN
        PERFORM public.recalculate_client_balance(v_client_id);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_contract_installments_ledger
    ON public.contract_installments;
CREATE TRIGGER trg_contract_installments_ledger
AFTER INSERT OR UPDATE OR DELETE ON public.contract_installments
FOR EACH ROW EXECUTE FUNCTION public.sync_contract_installment_ledger();

-- Some deployments still expose the legacy financial_transactions table.
-- Use JSON extraction so the trigger tolerates the known legacy column names.
CREATE OR REPLACE FUNCTION public.sync_financial_transaction_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_payload JSONB := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    v_old_payload JSONB := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
    v_transaction_id INTEGER;
    v_old_transaction_id INTEGER;
    v_request_id INTEGER;
    v_client_id INTEGER;
    v_old_client_id INTEGER;
    v_amount NUMERIC;
    v_entry_date TIMESTAMPTZ;
BEGIN
    v_transaction_id := NULLIF(v_payload->>'id', '')::integer;
    v_old_transaction_id := NULLIF(v_old_payload->>'id', '')::integer;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        SELECT client_id INTO v_old_client_id
        FROM public.client_ledger_entries
        WHERE source_type = 'maintenance_request'
          AND source_entry_id = v_old_transaction_id
          AND entry_type = 'maintenance_payment'
        LIMIT 1;

        DELETE FROM public.client_ledger_entries
        WHERE source_type = 'maintenance_request'
          AND source_entry_id = v_old_transaction_id
          AND entry_type = 'maintenance_payment';
    END IF;

    IF TG_OP <> 'DELETE' THEN
        v_request_id := COALESCE(
            NULLIF(v_payload->>'maintenance_request_id', '')::integer,
            NULLIF(v_payload->>'request_id', '')::integer
        );
        v_client_id := NULLIF(v_payload->>'client_id', '')::integer;

        IF v_client_id IS NULL AND v_request_id IS NOT NULL THEN
            SELECT customer_id INTO v_client_id
            FROM public.maintenance_requests
            WHERE id = v_request_id;
        END IF;

        v_amount := COALESCE(
            NULLIF(v_payload->>'amount', '')::numeric,
            NULLIF(v_payload->>'amount_syp', '')::numeric,
            0
        );
        v_entry_date := COALESCE(
            NULLIF(v_payload->>'transaction_date', '')::timestamptz,
            NULLIF(v_payload->>'payment_date', '')::timestamptz,
            NULLIF(v_payload->>'created_at', '')::timestamptz,
            NOW()
        );

        IF v_client_id IS NOT NULL THEN
            INSERT INTO public.client_ledger_entries (
                client_id,
                entry_date,
                entry_type,
                source_type,
                source_id,
                source_entry_id,
                description,
                reference_no,
                credit_amount,
                recorded_by,
                notes
            )
            VALUES (
                v_client_id,
                v_entry_date,
                'maintenance_payment',
                'maintenance_request',
                v_request_id,
                v_transaction_id,
                COALESCE(NULLIF(v_payload->>'description', ''), 'دفعة مهمة صيانة'),
                COALESCE(v_payload->>'reference_no', v_payload->>'reference_number'),
                v_amount,
                COALESCE(
                    NULLIF(v_payload->>'recorded_by', '')::integer,
                    NULLIF(v_payload->>'created_by', '')::integer
                ),
                v_payload->>'notes'
            );
        END IF;
    END IF;

    PERFORM public.recalculate_client_balance(v_old_client_id);
    IF v_client_id IS DISTINCT FROM v_old_client_id THEN
        PERFORM public.recalculate_client_balance(v_client_id);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
    IF to_regclass('public.financial_transactions') IS NOT NULL THEN
        EXECUTE 'DROP TRIGGER IF EXISTS trg_financial_transactions_ledger ON public.financial_transactions';
        EXECUTE 'CREATE TRIGGER trg_financial_transactions_ledger
                 AFTER INSERT OR UPDATE OR DELETE ON public.financial_transactions
                 FOR EACH ROW EXECUTE FUNCTION public.sync_financial_transaction_ledger()';
    END IF;
END;
$$;
