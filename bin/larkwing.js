#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distEntry = join(rootDir, "dist", "cli.js");

if (!existsSync(distEntry)) {
  console.error("larkwing-cli has not been built yet. Run `npm run build` first.");
  process.exit(1);
}

const { main } = await import("../dist/cli.js");

main(process.argv.slice(2)).catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
