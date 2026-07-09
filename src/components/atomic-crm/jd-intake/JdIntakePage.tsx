// Agent H Stage 2: JD Intake.
//
// Paste a job description, parse it into a structured role brief via
// dataProvider.parseJobDescription (which calls the parse-job-description
// edge function), review/edit the extracted fields, then save it as a
// role brief (a public.deals row -- see
// supabase/schemas/15_agent_h_structured_role_brief_fields.sql for why
// deals rather than a new table).
//
// Deliberately not built as a react-admin <Create> form: the two-phase
// "parse, then review/edit, then save" flow doesn't map cleanly onto a
// single-submit form, so this page manages its own local state and calls
// the data provider directly.

import { useState } from "react";
import { useDataProvider, useNotify, useRedirect } from "ra-core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CrmDataProvider } from "../providers/types";

const SENIORITY_OPTIONS = [
  "intern",
  "entry_level",
  "mid_level",
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
  "executive",
];

const EMPLOYMENT_TYPE_OPTIONS = [
  "full_time",
  "part_time",
  "contract",
  "contract_to_hire",
  "internship",
];

type ParsedRoleBrief = {
  title: string;
  seniority: string;
  location: string;
  industry: string | null;
  employment_type: string;
  years_experience_min: number | null;
  years_experience_max: number | null;
  required_skills: string[];
  must_have_keywords: string[];
  nice_to_have_keywords: string[];
};

const arrayToText = (values: string[] | undefined) =>
  (values ?? []).join(", ");

const textToArray = (value: string) =>
  value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

export const JdIntakePage = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const redirect = useRedirect();

  const [jdText, setJdText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsed, setParsed] = useState<ParsedRoleBrief | null>(null);
  const [skillsText, setSkillsText] = useState("");
  const [mustHaveText, setMustHaveText] = useState("");
  const [niceToHaveText, setNiceToHaveText] = useState("");

  const handleParse = async () => {
    if (!jdText.trim()) {
      notify("Paste a job description first", { type: "warning" });
      return;
    }
    setParsing(true);
    try {
      const result = await dataProvider.parseJobDescription(jdText);
      setParsed(result);
      setSkillsText(arrayToText(result.required_skills));
      setMustHaveText(arrayToText(result.must_have_keywords));
      setNiceToHaveText(arrayToText(result.nice_to_have_keywords));
      notify(
        "Job description parsed -- review the fields below before saving",
        { type: "success" },
      );
    } catch (error: any) {
      notify(error?.message || "Failed to parse job description", {
        type: "error",
      });
    } finally {
      setParsing(false);
    }
  };

  const updateParsed = (patch: Partial<ParsedRoleBrief>) => {
    setParsed((current) => (current ? { ...current, ...patch } : current));
  };

  const handleCreate = async () => {
    if (!parsed) return;
    setSaving(true);
    try {
      const { data } = await dataProvider.create("deals", {
        data: {
          name: parsed.title,
          // "opportunity" is one of Atomic's stock deal stages so the
          // record shows up cleanly in the existing Deals Kanban view.
          // Mapping role_status to a recruiting-specific stage vocabulary
          // is UI/config work for a later stage, not part of JD parsing.
          stage: "opportunity",
          jd_text: jdText,
          seniority: parsed.seniority,
          location: parsed.location,
          industry: parsed.industry,
          employment_type: parsed.employment_type,
          years_experience_min: parsed.years_experience_min,
          years_experience_max: parsed.years_experience_max,
          required_skills: textToArray(skillsText),
          must_have_keywords: textToArray(mustHaveText),
          nice_to_have_keywords: textToArray(niceToHaveText),
          role_status: "new",
          contact_ids: [],
        },
      });
      notify("Role brief created", { type: "success" });
      redirect(`/deals/${data.id}/show`);
    } catch (error: any) {
      notify(error?.message || "Failed to create the role brief", {
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto p-6">
      <div>
        <h1 className="text-2xl font-semibold">JD Intake</h1>
        <p className="text-muted-foreground text-sm">
          Paste a job description in plain language. It'll be parsed into a
          structured role brief you can review and edit before saving.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="jd-text">Job description</Label>
        <Textarea
          id="jd-text"
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
          rows={10}
          placeholder="Paste the full job description here..."
        />
        <div>
          <Button onClick={handleParse} disabled={parsing}>
            {parsing ? "Parsing..." : "Parse with AI"}
          </Button>
        </div>
      </div>

      {parsed && (
        <div className="flex flex-col gap-4 border rounded-lg p-4">
          <h2 className="text-lg font-medium">Review extracted fields</h2>

          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Role title</Label>
            <Input
              id="title"
              value={parsed.title}
              onChange={(e) => updateParsed({ title: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="seniority">Seniority</Label>
              <select
                id="seniority"
                className="border rounded-md h-9 px-2"
                value={parsed.seniority}
                onChange={(e) => updateParsed({ seniority: e.target.value })}
              >
                {SENIORITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="employment_type">Employment type</Label>
              <select
                id="employment_type"
                className="border rounded-md h-9 px-2"
                value={parsed.employment_type}
                onChange={(e) =>
                  updateParsed({ employment_type: e.target.value })
                }
              >
                {EMPLOYMENT_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={parsed.location}
                onChange={(e) => updateParsed({ location: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                value={parsed.industry ?? ""}
                onChange={(e) => updateParsed({ industry: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="years_min">Years experience (min)</Label>
              <Input
                id="years_min"
                type="number"
                value={parsed.years_experience_min ?? ""}
                onChange={(e) =>
                  updateParsed({
                    years_experience_min: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="years_max">Years experience (max)</Label>
              <Input
                id="years_max"
                type="number"
                value={parsed.years_experience_max ?? ""}
                onChange={(e) =>
                  updateParsed({
                    years_experience_max: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="skills">Required skills (comma-separated)</Label>
            <Input
              id="skills"
              value={skillsText}
              onChange={(e) => setSkillsText(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="must-have">
              Must-have keywords (comma-separated)
            </Label>
            <Input
              id="must-have"
              value={mustHaveText}
              onChange={(e) => setMustHaveText(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="nice-to-have">
              Nice-to-have keywords (comma-separated)
            </Label>
            <Input
              id="nice-to-have"
              value={niceToHaveText}
              onChange={(e) => setNiceToHaveText(e.target.value)}
            />
          </div>

          <div>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Saving..." : "Create Role Brief"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

JdIntakePage.path = "/jd-intake";
