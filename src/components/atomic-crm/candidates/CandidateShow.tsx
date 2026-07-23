// Agent H Stage 3, candidate-visibility follow-up: candidate detail view.
// Deliberately flat (RecordField rows, no tabs/cards) -- matches the
// "simplest solution that works" bar for a v1 view; revisit only once real
// usage shows a specific section needs more room (e.g. a dedicated
// enrichment-history timeline).
import { useRecordContext } from "ra-core";
import { BadgeField } from "@/components/admin/badge-field";
import { DateField } from "@/components/admin/date-field";
import { ReferenceField } from "@/components/admin/reference-field";
import { Show } from "@/components/admin/show";
import { RecordField } from "@/components/admin/record-field";
import { UrlField } from "@/components/admin/url-field";

import type { Candidate } from "../types";

const CandidateTitle = () => {
  const record = useRecordContext<Candidate>();
  if (!record) return null;
  const name = [record.first_name, record.last_name].filter(Boolean).join(" ");
  return <span>{name || "Candidate"}</span>;
};

export const CandidateShow = () => (
  <Show title={<CandidateTitle />}>
    <div className="flex flex-col gap-4 max-w-2xl">
      <RecordField label="Current title" source="current_title" empty="—" />
      <RecordField label="Current company">
        <ReferenceField
          source="current_company_id"
          reference="companies"
          link="show"
          empty="—"
        />
      </RecordField>
      <RecordField label="LinkedIn">
        <UrlField source="linkedin_url" empty="—" />
      </RecordField>
      <RecordField label="Status">
        <BadgeField source="status" empty="—" />
      </RecordField>
      <RecordField label="Source" source="source" empty="—" />

      <RecordField label="Contact enrichment">
        <BadgeField source="contact_enrichment_status" empty="Not attempted" />
      </RecordField>
      <RecordField
        label="Contact enrichment vendor"
        source="contact_enrichment_source"
        empty="—"
      />

      <RecordField label="Dev-signal enrichment">
        <BadgeField source="devsignal_enrichment_status" empty="Not attempted" />
      </RecordField>
      <RecordField label="GitHub" source="github_username" empty="Not found" />
      <RecordField label="GitHub profile">
        <UrlField source="github_url" empty="—" />
      </RecordField>
      <RecordField label="Stack Overflow">
        <UrlField source="stackoverflow_url" empty="Not found" />
      </RecordField>

      <RecordField label="Sourced">
        <DateField source="created_at" showTime />
      </RecordField>
    </div>
  </Show>
);
