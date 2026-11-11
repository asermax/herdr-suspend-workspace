import { runCleanupWarning } from "../src/cleanup-warning";

try {
  await runCleanupWarning();
} catch (err) {
  process.stderr.write(`warn: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
