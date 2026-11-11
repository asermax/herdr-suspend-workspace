import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createHerdrClient, type HerdrClient } from "./herdr-client";
import { pairPaneCommands, stripCommands } from "./layout";
import { clearTemporaryName, relaunchPane } from "./relaunch";
import { shellCommandFromArgv } from "./shell";
import { readSnapshot, removeSnapshot } from "./state";
import type { SuspendedWorkspace } from "./types";

const rebuildTabs = async (
  client: HerdrClient,
  snapshot: SuspendedWorkspace,
  workspaceId: string,
  defaultTabId: string,
): Promise<RebuiltTabs> => {
  const newTabIds: string[] = [];
  const failedCommands: string[] = [];
  const temporaryNames: string[] = [];

  for (const [index, tab] of snapshot.tabs.entries()) {
    // The first apply replaces the workspace's starter tab; the rest append new
    // tabs to the rebuilt workspace.
    const layout = await client.layoutApply({
      ...(index === 0 ? { tab_id: defaultTabId } : { workspace_id: workspaceId }),
      focus: false,
      root: stripCommands(tab.root),
    });

    newTabIds.push(layout.tab_id);

    // Commands run inside each pane's shell rather than as the pane process,
    // mirroring herdr's own restart restore: when the agent exits the shell is
    // still there, so the pane and its tab survive. A failed launch doesn't stop
    // the rest of the restore; it's reported once the workspace is back.
    const commands = pairPaneCommands(tab.root, layout.root);
    const results = await Promise.allSettled(
      commands.map((command) => relaunchPane(client, command)),
    );
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        failedCommands.push(shellCommandFromArgv(commands[i].argv));
      } else if (result.value) {
        temporaryNames.push(result.value);
      }
    });

    // The label is restored by rename, not layout.apply: a tab_created carrying
    // an agent name (e.g. "pi") makes label-driven plugins such as
    // asermax.tab-command start that agent themselves, racing the resume command
    // just typed. Rename does not re-fire tab_created.
    if (tab.label) {
      await client.tabRename(layout.tab_id, tab.label);
    }

    if (tab.zoomed && layout.focused_pane_id) {
      await client.paneZoom(layout.focused_pane_id, "on");
    }
  }

  return { tabIds: newTabIds, failedCommands, temporaryNames };
};

interface RebuiltTabs {
  readonly tabIds: string[];
  readonly failedCommands: string[];
  // Unnamed agents started under a throwaway name, cleared once in view.
  readonly temporaryNames: string[];
}

// What's left once the workspace is in view: clearing throwaway agent names
// and telling the user how the restore went.
export interface RestoreFollowUp {
  readonly label: string;
  readonly failedCommands: string[];
  readonly temporaryNames: string[];
}

export const finishRestore = async (client: HerdrClient, followUp: RestoreFollowUp): Promise<void> => {
  const { label, failedCommands, temporaryNames } = followUp;

  // An agent waiting on a startup prompt keeps its launch pending until
  // someone answers it, so this can take a while.
  const cleared = await Promise.allSettled(
    temporaryNames.map((name) => clearTemporaryName(client, name)),
  );
  const keptNames = temporaryNames.filter((_, i) => cleared[i].status === "rejected");

  const failed = failedCommands.length;
  const title = failed === 0
    ? "Workspace restored"
    : `Workspace restored, ${failed} agent${failed === 1 ? "" : "s"} may not have started`;
  const details = [label];
  // A launch that errored or timed out can still have started, so don't tell
  // the user to rerun it blindly.
  if (failed > 0) details.push(`if the pane shows a plain shell, run: ${failedCommands.join(" ; ")}`);
  if (keptNames.length > 0) {
    details.push(
      `still named ${keptNames.join(", ")}; clear with: ${keptNames
        .map((name) => `herdr agent rename ${name} --clear`)
        .join(" ; ")}`,
    );
  }
  await client.notificationShow(title, details.join(" · "));
};

const FINISH_SCRIPT = fileURLToPath(new URL("../bin/finish-restore.ts", import.meta.url));

// Restore usually runs inside the picker popup, which takes all terminal input
// until its process exits, so the user couldn't answer an agent's startup
// prompt while finishRestore waits on it. A detached process does that wait
// instead, and the popup closes right away.
const finishInBackground = (followUp: RestoreFollowUp): boolean => {
  try {
    spawn(process.execPath, [FINISH_SCRIPT, JSON.stringify(followUp)], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return true;
  } catch {
    return false;
  }
};

export interface RestoreResult {
  readonly workspace_id: string;
  readonly label: string;
}

export const restoreWorkspace = async (id: string): Promise<RestoreResult> => {
  const snapshot = await readSnapshot(id);
  if (!snapshot) throw new Error(`No suspended workspace matching '${id}'.`);

  const client = createHerdrClient();
  const workspace = await client.workspaceCreate({
    cwd: snapshot.cwd,
    label: snapshot.label,
    focus: false,
  });
  const workspaceId = workspace.workspace_id as string;

  const tabs = await client.tabList(workspaceId);
  const defaultTabId = tabs[0]?.tab_id;
  if (!defaultTabId) throw new Error("Rebuilt workspace has no starter tab.");

  const { tabIds: newTabIds, failedCommands, temporaryNames } = await rebuildTabs(
    client,
    snapshot,
    workspaceId,
    defaultTabId,
  );

  const activeTabId =
    newTabIds[snapshot.active_tab_index] ?? newTabIds[0] ?? defaultTabId;
  await client.tabFocus(activeTabId);
  await client.workspaceFocus(workspaceId);

  await removeSnapshot(id);

  const followUp: RestoreFollowUp = { label: snapshot.label, failedCommands, temporaryNames };
  if (temporaryNames.length === 0 || !finishInBackground(followUp)) {
    await finishRestore(client, followUp);
  }

  return { workspace_id: workspaceId, label: snapshot.label };
};
