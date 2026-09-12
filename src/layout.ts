import type { LayoutNode } from "./types";

export interface PaneCommand {
  readonly pane_id: string;
  readonly argv: string[];
}

export const stripCommands = (node: LayoutNode): LayoutNode => {
  if (node.type === "split") {
    return {
      ...node,
      first: stripCommands(node.first),
      second: stripCommands(node.second),
    };
  }

  const { command, ...pane } = node;

  return pane;
};

// layout.apply returns a tree with the same shape as the one submitted, only
// with fresh pane ids, so walking both in lockstep pairs each snapshot command
// with the pane that now hosts it.
export const pairPaneCommands = (snapshot: LayoutNode, applied: LayoutNode): PaneCommand[] => {
  if (snapshot.type === "split" && applied.type === "split") {
    return [
      ...pairPaneCommands(snapshot.first, applied.first),
      ...pairPaneCommands(snapshot.second, applied.second),
    ];
  }

  if (
    snapshot.type === "pane" &&
    applied.type === "pane" &&
    snapshot.command?.length &&
    applied.pane_id
  ) {
    return [{ pane_id: applied.pane_id, argv: snapshot.command }];
  }

  return [];
};
