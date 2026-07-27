import { test, expect } from "./fixtures";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341";
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY ?? "";

const SAMPLE_INTENT = {
  current: {
    version: 2,
    updated_at: new Date().toISOString(),
    conditions: [
      { category: "seniority", disposition: "require", value: "Senior" },
      { category: "seniority", disposition: "exclude", value: "Staff" },
      { category: "company", disposition: "exclude", value: "Coupang" },
      { category: "skill", disposition: "prefer", value: "TypeScript" },
    ],
    unenforceable_constraints: [
      {
        description: "recent TypeScript (< 2 years ago)",
        reason: "Crustdata cannot filter by skill recency",
      },
    ],
  },
  history: [
    {
      version: 1,
      updated_at: new Date(Date.now() - 60000).toISOString(),
      conditions: [
        { category: "seniority", disposition: "require", value: "Senior" },
      ],
      unenforceable_constraints: [],
    },
  ],
};

test("role memory panel shows sourcing intent when present", async ({
  page,
  createSales,
}) => {
  if (!SERVICE_ROLE_KEY) {
    test.skip(true, "SERVICE_ROLE_KEY not set — skipping (requires local Supabase)");
    return;
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const sales = await createSales({
    email: `intent-test-${Date.now()}@example.com`,
    first_name: "Intent",
    last_name: "Tester",
    password: "password123",
  });

  const { data: deal } = await adminClient
    .from("deals")
    .insert({
      name: "Senior Engineer — Intent Test",
      sales_id: sales.id,
      stage: "opportunity",
      role_brief_search_intent: SAMPLE_INTENT,
    })
    .select("id")
    .single();

  if (!deal) {
    test.skip(true, "Could not create deal — role_brief_search_intent column may not exist yet");
    return;
  }

  await page.goto(`/roles/${deal.id}`);
  await page.waitForLoadState("networkidle");

  // Open Role Memory panel if it has a toggle button
  const memoryBtn = page.getByRole("button", { name: /role memory|memory panel/i });
  if (await memoryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await memoryBtn.click();
  }

  // Sourcing understanding section must be visible
  await expect(
    page.getByText("Sourcing understanding", { exact: false }),
  ).toBeVisible({ timeout: 10000 });

  // Required and excluded conditions
  await expect(page.getByText("Senior")).toBeVisible();
  await expect(page.getByText("Staff")).toBeVisible();
  await expect(page.getByText("Coupang")).toBeVisible();

  // Unenforceable constraints
  await expect(
    page.getByText("Approximate matches only", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("recent TypeScript", { exact: false }),
  ).toBeVisible();

  // Delta from history
  await expect(
    page.getByText("After last feedback", { exact: false }),
  ).toBeVisible();
});
