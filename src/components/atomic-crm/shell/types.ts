import type { SlashAction } from "../inbox/CommandBar";

export type ShellContext = {
  mode: "inbox" | "role";
  title: string;
  blockers: string[];
  lastAction?: string;
};

export type AgentHShellCommandBarProps = {
  placeholder: string;
  hint: string;
  slashActions: SlashAction[];
  onSubmit: (value: string) => void;
};
