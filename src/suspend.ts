import { randomUUID } from "node:crypto";

import { resumeArgv } from "./agents";
import { createHerdrClient, type HerdrClient } from "./herdr-client";
import { saveSnapshot } from "./state";
import type { AgentSession, LayoutNode, SuspendedTab, SuspendedWorkspace } from "./types";

const resolveWorkspaceId = (): string => {
  const fromEnv = process.env.HERDR_WORKSPACE_ID;
  if (fromEnv) return fromEnv;

  const raw = process.env.HERDR_PLUGIN_CONTEXT_JSON;
  if (raw) {
    const ctx = JSON.parse(raw) as { workspace?: { workspace_id?: string }; workspace_id?: string };
    const id = ctx.workspace?.workspace_id ?? ctx.workspace_id;
    if (id) return id;
  }

  throw new Error("Could not determine which workspace to suspend.");
};

const firstPaneCwd = (node: LayoutNode): string | null => {
  if (node.type === "pane") return node.cwd ?? null;

  return firstPaneCwd(node.first) ?? firstPaneCwd(node.second);
};

// Rebuild the export tree so agent panes re-launch with their resume argv and
// the other panes keep their original launch command. Stale pane ids are
// dropped because layout.apply mints fresh ids.
const buildRestoreNode = (
  node: LayoutNode,
  agentByPane: Map<string, AgentSession>,
): LayoutNode => {
  if (node.type === "split") {
    return {
      ...node,
      first: buildRestoreNode(node.first, agentByPane),
      second: buildRestoreNode(node.second, agentByPane),
    };
  }

  const { pane_id, ...pane } = node;
  const session = pane_id ? agentByPane.get(pane_id) : undefined;
  const resume = session ? resumeArgv(session) : null;

  return { ...pane, ...(resume ? { command: resume } : {}) };
};

const collectAgentSessions = async (
  client: HerdrClient,
  workspaceId: string,
): Promise<Map<string, AgentSession>> => {
  const panes = await client.paneList(workspaceId);
  const byPane = new Map<string, AgentSession>();
  for (const pane of panes) {
    if (pane.agent_session) byPane.set(pane.pane_id, pane.agent_session);
  }

  return byPane;
};

const captureWorkspace = async (
  client: HerdrClient,
  workspaceId: string,
): Promise<SuspendedWorkspace> => {
  const workspace = await client.workspaceGet(workspaceId);
  const tabs = (await client.tabList(workspaceId)).sort((a, b) => a.number - b.number);
  const agentByPane = await collectAgentSessions(client, workspaceId);

  const layouts = await Promise.all(tabs.map((tab) => client.layoutExport(tab.tab_id)));

  const suspendedTabs: SuspendedTab[] = tabs.map((tab, index) => {
    const layout = layouts[index];
    const agentByPaneForTree = agentByPane;

    return {
      label: tab.label ?? null,
      zoomed: Boolean(layout.zoomed),
      focused_pane_id: layout.focused_pane_id ?? null,
      root: buildRestoreNode(layout.root, agentByPaneForTree),
    };
  });

  const activeTabIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.tab_id === workspace.active_tab_id),
  );
  const workspaceCwd =
    firstPaneCwd(suspendedTabs[0]?.root ?? { type: "pane" }) ??
    process.env.HOME ??
    "/";

  return {
    schema_version: 1,
    id: randomUUID(),
    suspended_at: new Date().toISOString(),
    label: workspace.label ?? "Workspace",
    cwd: workspaceCwd,
    active_tab_index: activeTabIndex,
    tabs: suspendedTabs,
  };
};

export const runSuspend = async (): Promise<void> => {
  const workspaceId = resolveWorkspaceId();
  const client = createHerdrClient();

  const snapshot = await captureWorkspace(client, workspaceId);
  await saveSnapshot(snapshot);

  // Closing the workspace removes it and its agents from the lists; the snapshot
  // already holds everything needed to rebuild it.
  await client.workspaceClose(workspaceId);
  await client.notificationShow(
    "Workspace suspended",
    `${snapshot.label} · ${snapshot.tabs.length} tab${snapshot.tabs.length === 1 ? "" : "s"}`,
  );
};
