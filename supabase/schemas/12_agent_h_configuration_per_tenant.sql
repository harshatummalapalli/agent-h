--
-- Agent H Stage 1: configuration becomes per-tenant.
-- Atomic CRM's original configuration table is a hard-coded singleton (one
-- global row, id always 1) holding app-wide settings like company name/logo.
-- That can't survive multiple tenants sharing one project unchanged, so it's
-- restructured here to one row per tenant, keyed by tenant_id. Wiring the
-- settings UI to read/write per-tenant is later-stage work; this migration
-- is schema only.
--

alter table public.configuration drop constraint configuration_singleton;
alter table public.configuration drop column id;
alter table public.configuration add column tenant_id bigint references public.tenants(id);
alter table public.configuration add column org_type text;
alter table public.configuration add primary key (tenant_id);

create or replace trigger set_configuration_tenant_context_trigger
    before insert on public.configuration
    for each row execute function public.set_tenant_context_default();
