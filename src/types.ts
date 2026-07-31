export type AgentSessionKind = "id" | "path";

export interface AgentSession {
  readonly source: string;
  readonly agent: string;
  readonly kind: AgentSessionKind;
  readonly value: string;
}

export interface LayoutPaneNode {
  readonly type: "pane";
  readonly pane_id?: string;
  readonly label?: string;
  readonly cwd?: string;
  readonly command?: string[];
  readonly env?: Record<string, string>;
}

export interface LayoutSplitNode {
  readonly type: "split";
  readonly direction: "right" | "down";
  readonly ratio: number;
  readonly first: LayoutNode;
  readonly second: LayoutNode;
}

export type LayoutNode = LayoutPaneNode | LayoutSplitNode;

export interface LayoutDescription {
  readonly workspace_id: string;
  readonly tab_id: string;
  readonly zoomed: boolean;
  readonly focused_pane_id: string;
  readonly root: LayoutNode;
}

export interface PaneInfo {
  readonly pane_id: string;
  readonly cwd?: string;
  readonly label?: string;
  readonly agent?: string;
  readonly agent_session?: AgentSession;
}

export interface TabInfo {
  readonly tab_id: string;
  readonly workspace_id: string;
  readonly label?: string;
  readonly number: number;
  readonly focused: boolean;
}

export interface WorkspaceInfo {
  readonly workspace_id: string;
  readonly label: string;
  readonly active_tab_id?: string;
}

export interface SuspendedTab {
  readonly label: string | null;
  readonly zoomed: boolean;
  readonly focused_pane_id: string | null;
  readonly root: LayoutNode;
}

export interface SuspendedWorkspace {
  readonly schema_version: 1;
  readonly id: string;
  readonly suspended_at: string;
  readonly label: string;
  readonly cwd: string;
  readonly active_tab_index: number;
  readonly tabs: SuspendedTab[];
}
