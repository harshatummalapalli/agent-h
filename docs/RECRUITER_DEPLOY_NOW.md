# Manual Deploy Checklist

**Use this until GitHub Actions secrets are fixed.**

GitHub CI (`deploy.yml`) currently fails with:

```
fatal: repository 'https://github.com/' not found
```

This happens because the `DEPLOY_REPOSITORY` and Supabase secrets are not set
in the repository's GitHub Actions secrets/variables. Until those are
configured, deploy manually using the steps below.

---

## 1. Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed (`npm i -g supabase`)
- Logged in: `npx supabase login`
- Project linked: `npx supabase link --project-ref YOUR_PROJECT_REF_ID`

---

## 2. Apply pending database migration (taxonomy-aware sourcing)

**Required before deploying edge functions for the taxonomy/search-intent work.**

Migration file: `supabase/migrations/20260727000000_agent_h_role_brief_search_intent.sql`

Option A — CLI (recommended):
```bash
npx supabase db push
```

Option B — Supabase Dashboard → SQL Editor → paste and run:
```sql
alter table public.deals
  add column if not exists role_brief_search_intent jsonb;

comment on column public.deals.role_brief_search_intent is
  'Versioned SearchIntent record: { current: VersionedSearchIntent, history: VersionedSearchIntent[] }. Produced by resolve-search-intent.';
```

Verify: in the Dashboard → Table Editor → `deals`, confirm `role_brief_search_intent` (type `jsonb`) is present.

---

## 3. Deploy edge functions

Run these four commands from the repo root:

```bash
npx supabase functions deploy calibration-session
npx supabase functions deploy resolve-search-intent
npx supabase functions deploy parse-agent-command
npx supabase functions deploy parse-job-description
npx supabase functions deploy source-candidates-discovery
```

Each deploy takes ~30 seconds. Verify on the Supabase dashboard under
**Edge Functions** that the "Last deployed" timestamp updated.

---

## 3. Rebuild and deploy the frontend

```bash
# From the repo root, on the latest main branch:
git pull origin main
npm ci            # or: make install
npm run build     # or: make build
```

Then push the `dist/` folder to your hosting target (Netlify, Vercel,
GitHub Pages, etc.) or run your normal hosting deploy command.

**Hard-refresh in the browser** (`Ctrl+Shift+R` / `Cmd+Shift+R`) after
deploying so the recruiter picks up the new frontend bundle.

---

## 4. Smoke-test after deploy

1. Open a role and click **Not a fit** — it should work without an error.
2. Calibration cards should show a LinkedIn link and location when Crustdata
   returns that data.
3. India-constrained roles should not surface US-based candidates.

---

## 5. Fix GitHub Actions (permanent fix)

Add the following to the repository's **Settings → Secrets and variables →
Actions**:

| Type | Key | Description |
|------|-----|-------------|
| Secret | `SUPABASE_ACCESS_TOKEN` | Supabase personal access token |
| Secret | `SUPABASE_DB_PASSWORD` | Database password |
| Secret | `SUPABASE_PROJECT_ID` | Project reference ID |
| Secret | `SUPABASE_URL` | `https://<ref>.supabase.co` |
| Secret | `SB_PUBLISHABLE_KEY` | Supabase anon/publishable key |
| Variable | `DEPLOY_REPOSITORY` | `owner/repo` for frontend deploy |

Once set, `git push origin main` will trigger the full CI deploy automatically.
