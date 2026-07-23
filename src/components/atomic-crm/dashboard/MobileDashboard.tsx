// Agent H, task #34 (2026-07-22): reconciling the two divergent home
// screens. Desktop's dashboard is InboxPage -- a ranked "decisions that
// need Harsha" triage queue (useInboxDecisions), replacing the old
// stat-card Dashboard. This file was never updated when that happened: it
// still rendered OpenRolesSummary (a plain "Open roles" stat-card list) and
// DashboardActivityLog, the exact CRM-flavored home screen InboxPage was
// built to replace -- so a recruiter on mobile saw a fundamentally
// different, older product than one on desktop. This rebuilds
// MobileDashboard on the SAME useInboxDecisions data/ranking used by
// InboxPage, just rendered as a simple stacked tap-list suited to touch
// and MobileLayout's chrome, instead of porting over InboxPage's fixed-
// position sidebar / j/k keyboard-shortcut grammar, neither of which make
// sense on a phone.
import { useTimeout } from "ra-core";
import { useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { useInboxDecisions, type InboxDecision } from "../inbox/useInboxDecisions";
import MobileHeader from "../layout/MobileHeader";
import { MobileContent } from "../layout/MobileContent";
import { useConfigurationContext } from "../root/ConfigurationContext";

const PRIORITY_LABEL: Record<InboxDecision["priority"], string> = {
  high: "Now",
  med: "Today",
  low: "This week",
};

const PRIORITY_VARIANT: Record<InboxDecision["priority"], "destructive" | "default" | "secondary"> = {
  high: "destructive",
  med: "default",
  low: "secondary",
};

const Wrapper = ({ children }: { children: React.ReactNode }) => {
  const { darkModeLogo, lightModeLogo, title } = useConfigurationContext();
  return (
    <>
      <MobileHeader>
        <div className="flex items-center gap-2 text-secondary-foreground no-underline py-3">
          <img
            className="[.light_&]:hidden h-6"
            src={darkModeLogo}
            alt={title}
          />
          <img
            className="[.dark_&]:hidden h-6"
            src={lightModeLogo}
            alt={title}
          />
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
      </MobileHeader>
      <MobileContent>{children}</MobileContent>
    </>
  );
};

const Loading = () => (
  <Wrapper>
    <Skeleton className="h-4 w-3/4 mb-4" />
    <Skeleton className="h-4 w-full mb-2" />
    <Skeleton className="h-4 w-full mb-2" />
    <Skeleton className="h-4 w-full mb-2" />
    <Skeleton className="h-4 w-full mb-2" />
  </Wrapper>
);

const DecisionRow = ({ decision }: { decision: InboxDecision }) => {
  const navigate = useNavigate();
  const target = decision.candidateId
    ? `/candidates/${decision.candidateId}/show`
    : decision.dealId
      ? `/roles/${decision.dealId}`
      : null;

  return (
    <Card
      className={target ? "cursor-pointer active:opacity-70" : undefined}
      onClick={target ? () => navigate(target) : undefined}
    >
      <CardContent className="flex flex-col gap-1 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{decision.title}</span>
          <Badge variant={PRIORITY_VARIANT[decision.priority]} className="shrink-0">
            {PRIORITY_LABEL[decision.priority]}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">{decision.subtitle}</span>
      </CardContent>
    </Card>
  );
};

export const MobileDashboard = () => {
  const oneSecondHasPassed = useTimeout(1000);
  const { decisions, isPending } = useInboxDecisions();

  if (!oneSecondHasPassed || isPending) {
    return <Loading />;
  }

  return (
    <Wrapper>
      <div className="flex flex-col gap-3 mt-1">
        {decisions.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              Nothing needs your attention right now.
            </CardContent>
          </Card>
        ) : (
          decisions.map((decision) => (
            <DecisionRow key={decision.id} decision={decision} />
          ))
        )}
      </div>
    </Wrapper>
  );
};
