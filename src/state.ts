import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SuspendedWorkspace } from "./types";

const stateDir = (): string => {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!dir) {
    throw new Error(
      "HERDR_PLUGIN_STATE_DIR is not set; this command must run inside a herdr plugin context.",
    );
  }

  return dir;
};

const suspendedDir = (): string => join(stateDir(), "suspended");

export const listSuspended = async (): Promise<SuspendedWorkspace[]> => {
  let entries: string[];
  try {
    entries = await readdir(suspendedDir());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const ids = entries.filter((entry) => entry.endsWith(".json")).map((entry) => entry.slice(0, -5));
  const snapshots = await Promise.all(ids.map(readSnapshot));

  return snapshots
    .filter((snapshot): snapshot is SuspendedWorkspace => snapshot !== null)
    .sort((a, b) => b.suspended_at.localeCompare(a.suspended_at));
};

export const readSnapshot = async (id: string): Promise<SuspendedWorkspace | null> => {
  try {
    const raw = await readFile(join(suspendedDir(), `${id}.json`), "utf8");

    return JSON.parse(raw) as SuspendedWorkspace;
  } catch {
    return null;
  }
};

export const saveSnapshot = async (snapshot: SuspendedWorkspace): Promise<void> => {
  await mkdir(suspendedDir(), { recursive: true });
  await writeFile(
    join(suspendedDir(), `${snapshot.id}.json`),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
};

export const removeSnapshot = async (id: string): Promise<void> => {
  await rm(join(suspendedDir(), `${id}.json`), { force: true });
};
