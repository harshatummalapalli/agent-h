import type { ReactNode } from "react";
import { CommandBar } from "../inbox/CommandBar";
import { ContextStrip } from "./ContextStrip";
import type { AgentHShellCommandBarProps, ShellContext } from "./types";

type AgentHShellProps = {
  context: ShellContext;
  commandBar?: AgentHShellCommandBarProps;
  children: ReactNode;
};

export const AgentHShell = ({
  context,
  commandBar,
  children,
}: AgentHShellProps) => {
  return (
    <div
      className="ah-scope h-full min-h-0"
      style={{
        display: "grid",
        gridTemplateRows: commandBar
          ? "auto minmax(0, 1fr) auto"
          : "auto minmax(0, 1fr)",
        height: "100%",
        maxHeight: "100%",
      }}
    >
      <ContextStrip context={context} />
      <div
        style={{
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
      {commandBar && (
        <CommandBar
          placeholder={commandBar.placeholder}
          hint={commandBar.hint}
          slashActions={commandBar.slashActions}
          onSubmit={commandBar.onSubmit}
        />
      )}
    </div>
  );
};
