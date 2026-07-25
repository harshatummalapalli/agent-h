-- Agent H Unipile Phase 3: LinkedIn account connection per recruiter (sales row).
-- Hosted auth stores Unipile account_id; seat type and checkpoint state synced from Unipile API.

alter table public.sales add column if not exists unipile_account_id text;
alter table public.sales add column if not exists unipile_linkedin_seat_type text;
alter table public.sales add column if not exists unipile_account_status text;
alter table public.sales add column if not exists unipile_checkpoint_type text;
alter table public.sales add column if not exists unipile_connected_at timestamp with time zone;
alter table public.sales add column if not exists unipile_last_sync_at timestamp with time zone;
alter table public.sales add column if not exists unipile_metadata jsonb not null default '{}'::jsonb;

comment on column public.sales.unipile_account_id is 'Unipile account id returned by hosted-auth notify_url after LinkedIn connect.';
comment on column public.sales.unipile_linkedin_seat_type is 'LinkedIn seat detected from Unipile account metadata: classic, premium, recruiter, sales_navigator, etc.';
comment on column public.sales.unipile_account_status is 'connected | credentials_required | checkpoint_pending | disconnected';
comment on column public.sales.unipile_checkpoint_type is 'When checkpoint_pending: 2FA, OTP, IN_APP_VALIDATION, CAPTCHA, PHONE_REGISTER, etc.';
comment on column public.sales.unipile_metadata is 'Last raw Unipile account payload subset for debugging and future Phase 4 outreach.';
