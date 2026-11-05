-- Financial corrections keep the original row and record who reversed it and why.
ALTER TABLE receipts ADD COLUMN reversed_at timestamptz, ADD COLUMN reversed_by uuid REFERENCES users(id), ADD COLUMN reversal_reason text;
ALTER TABLE receipts ADD CONSTRAINT receipts_reversal_reason CHECK (reversed_at IS NULL OR reversal_reason IS NOT NULL);
ALTER TABLE bills ADD COLUMN cancel_reason text;
