import type { ReactNode } from "react";
import { CommandBar } from "../inbox/CommandBar";
import { ContextStrip } from "./ContextStrip";
import type { AgentHShellCommandBarProps, ShellContext } from "./types";

type AgentHShellProps = {
  context: ShellContext;
  commandBar?: AgentHShellCommandBarProps;
  children: ReactNode;
};

// Command bar is position:fixed to the viewport bottom so it cannot be
// pushed below the fold by tall role content or a broken %/flex height
// chain (Suspense/ErrorBoundary ancestors often lack an explicit height,
// so height:100% + grid 1fr was unreliable). Spacer keeps content clear.
const COMMAND_BAR_SPACER_PX = 96;

export const AgentHShell = ({
  context,
  commandBar,
  children,
}: AgentHShellProps) => {
  return (
    <div className="ah-scope flex flex-col h-full min-h-0 w-full">
      <ContextStrip context={context} />
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
      {commandBar && (
        <>
          <div
            aria-hidden
            className="shrink-0"
            style={{ height: COMMAND_BAR_SPACER_PX }}
          />
          <div
            className="ah-command-bar-dock"
            style={{
              position: "fixed",
              bottom: 0,
              right: 0,
              zIndex: 45,
              background: "var(--background)",
            }}
          >
            <CommandBar
              placeholder={commandBar.placeholder}
              hint={commandBar.hint}
              slashActions={commandBar.slashActions}
              onSubmit={commandBar.onSubmit}
              busy={commandBar.busy}
            />
          </div>
        </>
      )}
    </div>
  );
};
