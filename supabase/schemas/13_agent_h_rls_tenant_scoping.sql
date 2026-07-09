--
-- Agent H Stage 1: tenant-scoped Row Level Security.
-- This file is what Atomic CRM's own 05_policies.sql would have been --
-- deliberately not created, since it only ever granted "any authenticated
-- user can read/write everything" with no isolation at all. This file
-- replaces that concept entirely with real tenant isolation: a recruiter
-- can only see/act on rows belonging to their own tenant.
--
-- Numbered 13 (loads after every table in this stage exists, since these
-- policies reference tenant_id columns and tables added in files 08-12).
--
-- Ownership/assignment (who's working a record) stays a separate concept
-- from visibility (who can see it): visibility is tenant-wide, assignment
-- is tracked in the *_assignments tables and candidates.engaged_by_sales_id.
--

alter table public.tenants enable row level security;
alter table public.candidates enable row level security;
alter table public.candidate_assignments enable row level security;
alter table public.role_brief_assignments enable row level security;
alter table public.events enable row level security;

-- Tenants: a recruiter can see their own tenant's row (name, org_type), and
-- nothing about any other tenant. No insert/update/delete for authenticated
-- users -- tenant creation is an operational/admin action, not an app action.
create policy "Tenant read own" on public.tenants for select to authenticated
    using (id = public.current_tenant_id());

-- Sales (team members): visible tenant-wide (recruiters are first-class
-- users of a tenant, not isolated from each other). Editing is limited to
-- yourself or a tenant admin editing a teammate.
create policy "Sales read within tenant" on public.sales for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Sales update self or admin" on public.sales for update to authenticated
    using (user_id = auth.uid() or (public.is_admin() and tenant_id = public.current_tenant_id()))
    with check (user_id = auth.uid() or (public.is_admin() and tenant_id = public.current_tenant_id()));

-- Companies
create policy "Companies read within tenant" on public.companies for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Companies insert within tenant" on public.companies for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
create policy "Companies update within tenant" on public.companies for update to authenticated
    using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "Companies delete within tenant" on public.companies for delete to authenticated
    using (tenant_id = public.current_tenant_id());

-- Contacts
create policy "Contacts read within tenant" on public.contacts for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Contacts insert within tenant" on public.contacts for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
create policy "Contacts update within tenant" on public.contacts for update to authenticated
    using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "Contacts delete within tenant" on public.contacts for delete to authenticated
    using (tenant_id = public.current_tenant_id());

-- Contact notes
create policy "Contact notes read within tenant" on public.contact_notes for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Contact notes insert within tenant" on public.contact_notes for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
create policy "Contact notes update within tenant" on public.contact_notes for update to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Contact notes delete within tenant" on public.contact_notes for delete to authenticated
    using (tenant_id = public.current_tenant_id());

-- Deals (role briefs)
create policy "Deals read within tenant" on public.deals for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Deals insert within tenant" on public.deals for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
create policy "Deals update within tenant" on public.deals for update to authenticated
    using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "Deals delete within tenant" on public.deals for delete to authenticated
    using (tenant_id = public.current_tenant_id());

-- Deal notes
create policy "Deal notes read within tenant" on public.deal_notes for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Deal notes insert within tenant" on public.deal_notes for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
create policy "Deal notes update within tenant" on public.deal_notes for update to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Deal notes delete within tenant" on public.deal_notes for delete to authenticated
    using (tenant_id = public.current_tenant_id());

-- Tags
create policy "Tags read within tenant" on public.tags for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Tags insert within tenant" on public.tags for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
create policy "Tags update within tenant" on public.tags for update to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Tags delete within tenant" on public.tags for delete to authenticated
    using (tenant_id = public.current_tenant_id());

-- Tasks
create policy "Tasks read within tenant" on public.tasks for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Tasks insert within tenant" on public.tasks for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
create policy "Tasks update within tenant" on public.tasks for update to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Tasks delete within tenant" on public.tasks for delete to authenticated
    using (tenant_id = public.current_tenant_id());

-- Configuration (per-tenant now; writes still admin-only, matching Atomic's
-- original admin-gated policy, now additionally scoped to your own tenant)
create policy "Configuration read within tenant" on public.configuration for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Configuration insert for tenant admins" on public.configuration for insert to authenticated
    with check (public.is_admin() and tenant_id = public.current_tenant_id());
create policy "Configuration update for tenant admins" on public.configuration for update to authenticated
    using (public.is_admin() and tenant_id = public.current_tenant_id())
    with check (public.is_admin() and tenant_id = public.current_tenant_id());

-- Favicons excluded domains: genuinely shared reference data, not tenant
-- data -- left exactly as Atomic CRM's original open policy.
create policy "Enable access for authenticated users only" on public.favicons_excluded_domains
    to authenticated using (true) with check (true);

-- Candidates
create policy "Candidates read within tenant" on public.candidates for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Candidates insert within tenant" on public.candidates for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
create policy "Candidates update within tenant" on public.candidates for update to authenticated
    using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "Candidates delete within tenant" on public.candidates for delete to authenticated
    using (tenant_id = public.current_tenant_id());

-- Candidate assignments
create policy "Candidate assignments read within tenant" on public.candidate_assignments for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Candidate assignments insert within tenant" on public.candidate_assignments for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
create policy "Candidate assignments delete within tenant" on public.candidate_assignments for delete to authenticated
    using (tenant_id = public.current_tenant_id());

-- Role brief assignments
create policy "Role brief assignments read within tenant" on public.role_brief_assignments for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Role brief assignments insert within tenant" on public.role_brief_assignments for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
create policy "Role brief assignments delete within tenant" on public.role_brief_assignments for delete to authenticated
    using (tenant_id = public.current_tenant_id());

-- Events: append-only. Select + insert, tenant scoped. Deliberately no
-- update/delete policy at all -- combined with the grants revocation in
-- 11_agent_h_event_log.sql, this makes the log immutable for every role
-- except service_role.
create policy "Events read within tenant" on public.events for select to authenticated
    using (tenant_id = public.current_tenant_id());
create policy "Events insert within tenant" on public.events for insert to authenticated
    with check (tenant_id = public.current_tenant_id());
