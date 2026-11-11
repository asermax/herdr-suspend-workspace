import { createHerdrClient } from "../src/herdr-client";
import { finishRestore, type RestoreFollowUp } from "../src/restore";

// Started detached by restoreWorkspace; see finishInBackground.
try {
  const followUp = JSON.parse(process.argv[2] ?? "") as RestoreFollowUp;
  await finishRestore(createHerdrClient(), followUp);
} catch (err) {
  process.stderr.write(`finish-restore: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
