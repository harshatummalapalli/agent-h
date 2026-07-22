--
-- Agent H Stage 1: configuration becomes per-tenant.
-- Atomic CRM's original configuration table is a hard-coded singleton (one
-- global row, id always 1) holding app-wide settings like company name/logo.
-- That can't survive multiple tenants sharing one project unchanged, so it's
-- restructured here to one row per tenant, scoped by tenant_id. Wiring the
-- settings UI to read/write per-tenant is later-stage work; this migration
-- is schema only.
--
-- Corrected during Stage 2 integration testing: the first version of this
-- file made tenant_id the primary key and dropped `id` entirely. That broke
-- Atomic's existing frontend code, which -- like the rest of
-- react-admin/ra-core -- assumes every resource has a plain `id` column to
-- reference records by. `id` is kept as the real primary key below;
-- tenant_id is a unique scoping column instead, which still fully achieves
-- "one config row per tenant."
--

alter table public.configuration drop constraint configuration_singleton;
alter table public.configuration add column tenant_id bigint references public.tenants(id) unique;
alter table public.configuration add column org_type text;

create or replace trigger set_configuration_tenant_context_trigger
    before insert on public.configuration
    for each row execute function public.set_tenant_context_default();
