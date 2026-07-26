# Applying Database Migrations Without Docker

Use this guide when you can't run Docker locally (Windows without WSL, locked-down machines, etc.). All steps work in **Windows PowerShell** or any terminal.

---

## Prerequisites

- Node.js 18+ installed
- A Supabase account with a project already created at [supabase.com](https://supabase.com)
- Your project's **reference ID** (found in Project Settings → General → Reference ID, e.g. `abcdefghijkl`)
- Your Supabase **access token** (found in [Account → Access Tokens](https://supabase.com/dashboard/account/tokens))

---

## One-time setup (run once per machine)

```powershell
# 1. Install the Supabase CLI (if not already installed)
npm install -g supabase

# 2. Log in with your access token
npx supabase login
# This opens a browser page — paste your access token when prompted.

# 3. Link your project (run from the repo root)
npx supabase link --project-ref YOUR_PROJECT_REF_ID
# Replace YOUR_PROJECT_REF_ID with your project reference ID.
# You will be asked for your database password — find it in
# Project Settings → Database → Connection string (the password field).
```

---

## Applying migrations (run whenever there are new migrations)

```powershell
# From the repo root:
npx supabase db push
```

This pushes every migration in `supabase/migrations/` that hasn't been applied to your remote project yet. It is safe to run repeatedly — already-applied migrations are skipped.

---

## Applying the coordinator_settings migration specifically

The migration `20260726090000_agent_h_phase2_coordinator_settings.sql` adds a `coordinator_settings` column to the `deals` table. Run the command above, or — if the CLI link fails — paste this directly in the **Supabase Dashboard SQL Editor** (`supabase.com/dashboard/project/YOUR_PROJECT_REF_ID/sql/new`):

```sql
alter table public.deals
    add column if not exists coordinator_settings jsonb;
```

This is idempotent — running it more than once is harmless.

---

## Setting LinkedIn outreach secrets (without Docker)

If you see "LinkedIn outreach isn't configured on this server yet" in Preferences → Connected Accounts, the LinkedIn outreach secrets need to be set on your hosted Supabase project. Run these commands from the repo root (requires the Supabase CLI linked as above):

```powershell
npx supabase secrets set UNIPILE_API_KEY=your_key_here UNIPILE_DSN=https://your-dsn.unipile.com:port
```

Then deploy the LinkedIn edge functions (note: `create-unipile-hosted-auth-link` and `unipile-hosted-auth-notify` have been removed — do not deploy them):

```powershell
npx supabase functions deploy connect-linkedin-account
npx supabase functions deploy get-unipile-linkedin-account
npx supabase functions deploy solve-unipile-checkpoint
npx supabase functions deploy prepare-first-outreach
npx supabase functions deploy send-first-outreach
```

After deploying, go to **Preferences → Connected Accounts** and click **Refresh after admin sets secrets** — the card will show a LinkedIn username/password form. Enter your LinkedIn credentials directly; they are passed to LinkedIn and never stored.

---

## After applying migrations

### Redeploy the frontend

If you're on Vercel / Netlify / similar:

```powershell
# Vercel example:
npx vercel --prod

# Or trigger a redeploy from the dashboard by pushing to your main branch.
```

### Redeploy the `send-first-outreach` Edge Function

The bug fix in `supabase/functions/send-first-outreach/index.ts` requires redeploying that function:

```powershell
# Link must be done first (see above)
npx supabase functions deploy send-first-outreach
```

Or deploy all functions at once:

```powershell
npx supabase functions deploy
```

---

## 5-step smoke test checklist

After deploying, verify the platform is working:

1. **Log in** — Open the app and confirm you can log in. No blank screen or auth errors.
2. **Open a deal** — Navigate to any deal record. Confirm the "Coordinator" tab loads without an error.
3. **Source candidates** — On the "Source Candidates" page, select a role brief and click **Preview matches**. Confirm a match count appears.
4. **Add to pipeline** — Click **Add to pipeline** on any candidate. Confirm the "Added to pipeline" success toast appears.
5. **Send first outreach** — Open any sourced candidate from the pipeline and trigger an outreach email. Confirm the email is sent (check Inbucket / your email) without a `TypeError` about email arguments.

If step 2 fails with a "column coordinator_settings does not exist" error, the migration hasn't been applied — repeat the SQL Editor step above.
