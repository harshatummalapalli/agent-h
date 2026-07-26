-- Add sourcing_paused flag to deals.
-- When true: blocks start_sourcing / calibration_next_batch from running.
-- Future autopilot will also respect this field before triggering any
-- automatic sourcing passes (see AutopilotSettings stub in RoleWorkspacePage).
alter table public.deals
    add column if not exists sourcing_paused boolean not null default false;
