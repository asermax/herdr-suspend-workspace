import { createHerdrClient } from "../src/herdr-client";

const PLUGIN_ID = "asermax.workspace-suspend";

try {
  const client = createHerdrClient();
  await client.pluginPaneOpen({
    plugin_id: process.env.HERDR_PLUGIN_ID ?? PLUGIN_ID,
    entrypoint: "picker",
    placement: "popup",
  });
} catch (err) {
  process.stderr.write(`resume: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
