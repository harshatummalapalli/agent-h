-- Agent H Stage 5: optional per-recruiter Cal.com username override.
alter table public.sales add column cal_username text;
comment on column public.sales.cal_username is 'This recruiter''s username on the self-hosted Cal.com instance, used to build a personalized booking link for a role brief they own. Null falls back to CAL_DEFAULT_USERNAME in create-booking-link.';
