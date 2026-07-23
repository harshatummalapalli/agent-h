// Agent H: the public, unauthenticated candidate application portal --
// task #53 of Harsha's "outbound path" ask (2026-07-19). A candidate visits
// this page via a shareable link (built from a role's
// public_application_token, see RoleWorkspacePage's "Copy application
// link" action) and submits their own name/email/phone/resume directly
// against that role, no login required.
//
// Deliberately NOT wired through ra-core's dataProvider/Admin shell -- this
// route is registered in CRM.tsx's `<CustomRoutes noLayout>` block, the
// same one SignupPage/SetPasswordPage/ForgotPasswordPage/OAuthConsentPage
// already use for pages that must render before (or entirely outside) any
// recruiter auth session exists. It posts a plain FormData body straight to
// the submit-candidate-application edge function via the Supabase client's
// functions.invoke (anon key only, no user session needed -- that function
// is deployed with verify_jwt: false and authenticates purely via the
// :token in the URL).
//
// No dataProvider method exists for this on purpose: dataProvider methods
// assume an authenticated recruiter session (see how sourceFreePortalCandidates
// etc. all ride the logged-in user's own client instance) and this page runs
// with nobody logged in at all.

import { useState } from "react";
import { useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabaseClient } from "../providers/supabase/supabase";

type SubmitState = "idle" | "submitting" | "done" | "error";

export const CandidateApplicationPage = () => {
  const { token } = useParams<{ token: string }>();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [roleName, setRoleName] = useState<string | null>(null);

  if (!token) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim()) {
      setErrorMessage("Please fill in your name and email.");
      return;
    }

    setState("submitting");
    setErrorMessage(null);

    const form = new FormData();
    form.set("token", token);
    form.set("full_name", fullName.trim());
    form.set("email", email.trim());
    if (phone.trim()) form.set("phone", phone.trim());
    if (resumeFile) form.set("resume", resumeFile);

    const { data, error } = await getSupabaseClient().functions.invoke<{
      status: string;
      role_name: string;
      resume_captured: boolean;
    }>("submit-candidate-application", { method: "POST", body: form });

    if (!data || error) {
      const errorDetails = await (async () => {
        try {
          return (await error?.context?.json()) ?? {};
        } catch {
          return {};
        }
      })();
      setErrorMessage(
        errorDetails?.error || "Something went wrong submitting your application. Please try again.",
      );
      setState("error");
      return;
    }

    setRoleName(data.role_name ?? null);
    setState("done");
  };

  if (state === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Application received</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Thanks{roleName ? ` for applying to ${roleName}` : ""} -- your details
              {resumeFile ? " and resume " : " "}have been sent to the hiring team.
              They'll be in touch if it's a fit.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>Apply for this role</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="full_name">Full name</Label>
              <Input
                id="full_name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="resume">Resume (PDF, Word, or RTF)</Label>
              <Input
                id="resume"
                type="file"
                accept=".pdf,.doc,.docx,.rtf"
                onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
            {/* Privacy/consent notice (2026-07-19, investor-readiness pass): this
                page collects PII (name, email, phone, resume) from an anonymous
                member of the public with no account and no prior relationship to
                this company -- unlike every other data-entry point in the app,
                there's no recruiter in the loop to have explained how the data
                will be used. A one-line disclosure here is the minimum bar for
                that kind of collection. Deliberately not a checkbox: making
                consent an explicit gate is a legal/product decision for Harsha
                to make with real counsel, not something to invent unasked. */}
            <p className="text-xs text-muted-foreground">
              By submitting this form, you agree that your name, email, phone, and resume
              will be shared with the hiring team for this role and stored so they can
              follow up with you about your application.
            </p>
            <Button type="submit" disabled={state === "submitting"}>
              {state === "submitting" ? "Submitting..." : "Submit application"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

CandidateApplicationPage.path = "/apply/:token";
