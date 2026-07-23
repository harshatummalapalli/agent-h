// Agent H, Triage Inbox + Command Canvas: a shared "what has Agent H done"
// log for the command bar. Deliberately NOT backed by a new database table
// -- the existing activity_log resource is CRM-object-change-oriented
// (contact/company/deal created, etc, see ActivityLog.tsx) and extending it
// for agent-command events would need its own migration + triggers. This
// is a lighter first pass: a module-level store (survives navigating
// between InboxPage and CanvasPage within the same session, cleared on a
// full page reload) using useSyncExternalStore so both pages can render
// the same live log without prop drilling or a React context provider.
import { useSyncExternalStore } from "react";

export type ActivityEntry = {
  id: string;
  createdAt: number;
  // "info" is for a correctly-handled "I can't do that yet" reply (e.g. an
  // unrecognized command) -- distinct from "error" (something actually
  // failed) so the log doesn't show a red/alarming dot for normal traffic.
  status: "pending" | "success" | "error" | "info";
  summary: string;
};

const MAX_ENTRIES = 50;
let entries: ActivityEntry[] = [];
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

// Adds a new entry and returns its id, so the caller can later update it
// in place (e.g. "Sourcing…" -> "Found 6, saved 6") via updateActivityEntry
// instead of leaving a separate "started"/"finished" pair in the log.
export const addActivityEntry = (summary: string, status: ActivityEntry["status"] = "pending"): string => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  entries = [{ id, createdAt: Date.now(), status, summary }, ...entries].slice(0, MAX_ENTRIES);
  notify();
  return id;
};

export const updateActivityEntry = (id: string, patch: Partial<Pick<ActivityEntry, "status" | "summary">>) => {
  entries = entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
  notify();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => entries;

export const useAgentActivityLog = () => useSyncExternalStore(subscribe, getSnapshot);
