#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { platform } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = dirname(__dirname);

const binary = platform() === "win32" ? "kayto.exe" : "kayto";
const binaryPath = join(rootDir, ".kayto", "bin", binary);

if (!existsSync(binaryPath)) {
  console.error("[kayto_ts] kayto binary is missing. Reinstall package: npm i kayto_ts (or bun/pnpm/yarn install)");
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
});

if (result.error) {
  console.error("[kayto_ts] failed to execute kayto:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
