import { runCleanupWarning } from "../src/cleanup-warning";
import { runSuspend } from "../src/suspend";

try {
  await runSuspend();
} catch (err) {
  process.stderr.write(`suspend: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

// A warning problem must not fail a suspend that already succeeded.
await runCleanupWarning().catch(() => {});
