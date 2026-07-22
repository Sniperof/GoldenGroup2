-- DEF-006: protect new membrane readings without rejecting legacy violations.
-- Existing invalid rows must be reviewed before these constraints are validated.
ALTER TABLE public.device_technical_states
  ADD CONSTRAINT device_technical_states_membrane_input_nonnegative_ck
  CHECK (membrane_input_tds IS NULL OR membrane_input_tds >= 0) NOT VALID;

ALTER TABLE public.device_technical_states
  ADD CONSTRAINT device_technical_states_membrane_output_nonnegative_ck
  CHECK (membrane_output_tds IS NULL OR membrane_output_tds >= 0) NOT VALID;

ALTER TABLE public.device_technical_states
  ADD CONSTRAINT device_technical_states_membrane_output_le_input_ck
  CHECK (
    membrane_input_tds IS NULL
    OR membrane_output_tds IS NULL
    OR membrane_output_tds <= membrane_input_tds
  ) NOT VALID;
