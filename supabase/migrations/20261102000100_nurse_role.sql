-- Phase 2: nursing role. Separate migration: a new enum value cannot be used
-- in the transaction that adds it.
alter type public.app_role add value if not exists 'nurse';
