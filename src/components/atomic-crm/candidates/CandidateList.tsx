// Agent H Stage 3, candidate-visibility follow-up: the first real admin
// screen for public.candidates. Until this file existed, candidates were
// stored correctly (sourcing -> save -> enrichment all worked) but there was
// no way to see them anywhere in the app except the transient search
// results on the Source Candidates screen -- this is the fix for that gap.
//
// Deliberately minimal (KISS/YAGNI): a plain DataTable, no kanban, no
// full-text search wiring, no CSV export. Add those once there's enough
// candidate volume for them to matter -- see SalesList.tsx for the same
// minimal-DataTable pattern this follows.
import { useRecordContext } from "ra-core";
import { BadgeField } from "@/components/admin/badge-field";
import { DataTable } from "@/components/admin/data-table";
import { DateField } from "@/components/admin/date-field";
import { List } from "@/components/admin/list";
import { ReferenceField } from "@/components/admin/reference-field";
import { UrlField } from "@/components/admin/url-field";
import { SelectInput } from "@/components/admin/select-input";

import type { Candidate } from "../types";

// "Verified contact" filter, per Harsha's candidate-quality-controls
// request: contact_enrichment_status is already computed (see
// supabase/schemas/21_agent_h_contact_and_devsignal_enrichment.sql) --
// this is just a filter input over it, no new data.
//
// Bug fix (2026-07-19, live E2E/security pass): a `<SearchInput source="q">`
// used to sit here too. dataProvider.ts's getList override only maps
// `companies` -> companies_summary and `contacts` -> contacts_summary for
// full-text search -- candidates was never added to that map (this file's
// own original header comment says full-text search was deliberately
// deferred). The result: typing anything into that box sent a raw `q`
// filter straight to the `candidates` table and PostgREST threw "column
// candidates.q does not exist" on every keystroke. Removed until real
// full-text search for candidates is built (would need its own
// candidates_summary view + dataProvider wiring, same pattern as
// companies/contacts).
const filters = [
  <SelectInput
    source="contact_enrichment_status"
    label="Contact"
    key="contact_enrichment_status"
    choices={[
      { id: "enriched", name: "Verified contact" },
      { id: "not_found", name: "Not found" },
      { id: "failed", name: "Failed" },
    ]}
  />,
];

const CandidateNameField = () => {
  const record = useRecordContext<Candidate>();
  if (!record) return null;
  const name = [record.first_name, record.last_name].filter(Boolean).join(" ");
  return <span>{name || "(no name on file)"}</span>;
};

export const CandidateList = () => (
  <List
    title={false}
    perPage={25}
    sort={{ field: "created_at", order: "DESC" }}
    filters={filters}
  >
    <DataTable>
      <DataTable.Col label="Name">
        <CandidateNameField />
      </DataTable.Col>
      <DataTable.Col source="current_title" label="Title" />
      <DataTable.Col label="Company">
        <ReferenceField
          source="current_company_id"
          reference="companies"
          link="show"
          empty="—"
        />
      </DataTable.Col>
      <DataTable.Col label="LinkedIn">
        <UrlField source="linkedin_url" empty="—" />
      </DataTable.Col>
      <DataTable.Col label="Status">
        <BadgeField source="status" empty="—" />
      </DataTable.Col>
      <DataTable.Col label="Contact enrichment">
        <BadgeField source="contact_enrichment_status" empty="Not attempted" />
      </DataTable.Col>
      <DataTable.Col label="Dev-signal enrichment">
        <BadgeField source="devsignal_enrichment_status" empty="Not attempted" />
      </DataTable.Col>
      <DataTable.Col source="created_at" label="Sourced">
        <DateField source="created_at" />
      </DataTable.Col>
    </DataTable>
  </List>
);
