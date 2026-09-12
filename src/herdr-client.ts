import { createConnection } from "node:net";

const DEFAULT_TIMEOUT_MS = 15_000;

export class HerdrError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HerdrError";
  }
}

const resolveSocketPath = (): string => {
  if (process.env.HERDR_SOCKET_PATH) return process.env.HERDR_SOCKET_PATH;

  const home = process.env.HOME ?? "";
  return `${home}/.config/herdr/herdr.sock`;
};

interface RpcEnvelope {
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

const send = (method: string, params: Record<string, unknown>): Promise<any> =>
  new Promise((resolve, reject) => {
    const socketPath = resolveSocketPath();
    let socket: ReturnType<typeof createConnection>;
    try {
      socket = createConnection(socketPath);
    } catch (err) {
      reject(err);
      return;
    }

    let buffer = "";
    let settled = false;
    const timer = setTimeout(
      () => finish(() => reject(new HerdrError("timeout", `herdr '${method}' timed out`))),
      DEFAULT_TIMEOUT_MS,
    );

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      action();
    };

    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id: `suspend:${method}`, method, params })}\n`);
    });

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;

      const line = buffer.slice(0, newline);
      finish(() => {
        let parsed: RpcEnvelope;
        try {
          parsed = JSON.parse(line);
        } catch {
          reject(new HerdrError("parse_error", `unparseable response from '${method}'`));
          return;
        }
        if (parsed.error) {
          reject(new HerdrError(parsed.error.code, parsed.error.message));
          return;
        }
        resolve(parsed.result);
      });
    });

    socket.on("error", (err) => finish(() => reject(err)));
  });

export interface HerdrClient {
  workspaceGet: (workspaceId: string) => Promise<any>;
  workspaceCreate: (params: { cwd?: string; label?: string; focus?: boolean }) => Promise<any>;
  workspaceClose: (workspaceId: string) => Promise<void>;
  workspaceFocus: (workspaceId: string) => Promise<void>;
  tabList: (workspaceId: string) => Promise<any[]>;
  tabFocus: (tabId: string) => Promise<void>;
  paneList: (workspaceId: string) => Promise<any[]>;
  layoutExport: (tabId: string) => Promise<any>;
  layoutApply: (params: Record<string, unknown>) => Promise<any>;
  paneZoom: (paneId: string, mode: "on" | "off" | "toggle") => Promise<void>;
  paneSendInput: (paneId: string, text: string, keys: string[]) => Promise<void>;
  pluginPaneOpen: (params: Record<string, unknown>) => Promise<void>;
  notificationShow: (title: string, body?: string) => Promise<void>;
}

export const createHerdrClient = (): HerdrClient => ({
  workspaceGet: (workspaceId) =>
    send("workspace.get", { workspace_id: workspaceId }).then((r) => r.workspace),

  workspaceCreate: (params) => send("workspace.create", params).then((r) => r.workspace),

  workspaceClose: (workspaceId) =>
    send("workspace.close", { workspace_id: workspaceId }).then(() => undefined),

  workspaceFocus: (workspaceId) =>
    send("workspace.focus", { workspace_id: workspaceId }).then(() => undefined),

  tabList: (workspaceId) =>
    send("tab.list", { workspace_id: workspaceId }).then((r) => (r?.tabs ?? []) as any[]),

  tabFocus: (tabId) => send("tab.focus", { tab_id: tabId }).then(() => undefined),

  paneList: (workspaceId) =>
    send("pane.list", { workspace_id: workspaceId }).then((r) => (r?.panes ?? []) as any[]),

  layoutExport: (tabId) => send("layout.export", { tab_id: tabId }).then((r) => r.layout),

  layoutApply: (params) => send("layout.apply", params).then((r) => r.layout),

  paneZoom: (paneId, mode) =>
    send("pane.zoom", { pane_id: paneId, mode }).then(() => undefined),

  paneSendInput: (paneId, text, keys) =>
    send("pane.send_input", { pane_id: paneId, text, keys }).then(() => undefined),

  pluginPaneOpen: (params) => send("plugin.pane.open", params).then(() => undefined),

  notificationShow: (title, body) =>
    send("notification.show", { title, ...(body ? { body } : {}) }).then(() => undefined),
});
