import { readdir, readFile, stat, utimes } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { LayoutNode, SuspendedWorkspace } from "./types";

// Claude Code deletes a conversation transcript
// (<config>/projects/<project>/<session>.jsonl) once its last-modified time is
// more than `cleanupPeriodDays` days old (default 30). The sweep runs silently
// whenever any Claude Code session starts. A suspended workspace's Claude
// conversations aren't running, so nothing updates them, and they can be
// deleted while the workspace is suspended, leaving nothing to resume.

const DEFAULT_CLEANUP_PERIOD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const WARN_WITHIN_DAYS = 7;

const claudeConfigDir = (): string =>
  process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || homedir(), ".claude");

// User settings only. Managed or project settings can lower the period further;
// those aren't read here.
export const readCleanupPeriodDays = async (): Promise<number> => {
  try {
    const raw = await readFile(join(claudeConfigDir(), "settings.json"), "utf8");
    const days = JSON.parse(raw)?.cleanupPeriodDays;
    if (Number.isInteger(days) && days >= 1) return days;
  } catch {
    // Missing or unreadable settings: Claude Code falls back to the default too.
  }

  return DEFAULT_CLEANUP_PERIOD_DAYS;
};

// Claude conversation ids that a snapshot resumes (`claude --resume <id>`).
export const claudeSessionIds = (snapshot: SuspendedWorkspace): string[] => {
  const ids: string[] = [];
  const walk = (node: LayoutNode): void => {
    if (node.type === "split") {
      walk(node.first);
      walk(node.second);
      return;
    }
    const [command, flag, id] = node.command ?? [];
    if (command === "claude" && flag === "--resume" && id) ids.push(id);
  };
  for (const tab of snapshot.tabs) walk(tab.root);

  return ids;
};

interface Transcript {
  readonly path: string;
  readonly mtimeMs: number;
}

const findTranscript = async (projectsDir: string, sessionId: string): Promise<Transcript | null> => {
  let projects: string[];
  try {
    projects = await readdir(projectsDir);
  } catch {
    return null;
  }

  for (const project of projects) {
    const path = join(projectsDir, project, `${sessionId}.jsonl`);
    try {
      const info = await stat(path);
      if (info.isFile()) return { path, mtimeMs: info.mtimeMs };
    } catch {
      // Not in this project.
    }
  }

  return null;
};

export interface ConversationCleanup {
  readonly sessionId: string;
  readonly transcript: string | null;
  // When the sweep may delete it; null when the transcript is already gone.
  readonly deletesAt: number | null;
}

export interface WorkspaceCleanup {
  readonly conversations: ConversationCleanup[];
  // When the first conversation still on disk may be deleted, if any is left.
  readonly soonestDeletesAt: number | null;
  // Conversations whose transcript is already gone.
  readonly deleted: number;
}

export const workspaceCleanup = async (
  snapshot: SuspendedWorkspace,
  periodDays: number,
): Promise<WorkspaceCleanup> => {
  const projectsDir = join(claudeConfigDir(), "projects");
  const conversations = await Promise.all(
    claudeSessionIds(snapshot).map(async (sessionId): Promise<ConversationCleanup> => {
      const found = await findTranscript(projectsDir, sessionId);
      if (!found) return { sessionId, transcript: null, deletesAt: null };

      return { sessionId, transcript: found.path, deletesAt: found.mtimeMs + periodDays * DAY_MS };
    }),
  );

  const pending = conversations.flatMap(({ deletesAt }) => (deletesAt === null ? [] : [deletesAt]));

  return {
    conversations,
    soonestDeletesAt: pending.length > 0 ? Math.min(...pending) : null,
    deleted: conversations.length - pending.length,
  };
};

// Whole days left, rounded down; 0 means it can go at the next sweep.
export const daysLeft = (deletesAt: number, now: number = Date.now()): number =>
  Math.max(0, Math.floor((deletesAt - now) / DAY_MS));

export const describeCleanup = (cleanup: WorkspaceCleanup, now: number = Date.now()): string | null => {
  const parts: string[] = [];
  const { soonestDeletesAt, deleted } = cleanup;

  if (deleted > 0) {
    parts.push(deleted === 1 ? "Claude conversation deleted" : `${deleted} Claude conversations deleted`);
  }
  if (soonestDeletesAt !== null) {
    const days = daysLeft(soonestDeletesAt, now);
    parts.push(days === 0 ? "Claude cleanup today" : `Claude cleanup in ${days}d`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
};

export const needsWarning = (cleanup: WorkspaceCleanup, now: number = Date.now()): boolean =>
  cleanup.soonestDeletesAt !== null && daysLeft(cleanup.soonestDeletesAt, now) <= WARN_WITHIN_DAYS;

const filesIn = async (dir: string, depth: number): Promise<string[]> => {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isFile()) return [path];
      if (entry.isDirectory() && depth > 0) return filesIn(path, depth - 1);
      return [];
    }),
  );

  return nested.flat();
};

// Reset the cleanup clock of a suspended workspace's Claude conversations by
// bumping their last-modified time. Safe because a suspended conversation isn't
// running; the content is untouched. Large tool outputs and MCP task files next
// to the transcript are swept by their own age, so they are bumped as well.
export const resetCleanupClock = async (cleanup: WorkspaceCleanup): Promise<number> => {
  const now = new Date();
  let touched = 0;

  for (const { sessionId, transcript } of cleanup.conversations) {
    if (!transcript) continue;
    const sessionDir = join(transcript, "..", sessionId);
    const extras = [
      ...(await filesIn(join(sessionDir, "tool-results"), 1)),
      ...(await filesIn(join(sessionDir, "mcp-tasks"), 0)),
    ];
    for (const path of [transcript, ...extras]) {
      try {
        await utimes(path, now, now);
        touched++;
      } catch {
        // Gone in the meantime; nothing to keep.
      }
    }
  }

  return touched;
};
