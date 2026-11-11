import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { daysLeft, needsWarning, readCleanupPeriodDays, workspaceCleanup } from "./cleanup";
import { createHerdrClient } from "./herdr-client";
import { listSuspended } from "./state";

// At most one warning a day: the check runs on server startup, after a suspend,
// and whenever a workspace is created.
const WARN_INTERVAL_MS = 24 * 60 * 60 * 1000;

// A lock older than this was left by a check that died; checks finish in
// well under a second.
const STALE_LOCK_MS = 60 * 1000;

const stampPath = (): string | null => {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;

  return dir ? join(dir, "cleanup-warning.json") : null;
};

// The checks run as separate processes (startup, workspace.created, after a
// suspend) and can overlap. Only the one that creates the lock file warns.
const tryLock = async (lockPath: string): Promise<boolean> => {
  await mkdir(join(lockPath, ".."), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await (await open(lockPath, "wx")).close();
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const age = await stat(lockPath).then((info) => Date.now() - info.mtimeMs, () => 0);
      if (age < STALE_LOCK_MS) return false;
      await unlink(lockPath).catch(() => {});
    }
  }

  return false;
};

const warnedRecently = async (path: string, now: number): Promise<boolean> => {
  try {
    const { warned_at } = JSON.parse(await readFile(path, "utf8"));

    return typeof warned_at === "number" && now - warned_at < WARN_INTERVAL_MS;
  } catch {
    return false;
  }
};

export const runCleanupWarning = async (now: number = Date.now()): Promise<void> => {
  const path = stampPath();
  if (!path || (await warnedRecently(path, now))) return;

  const lockPath = `${path}.lock`;
  if (!(await tryLock(lockPath))) return;
  try {
    // Another check may have warned between the first look and the lock.
    if (await warnedRecently(path, now)) return;
    await warnIfExpiring(path, now);
  } finally {
    await unlink(lockPath).catch(() => {});
  }
};

const warnIfExpiring = async (path: string, now: number): Promise<void> => {

  const periodDays = await readCleanupPeriodDays();
  const snapshots = await listSuspended();
  const expiring: { label: string; days: number }[] = [];

  for (const snapshot of snapshots) {
    const cleanup = await workspaceCleanup(snapshot, periodDays);
    if (needsWarning(cleanup, now) && cleanup.soonestDeletesAt !== null) {
      expiring.push({ label: snapshot.label, days: daysLeft(cleanup.soonestDeletesAt, now) });
    }
  }
  if (expiring.length === 0) return;

  expiring.sort((a, b) => a.days - b.days);
  const list = expiring
    .map(({ label, days }) => `${label} (${days === 0 ? "today" : `${days}d`})`)
    .join(", ");

  await createHerdrClient().notificationShow(
    `Suspended Claude conversation${expiring.length === 1 ? "" : "s"} near cleanup`,
    `${list}. Restore, or press t in the resume picker to reset the ${periodDays}-day clock.`,
  );

  await writeFile(path, `${JSON.stringify({ warned_at: now })}\n`, "utf8");
};
