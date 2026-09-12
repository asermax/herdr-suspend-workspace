import { createHerdrClient, type HerdrClient } from "./herdr-client";
import { pairPaneCommands, stripCommands } from "./layout";
import { shellCommandFromArgv } from "./shell";
import { readSnapshot, removeSnapshot } from "./state";
import type { SuspendedWorkspace } from "./types";

const rebuildTabs = async (
  client: HerdrClient,
  snapshot: SuspendedWorkspace,
  workspaceId: string,
  defaultTabId: string,
): Promise<string[]> => {
  const newTabIds: string[] = [];

  for (const [index, tab] of snapshot.tabs.entries()) {
    // The first apply replaces the workspace's starter tab; the rest append new
    // tabs to the rebuilt workspace.
    const layout = await client.layoutApply({
      ...(index === 0 ? { tab_id: defaultTabId } : { workspace_id: workspaceId }),
      ...(tab.label ? { tab_label: tab.label } : {}),
      focus: false,
      root: stripCommands(tab.root),
    });

    newTabIds.push(layout.tab_id);

    // Commands are typed into each pane's shell rather than spawned as the pane
    // process, mirroring herdr's own restart restore: when the agent exits the
    // shell is still there, so the pane and its tab survive.
    for (const { pane_id, argv } of pairPaneCommands(tab.root, layout.root)) {
      await client.paneSendInput(pane_id, shellCommandFromArgv(argv), ["Enter"]);
    }

    if (tab.zoomed && layout.focused_pane_id) {
      await client.paneZoom(layout.focused_pane_id, "on");
    }
  }

  return newTabIds;
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

  const newTabIds = await rebuildTabs(client, snapshot, workspaceId, defaultTabId);

  const activeTabId =
    newTabIds[snapshot.active_tab_index] ?? newTabIds[0] ?? defaultTabId;
  await client.tabFocus(activeTabId);
  await client.workspaceFocus(workspaceId);

  await removeSnapshot(id);
  await client.notificationShow("Workspace restored", snapshot.label);

  return { workspace_id: workspaceId, label: snapshot.label };
};
