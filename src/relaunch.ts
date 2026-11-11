import { randomUUID } from "node:crypto";

import { HerdrError, type HerdrClient } from "./herdr-client";
import type { PaneCommand } from "./layout";
import { shellCommandFromArgv } from "./shell";

const AGENT_START_TIMEOUT_MS = 30_000;
// A pane fresh from layout.apply reports agent_pane_busy until its shell is up.
const SHELL_READY_WAIT_MS = 10_000;
const RETRY_INTERVAL_MS = 250;

// agent.start rejects these before it types anything into the pane, so typing
// the resume command ourselves afterwards can't double it up.
const REJECTED_BEFORE_LAUNCH = new Set([
  "unsupported_agent_kind",
  "agent_pane_busy",
  "agent_pane_not_found",
  "invalid_agent_name",
  "agent_name_taken",
]);

const hasCode = (err: unknown, code: string): boolean =>
  err instanceof HerdrError && err.code === code;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// agent.start needs a name. Unnamed agents get a throwaway one that is cleared
// once the agent is up.
const throwawayName = (): string => `restore-${randomUUID().slice(0, 8)}`;

// A throwaway name still on an agent (cleanup didn't finish, or the user didn't
// clear it) is not the user's; suspend saves it as no name.
export const isThrowawayName = (name: string): boolean => /^restore-[0-9a-f]{8}$/.test(name);

const typeCommand = (client: HerdrClient, { pane_id, argv }: PaneCommand): Promise<void> =>
  client.paneSendInput(pane_id, shellCommandFromArgv(argv), ["Enter"]);

// Retry `action` while herdr answers with `code`, up to `waitMs`.
const retryWhile = async (code: string, waitMs: number, action: () => Promise<unknown>) => {
  const deadline = Date.now() + waitMs;

  while (true) {
    try {
      await action();
      return;
    } catch (err) {
      if (!hasCode(err, code) || Date.now() > deadline) throw err;
      await sleep(RETRY_INTERVAL_MS);
    }
  }
};

// Relaunch one saved pane command. Agents go through agent.start, which types
// the resume command into the pane's shell like herdr's own restart restore,
// and also records the conversation in herdr, so the agent can be suspended or
// restored again later. Some agents (Codex) can't report their conversation
// from their own hooks, and typing the command alone loses it. Snapshots
// without agent info, and launches agent.start refuses up front, fall back to
// typing the command.
//
// Resolves to the throwaway name an unnamed agent was started under, for
// clearTemporaryName once the workspace is in view, or null when there is none.
// It rejects only when the agent didn't start.
export const relaunchPane = async (client: HerdrClient, command: PaneCommand): Promise<string | null> => {
  const { agent } = command;
  if (!agent) {
    await typeCommand(client, command);
    return null;
  }

  const names = agent.name ? [agent.name, throwawayName()] : [throwawayName()];

  for (const name of names) {
    try {
      await retryWhile("agent_pane_busy", SHELL_READY_WAIT_MS, () =>
        client.agentStart({
          name,
          kind: agent.kind,
          pane_id: command.pane_id,
          args: command.argv.slice(1),
          timeout_ms: AGENT_START_TIMEOUT_MS,
        }),
      );
    } catch (err) {
      if (hasCode(err, "agent_name_taken")) continue;
      // Launched, but waiting on a startup prompt; it keeps the name.
      if (hasCode(err, "agent_not_ready")) return name === agent.name ? null : name;
      if (err instanceof HerdrError && REJECTED_BEFORE_LAUNCH.has(err.code)) {
        await typeCommand(client, command);
        return null;
      }
      throw err;
    }

    return name === agent.name ? null : name;
  }

  await typeCommand(client, command);
  return null;
};

// Clear the throwaway name of an agent started by relaunchPane. herdr refuses
// renames while the launch is pending, which lasts until the agent is ready, or
// indefinitely while it waits on a startup prompt (e.g. an update notice).
// It targets the name, not the pane, so an agent that replaced this one in the
// pane keeps its own name. Rejects if the name couldn't be cleared; the agent
// itself keeps running.
export const clearTemporaryName = async (client: HerdrClient, name: string): Promise<void> => {
  try {
    await retryWhile("agent_launch_pending", AGENT_START_TIMEOUT_MS, () =>
      client.agentRename(name, null),
    );
  } catch (err) {
    // The agent exited or was replaced, and herdr dropped the name with it.
    if (!hasCode(err, "agent_not_found")) throw err;
  }
};
