import { runSuspend } from "../src/suspend";

try {
  await runSuspend();
} catch (err) {
  process.stderr.write(`suspend: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
