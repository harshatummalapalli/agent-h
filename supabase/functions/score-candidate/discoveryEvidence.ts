// Plain-text profile builder for unsaved discovery hits passed to
// score-candidate's evidence_only mode. Uses fields already on the
// normalized discovery response — no vendor API calls.

export function buildScoringTextFromDiscovery(raw: Record<string, unknown>): {
  text: string;
  source: "plain_fields";
} {
  const lines: string[] = [];
  const name =
    typeof raw.full_name === "string" && raw.full_name.length > 0
      ? raw.full_name
      : [raw.first_name, raw.last_name]
          .filter(
            (part): part is string =>
              typeof part === "string" && part.length > 0,
          )
          .join(" ");
  if (name) lines.push(name);
  if (typeof raw.job_title === "string" && raw.job_title) {
    lines.push(raw.job_title);
  }
  if (typeof raw.job_company_name === "string" && raw.job_company_name) {
    lines.push(`at ${raw.job_company_name}`);
  }
  if (typeof raw.location_name === "string" && raw.location_name) {
    lines.push(raw.location_name);
  }
  if (Array.isArray(raw.skills) && raw.skills.length > 0) {
    lines.push(
      `SKILLS: ${raw.skills.filter((s): s is string => typeof s === "string").join(", ")}`,
    );
  }

  return {
    text: lines.filter(Boolean).join("\n"),
    source: "plain_fields",
  };
}
