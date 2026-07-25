import { useGetList } from "ra-core";
import type { RoleConversationTurn } from "../types";

type RoleConversationTranscriptProps = {
  dealId: string;
};

export const RoleConversationTranscript = ({
  dealId,
}: RoleConversationTranscriptProps) => {
  const {
    data: turns,
    isPending,
    isError,
  } = useGetList<RoleConversationTurn>("role_conversation_turns", {
    filter: { deal_id: dealId },
    sort: { field: "created_at", order: "ASC" },
    pagination: { page: 1, perPage: 50 },
  });

  return (
    <div className="ah-panel p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
          Conversation
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Shared with everyone assigned to this role. Agent replies will appear
          here once Phase C wiring lands.
        </p>
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading conversation…</p>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">
          Conversation history is not available yet — apply the latest database
          migration.
        </p>
      ) : !turns?.length ? (
        <p className="text-sm text-muted-foreground">
          Ask Agent H anything about this role using the command bar below. Your
          messages will show up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-3 max-h-64 overflow-y-auto">
          {turns.map((turn) => (
            <li key={turn.id} className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {turn.speaker === "agent" ? "Agent H" : "You"}
              </span>
              <span className="whitespace-pre-wrap">{turn.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
