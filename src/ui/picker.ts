import process from "node:process";

import { restoreWorkspace } from "../restore";
import { listSuspended } from "../state";
import type { SuspendedWorkspace } from "../types";

const CLEAR = "\x1b[2J\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const KEY_ENTER = "\r";
const KEY_LINEFEED = "\n";
const KEY_ESC = "\u001b";
const KEY_UP = "\u001b[A";
const KEY_DOWN = "\u001b[B";
const KEY_CTRL_C = "\u0003";
const KEY_CTRL_N = "\u000e";
const KEY_CTRL_P = "\u0010";
const KEY_CTRL_U = "\u0015";
const KEY_BACKSPACE = "\u007f";
const KEY_BACKSPACE_ALT = "\b";
const KEY_SLASH = "/";

const HEADER_LINES = 4;
const FALLBACK_ROWS = 16;

const relativeTime = (iso: string): string => {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
};

const tabCount = (snapshot: SuspendedWorkspace): string => {
  const count = snapshot.tabs.length;

  return `${count} tab${count === 1 ? "" : "s"}`;
};

const matches = (snapshot: SuspendedWorkspace, query: string): boolean => {
  const haystack = `${snapshot.label} ${snapshot.cwd}`.toLowerCase();

  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
};

const filterSnapshots = (snapshots: SuspendedWorkspace[], query: string): SuspendedWorkspace[] =>
  query.trim() === "" ? snapshots : snapshots.filter((snapshot) => matches(snapshot, query));

const typedText = (key: string): string =>
  key.startsWith(KEY_ESC)
    ? ""
    : [...key].filter((char) => char >= " " && char !== KEY_BACKSPACE).join("");

// Keep the selected entry inside the popup's viewport; the pane is short (16 rows
// by default) and the header must never scroll out of view.
const firstVisible = (count: number, selected: number, capacity: number): number => {
  if (count <= capacity) return 0;

  return Math.min(Math.max(0, selected - Math.floor(capacity / 2)), count - capacity);
};

const searchLine = (query: string, searching: boolean): string => {
  if (searching) return `${CYAN}/${RESET}${query}${DIM}▏${RESET}`;
  if (query !== "") return `${DIM}filter:${RESET} ${query}`;

  return `${DIM}/ to search${RESET}`;
};

const hintLine = (searching: boolean): string =>
  searching
    ? `${DIM}type to filter · enter to keep it · esc to discard · ctrl+u to clear${RESET}`
    : `${DIM}↑/↓ or j/k to move · enter to restore · / to search · esc to cancel${RESET}`;

const render = (
  snapshots: SuspendedWorkspace[],
  query: string,
  selected: number,
  searching: boolean,
): void => {
  const lines = [
    `${BOLD}Resume suspended workspace${RESET}`,
    hintLine(searching),
    searchLine(query, searching),
    "",
  ];

  if (snapshots.length === 0) {
    lines.push(`${DIM}${query === "" ? "No suspended workspaces." : "No matches."}${RESET}`);
  } else {
    const rows = Math.max(1, (process.stdout.rows || FALLBACK_ROWS) - HEADER_LINES - 1);
    const capacity = snapshots.length > rows ? rows - 1 : rows;
    const start = firstVisible(snapshots.length, selected, capacity);

    snapshots.slice(start, start + capacity).forEach((snapshot, index) => {
      const isSelected = start + index === selected;
      const marker = isSelected ? `${CYAN}❯${RESET}` : " ";
      const name = isSelected ? `${BOLD}${snapshot.label}${RESET}` : snapshot.label;
      const meta = `${DIM}${tabCount(snapshot)} · ${relativeTime(snapshot.suspended_at)}${RESET}`;
      lines.push(`${marker} ${name}  ${meta}`);
    });

    if (snapshots.length > capacity) {
      lines.push(`${DIM}  …${snapshots.length - capacity - start} more${RESET}`);
    }
  }

  process.stdout.write(`${CLEAR}${HIDE_CURSOR}${lines.join("\n")}\n`);
};

const waitForAnyKey = (message: string, code: number): Promise<never> =>
  new Promise((resolve) => {
    process.stdout.write(`${CLEAR}${SHOW_CURSOR}${message}\n${DIM}press any key to close${RESET}\n`);
    setRaw(true);
    process.stdin.resume();
    process.stdin.once("data", () => process.exit(code));
    void resolve;
  });

const setRaw = (enabled: boolean): void => {
  const stdin = process.stdin as typeof process.stdin & { setRawMode?: (mode: boolean) => void };
  if (stdin.isTTY && typeof stdin.setRawMode === "function") stdin.setRawMode(enabled);
};

const readKey = (): Promise<string> =>
  new Promise((resolve) => {
    process.stdin.once("data", (chunk: Buffer) => resolve(chunk.toString("utf8")));
  });

export const runPicker = async (): Promise<void> => {
  const snapshots = await listSuspended();

  if (snapshots.length === 0) {
    await waitForAnyKey(`${DIM}No suspended workspaces.${RESET}`, 0);
  }

  setRaw(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  let query = "";
  let filtered = snapshots;
  let selected = 0;
  let searching = false;
  let committedQuery = "";

  const applyQuery = (next: string): void => {
    query = next;
    filtered = filterSnapshots(snapshots, query);
    selected = 0;
  };

  const quit = (): never => {
    process.stdout.write(`${CLEAR}${SHOW_CURSOR}`);
    setRaw(false);
    process.exit(0);
  };

  render(filtered, query, selected, searching);

  let snapshot: SuspendedWorkspace | undefined;

  while (true) {
    const key = await readKey();

    if (key === KEY_CTRL_C) quit();

    if (key === KEY_CTRL_U) {
      applyQuery("");
      committedQuery = "";
    } else if (key === KEY_UP || key === KEY_CTRL_P) {
      selected = filtered.length === 0 ? 0 : (selected - 1 + filtered.length) % filtered.length;
    } else if (key === KEY_DOWN || key === KEY_CTRL_N) {
      selected = filtered.length === 0 ? 0 : (selected + 1) % filtered.length;
    } else if (searching) {
      if (key === KEY_ENTER || key === KEY_LINEFEED) {
        committedQuery = query;
        searching = false;
      } else if (key === KEY_ESC) {
        applyQuery(committedQuery);
        searching = false;
      } else if (key === KEY_BACKSPACE || key === KEY_BACKSPACE_ALT) {
        applyQuery(query.slice(0, -1));
      } else if (typedText(key) !== "") {
        applyQuery(`${query}${typedText(key)}`);
      }
    } else {
      if (key === KEY_ESC) quit();

      if (key === KEY_ENTER || key === KEY_LINEFEED) {
        if (filtered.length === 0) continue;

        snapshot = filtered[selected];
        break;
      }

      if (key === KEY_SLASH) {
        searching = true;
      } else if (key === "k") {
        selected = filtered.length === 0 ? 0 : (selected - 1 + filtered.length) % filtered.length;
      } else if (key === "j") {
        selected = filtered.length === 0 ? 0 : (selected + 1) % filtered.length;
      }
    }

    render(filtered, query, selected, searching);
  }

  setRaw(false);
  process.stdout.write(`${CLEAR}${SHOW_CURSOR}Restoring ${BOLD}${snapshot.label}${RESET}…\n`);

  try {
    await restoreWorkspace(snapshot.id);
    process.exit(0);
  } catch (err) {
    await waitForAnyKey(
      `${BOLD}Could not restore${RESET} ${snapshot.label}\n${err instanceof Error ? err.message : String(err)}`,
      1,
    );
  }
};
