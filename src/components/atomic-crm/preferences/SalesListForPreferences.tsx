import { useGetList } from "ra-core";
import { Badge } from "@/components/ui/badge";
import type { Sale } from "../types";

export const SalesListForPreferences = () => {
  const { data: members = [], isLoading } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 50 },
    sort: { field: "first_name", order: "ASC" },
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading team…</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {members.map((member) => (
        <div
          key={member.id}
          className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 bg-card"
        >
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium shrink-0 select-none">
            {(member.first_name?.[0] ?? "") + (member.last_name?.[0] ?? "")}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {member.first_name} {member.last_name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {member.email}
            </p>
          </div>
          {member.administrator && (
            <Badge variant="outline" className="text-xs shrink-0">
              Admin
            </Badge>
          )}
          {member.disabled && (
            <Badge
              variant="outline"
              className="text-xs text-muted-foreground shrink-0"
            >
              Disabled
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
};
