import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CrmDataProvider } from "../providers/types";

export type UnipileLinkedInAccount = {
  configured: boolean;
  account_id: string | null;
  seat_type: string | null;
  status: string;
  checkpoint_type: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  sync_error?: string;
};

const SEAT_LABELS: Record<string, string> = {
  classic: "LinkedIn Classic",
  premium: "LinkedIn Premium",
  recruiter: "LinkedIn Recruiter",
  sales_navigator: "Sales Navigator",
};

const STATUS_LABELS: Record<string, string> = {
  connected: "Connected",
  checkpoint_pending: "Verification required",
  credentials_required: "Reconnect required",
  disconnected: "Not connected",
};

function statusBadgeClass(status: string): string {
  if (status === "connected") return "ah-status-badge ah-status-good";
  if (status === "checkpoint_pending") return "ah-status-badge ah-status-warn";
  if (status === "credentials_required")
    return "ah-status-badge ah-status-danger";
  return "ah-status-badge ah-status-neutral";
}

export const UnipileLinkedInConnectionCard = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const queryClient = useQueryClient();
  const [checkpointCode, setCheckpointCode] = useState("");
  const [connectBusy, setConnectBusy] = useState(false);

  const { data, isPending, refetch } = useQuery({
    queryKey: ["unipile_linkedin_account"],
    queryFn: () => dataProvider.getUnipileLinkedInAccount(),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedin = params.get("linkedin");
    if (linkedin === "connected") {
      notify("LinkedIn connected — syncing account details…", {
        type: "success",
      });
      refetch();
      params.delete("linkedin");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState({}, "", next);
    } else if (linkedin === "failed") {
      notify("LinkedIn connection did not complete — try again.", {
        type: "error",
      });
      params.delete("linkedin");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState({}, "", next);
    }
  }, [notify, refetch]);

  const { mutate: solveCheckpoint, isPending: solving } = useMutation({
    mutationFn: (code: string) => dataProvider.solveUnipileCheckpoint(code),
    onSuccess: (result) => {
      setCheckpointCode("");
      queryClient.invalidateQueries({ queryKey: ["unipile_linkedin_account"] });
      notify(result.message ?? "Checkpoint solved", { type: "success" });
    },
    onError: (error: Error) => {
      notify(error.message || "Checkpoint failed", { type: "error" });
    },
  });

  const startConnect = async (reconnect = false) => {
    setConnectBusy(true);
    try {
      const { url } = await dataProvider.createUnipileHostedAuthLink(reconnect);
      window.location.href = url;
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Could not start LinkedIn connect",
        { type: "error" },
      );
      setConnectBusy(false);
    }
  };

  const account = data as UnipileLinkedInAccount | undefined;
  const status = account?.status ?? "disconnected";
  const seatLabel = account?.seat_type
    ? (SEAT_LABELS[account.seat_type] ?? account.seat_type)
    : null;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-muted-foreground">
            {translate("crm.profile.linkedin.title", {
              _: "LinkedIn",
            })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {translate("crm.profile.linkedin.description", {
              _: "Connect your LinkedIn account to send outreach messages directly from this platform. This app never stores your LinkedIn password.",
            })}
          </p>
        </div>

        {isPending ? (
          <p className="text-sm text-muted-foreground">
            Loading connection status…
          </p>
        ) : !account?.configured ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm ah-callout-warn rounded-md p-3">
              LinkedIn outreach isn't set up on this server yet. Ask your admin
              to add LinkedIn outreach secrets in Supabase Edge Function
              settings, then redeploy the LinkedIn functions.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isPending}
            >
              Refresh after admin sets secrets
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={statusBadgeClass(status)}>
                {STATUS_LABELS[status] ?? status}
              </span>
              {seatLabel ? (
                <span className="ah-status-badge ah-status-info">
                  {seatLabel}
                </span>
              ) : null}
            </div>

            {account.sync_error ? (
              <p className="text-xs ah-callout-danger rounded px-2 py-1">
                {account.sync_error}
              </p>
            ) : null}

            {status === "checkpoint_pending" && account.checkpoint_type ? (
              <div className="space-y-3 ah-callout-warn rounded-md p-3">
                <p className="text-sm">
                  LinkedIn requires <strong>{account.checkpoint_type}</strong>{" "}
                  verification before this account can send outreach.
                </p>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="unipile-checkpoint-code" className="text-xs">
                    Verification code
                  </Label>
                  <Input
                    id="unipile-checkpoint-code"
                    value={checkpointCode}
                    onChange={(e) => setCheckpointCode(e.target.value)}
                    placeholder="Enter the code LinkedIn sent you"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!checkpointCode.trim() || solving}
                      onClick={() => solveCheckpoint(checkpointCode.trim())}
                    >
                      {solving ? "Submitting…" : "Submit code"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={solving}
                      onClick={() =>
                        dataProvider
                          .solveUnipileCheckpoint("TRY_ANOTHER_WAY", true)
                          .then(() => refetch())
                          .catch((e) =>
                            notify(e.message || "Could not switch checkpoint", {
                              type: "error",
                            }),
                          )
                      }
                    >
                      Try another way
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {status === "connected" ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={connectBusy}
                    onClick={() => refetch()}
                  >
                    Refresh status
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={connectBusy}
                    onClick={() => startConnect(true)}
                  >
                    Reconnect
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  disabled={connectBusy}
                  onClick={() => startConnect(false)}
                >
                  {connectBusy ? "Redirecting…" : "Connect LinkedIn"}
                </Button>
              )}
              {status === "credentials_required" ? (
                <Button
                  size="sm"
                  disabled={connectBusy}
                  onClick={() => startConnect(true)}
                >
                  Reconnect LinkedIn
                </Button>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
