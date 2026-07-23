import { Draggable } from "@hello-pangea/dnd";
import { useRedirect, RecordContextProvider } from "ra-core";
import { ReferenceField } from "@/components/admin/reference-field";
import { NumberField } from "@/components/admin/number-field";
import { SelectField } from "@/components/admin/select-field";
import { Card, CardContent } from "@/components/ui/card";

import { CompanyAvatar } from "../companies/CompanyAvatar";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";

export const DealCard = ({ deal, index }: { deal: Deal; index: number }) => {
  if (!deal) return null;

  return (
    <Draggable draggableId={String(deal.id)} index={index}>
      {(provided, snapshot) => (
        <DealCardContent provided={provided} snapshot={snapshot} deal={deal} />
      )}
    </Draggable>
  );
};

export const DealCardContent = ({
  provided,
  snapshot,
  deal,
}: {
  provided?: any;
  snapshot?: any;
  deal: Deal;
}) => {
  const { dealCategories, currency } = useConfigurationContext();
  const redirect = useRedirect();
  // Role Workspace (2026-07-19): clicking a role card now opens the full
  // `/roles/:id` workspace (JD summary + sourcing/calibration + pipeline +
  // notes, all on one screen) instead of the old quick-look DealShow
  // dialog -- the dialog stayed useful for a fast glance at deal-shaped
  // fields (amount, stage, contacts), but Agent H's actual work on a role
  // (sourcing, calibrating, tracking candidates) never lived there. The
  // dialog view is still reachable directly at /deals/:id/show if ever
  // needed; nothing was deleted, just no longer the default click target.
  const handleClick = () => {
    redirect(`/roles/${deal.id}`, undefined, undefined, undefined, {
      _scrollToTop: false,
    });
  };

  return (
    <div
      className="cursor-pointer"
      {...provided?.draggableProps}
      {...provided?.dragHandleProps}
      ref={provided?.innerRef}
      onClick={handleClick}
    >
      <RecordContextProvider value={deal}>
        <Card
          className={`py-4 rounded-xl border-border/70 shadow-none transition-all duration-200 ${
            snapshot?.isDragging
              ? "opacity-90 transform rotate-1 border-primary/40 bg-accent/40"
              : "hover:border-primary/30 hover:bg-accent/20"
          }`}
        >
          <CardContent className="px-4 flex flex-col gap-2.5">
            <div className="flex-1 flex items-start gap-2">
              <p className="flex-1 text-sm font-medium leading-snug">
                <ReferenceField
                  source="company_id"
                  reference="companies"
                  link={false}
                />
                {" - "}
                {deal.name}
              </p>
              <ReferenceField
                source="company_id"
                reference="companies"
                link={false}
              >
                <CompanyAvatar width={20} height={20} />
              </ReferenceField>
            </div>
            <p className="text-xs text-muted-foreground">
              <NumberField
                source="amount"
                options={{
                  notation: "compact",
                  style: "currency",
                  currency,
                  currencyDisplay: "narrowSymbol",
                  minimumSignificantDigits: 3,
                }}
              />
              {deal.category && ", "}
              <SelectField
                source="category"
                choices={dealCategories}
                optionText="label"
                optionValue="value"
              />
            </p>
          </CardContent>
        </Card>
      </RecordContextProvider>
    </div>
  );
};
