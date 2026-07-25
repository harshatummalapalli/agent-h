import type { ReactNode } from "react";
import { CommandBar } from "../inbox/CommandBar";
import { ContextStrip } from "./ContextStrip";
import type { AgentHShellCommandBarProps, ShellContext } from "./types";

type AgentHShellProps = {
  context: ShellContext;
  commandBar: AgentHShellCommandBarProps;
  children: ReactNode;
};

export const AgentHShell = ({
  context,
  commandBar,
  children,
}: AgentHShellProps) => {
  return (
    <div
      className="ah-scope"
      style={{
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        minHeight: "calc(100dvh - 8rem)",
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
      <CommandBar
        placeholder={commandBar.placeholder}
        hint={commandBar.hint}
        slashActions={commandBar.slashActions}
        onSubmit={commandBar.onSubmit}
      />
    </div>
  );
};
