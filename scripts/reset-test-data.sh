#!/usr/bin/env bash
# Agent H: Clean-Slate Reset — runs reset-test-data.sql against local Supabase.
# Usage: ./scripts/reset-test-data.sh
# Requires local Supabase to be running (make start or npx supabase start).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQL_FILE="$SCRIPT_DIR/reset-test-data.sql"

echo "🗑️  Wiping roles and candidates from local Supabase..."
echo "    This preserves auth.users, sales, contacts, companies, and configuration."
echo ""

# Use the local Supabase postgres URL (default local port 54322)
LOCAL_DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

psql "$LOCAL_DB_URL" -f "$SQL_FILE"

echo ""
echo "✅ Done. All roles and candidates cleared."
echo "   Tip: Reload the app and start fresh sourcing from the Roles page."
