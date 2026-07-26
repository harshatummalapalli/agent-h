// Phase 2 (2026-07-26): Outreach templates — list, create, edit, delete.
// Uses localStorage for zero-schema-change storage. Templates are scoped to
// the browser session (per-user effectively, since each recruiter uses their
// own browser). A future phase can lift these into a database table if
// multi-user sharing or admin-managed best-practices libraries are needed.
//
// Best-practices callout surfaces the top messaging tips inline so recruiters
// see them every time they open the page — no separate docs link to miss.
import { useEffect, useState } from "react";
import { FileText, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const STORAGE_KEY = "agent_h_outreach_templates_v1";

export type Template = {
  id: string;
  name: string;
  subject: string;
  body: string;
  channel: "email" | "linkedin" | "any";
  createdAt: string;
  updatedAt: string;
};

function loadTemplates(): Template[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Template[];
  } catch {
    return [];
  }
}

function saveTemplates(templates: Template[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // ignore
  }
}

function newId() {
  return `tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const CHANNEL_LABELS: Record<Template["channel"], string> = {
  email: "Email",
  linkedin: "LinkedIn",
  any: "Any channel",
};

const BEST_PRACTICES = [
  "Keep LinkedIn connection notes under 200 characters — shorter gets more accepts.",
  "Personalise the first line: mention the role, a specific skill, or recent work.",
  "One clear ask per message: a quick call, a reply, or a link — not all three.",
  "Send on Tuesday–Thursday mornings for the best open rates.",
  "Follow up once, three to five days after the first send — no more.",
];

type FormState = Omit<Template, "id" | "createdAt" | "updatedAt">;

const EMPTY_FORM: FormState = {
  name: "",
  subject: "",
  body: "",
  channel: "any",
};

export const TemplatesPage = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTemplates(loadTemplates());
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setCreating(true);
  };

  const openEdit = (t: Template) => {
    setEditing(t);
    setForm({
      name: t.name,
      subject: t.subject,
      body: t.body,
      channel: t.channel,
    });
    setError(null);
    setCreating(false);
  };

  const closeForm = () => {
    setEditing(null);
    setCreating(false);
    setError(null);
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!form.body.trim()) {
      setError("Message body is required.");
      return;
    }
    const now = new Date().toISOString();
    if (editing) {
      const updated = templates.map((t) =>
        t.id === editing.id ? { ...t, ...form, updatedAt: now } : t,
      );
      setTemplates(updated);
      saveTemplates(updated);
    } else {
      const newTemplate: Template = {
        ...form,
        id: newId(),
        createdAt: now,
        updatedAt: now,
      };
      const updated = [newTemplate, ...templates];
      setTemplates(updated);
      saveTemplates(updated);
    }
    closeForm();
  };

  const handleDelete = (id: string) => {
    const updated = templates.filter((t) => t.id !== id);
    setTemplates(updated);
    saveTemplates(updated);
    if (editing?.id === id) closeForm();
  };

  const showForm = creating || editing !== null;

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto px-6 py-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Outreach Templates
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reusable message templates for email and LinkedIn outreach. Stored
            in this browser.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          New template
        </Button>
      </div>

      {/* Best practices callout */}
      <div className="rounded-xl border bg-muted/30 p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <Info className="h-3.5 w-3.5" />
          Messaging best practices
        </div>
        <ul className="flex flex-col gap-1">
          {BEST_PRACTICES.map((tip, i) => (
            <li key={i} className="text-xs text-muted-foreground flex gap-2">
              <span className="shrink-0 text-muted-foreground/50">·</span>
              {tip}
            </li>
          ))}
        </ul>
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <div className="rounded-xl border p-5 flex flex-col gap-4">
          <h2 className="text-base font-medium">
            {editing ? "Edit template" : "New template"}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tmpl-name">Template name</Label>
              <Input
                id="tmpl-name"
                placeholder="e.g. Senior Engineer — first touch"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tmpl-channel">Channel</Label>
              <select
                id="tmpl-channel"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                value={form.channel}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    channel: e.target.value as Template["channel"],
                  }))
                }
              >
                {(["any", "email", "linkedin"] as Template["channel"][]).map(
                  (ch) => (
                    <option key={ch} value={ch}>
                      {CHANNEL_LABELS[ch]}
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>

          {form.channel !== "linkedin" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tmpl-subject">Subject line (email)</Label>
              <Input
                id="tmpl-subject"
                placeholder="e.g. Exciting opportunity at [Company]"
                value={form.subject}
                onChange={(e) =>
                  setForm((f) => ({ ...f, subject: e.target.value }))
                }
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tmpl-body">
              Message body
              {form.channel === "linkedin" && (
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  ({form.body.length} / 300 chars for connection note)
                </span>
              )}
            </Label>
            <Textarea
              id="tmpl-body"
              placeholder="Hi {{first_name}}, I came across your profile and…"
              rows={7}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Use {"{{first_name}}"} for personalization (substitution coming
              soon).
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center gap-3">
            <Button onClick={handleSave}>Save template</Button>
            <Button variant="outline" onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Templates list */}
      {templates.length === 0 && !showForm ? (
        <div className="rounded-xl border bg-muted/20 py-12 text-center">
          <FileText className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No templates yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create your first template to reuse across roles.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={openCreate}
          >
            Create first template
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {templates.map((t) => (
            <div
              key={t.id}
              className={`rounded-xl border p-4 flex flex-col gap-2 transition-colors ${
                editing?.id === t.id ? "border-foreground/20 bg-muted/20" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-sm">{t.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {CHANNEL_LABELS[t.channel]}
                    {t.subject ? ` · "${t.subject}"` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(t)}
                    aria-label="Edit template"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(t.id)}
                    aria-label="Delete template"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {t.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

TemplatesPage.path = "/templates";
