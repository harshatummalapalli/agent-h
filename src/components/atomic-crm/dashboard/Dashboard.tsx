// Agent H: this used to gate the whole home screen behind a
// contacts-first CRM onboarding wizard (DashboardStepper -- "Install
// Atomic CRM" / "Add your first contact") that never resolved for an
// ATS workflow, since this product's data starts from a role/candidate,
// not a contact. That's the confusing "What's next?" screen flagged
// earlier in the build. Replaced with an ATS-relevant home view --
// open roles + sourcing volume up front, activity/tasks alongside --
// that renders immediately regardless of how many contacts exist.
// See "remove all CRM specific language" pass (2026-07-12).
import { DashboardActivityLog } from "./DashboardActivityLog";
import { OpenRolesSummary } from "./OpenRolesSummary";
import { TasksList } from "./TasksList";

export const Dashboard = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 mt-1">
      <div className="md:col-span-6">
        <OpenRolesSummary />
      </div>

      <div className="md:col-span-3">
        <DashboardActivityLog />
      </div>

      <div className="md:col-span-3">
        <TasksList />
      </div>
    </div>
  );
};
