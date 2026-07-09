--
-- Agent H Stage 1: function grant hardening.
-- Supabase's security advisor flags any SECURITY DEFINER function callable
-- via PostgREST RPC by anon/authenticated as worth reviewing. Two of Agent
-- H's new functions were flagged:
--   - current_tenant_id(): harmless as written (returns null for anon,
--     since auth.uid() is null), but has no legitimate anonymous caller --
--     only ever needed inside an RLS policy evaluated as `authenticated`.
--   - set_tenant_context_default(), set_candidate_created_by_default(),
--     set_event_actor_default(), set_updated_at(): trigger-only functions.
--     Postgres refuses to call a function declared RETURNS TRIGGER outside
--     of an actual trigger context, and triggers don't require the
--     invoking role to hold EXECUTE at all -- so revoking EXECUTE entirely
--     is safe and removes the RPC-callable surface.
-- Closing off anon (and, for the trigger-only functions, authenticated too)
-- entirely rather than leaving it open "because it's technically harmless."
--

revoke execute on function public.current_tenant_id() from public;
revoke execute on function public.current_tenant_id() from anon;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.current_tenant_id() to service_role;

revoke execute on function public.set_tenant_context_default() from public;
revoke execute on function public.set_tenant_context_default() from anon;
revoke execute on function public.set_tenant_context_default() from authenticated;
grant execute on function public.set_tenant_context_default() to service_role;

revoke execute on function public.set_candidate_created_by_default() from public;
revoke execute on function public.set_candidate_created_by_default() from anon;
revoke execute on function public.set_candidate_created_by_default() from authenticated;
grant execute on function public.set_candidate_created_by_default() to service_role;

revoke execute on function public.set_event_actor_default() from public;
revoke execute on function public.set_event_actor_default() from anon;
revoke execute on function public.set_event_actor_default() from authenticated;
grant execute on function public.set_event_actor_default() to service_role;

revoke execute on function public.set_updated_at() from public;
revoke execute on function public.set_updated_at() from anon;
revoke execute on function public.set_updated_at() from authenticated;
grant execute on function public.set_updated_at() to service_role;
