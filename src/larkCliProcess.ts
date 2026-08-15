import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns
} from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export function spawnLarkCli(
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding
): SpawnSyncReturns<string> {
  const bundledEntry = resolveBundledEntry();
  if (bundledEntry) {
    return spawnSync(process.execPath, [bundledEntry, ...args], options);
  }
  if (process.platform !== "win32") {
    return spawnSync("lark-cli", args, options);
  }

  const shim = findOnPath("lark-cli.cmd");
  if (shim) {
    const entry = join(dirname(shim), "node_modules", "@larksuite", "cli", "scripts", "run.js");
    if (existsSync(entry)) {
      return spawnSync(process.execPath, [entry, ...args], options);
    }
  }
  return spawnSync("lark-cli", args, options);
}

export function spawnLarkCliProcess(
  args: string[],
  options: SpawnOptionsWithoutStdio = {}
): ChildProcessWithoutNullStreams {
  const invocation = resolveInvocation(args);
  return spawn(invocation.command, invocation.args, {
    ...options,
    stdio: ["pipe", "pipe", "pipe"]
  });
}

export function withBundledLarkCliPath(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const binDirectory = resolveBundledBinDirectory();
  if (!binDirectory) return environment;
  return {
    ...environment,
    PATH: [binDirectory, environment.PATH || ""].filter(Boolean).join(delimiter)
  };
}

function resolveBundledEntry(): string | null {
  try {
    const entry = require.resolve("@larksuite/cli/scripts/run.js");
    return existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

function resolveInvocation(args: string[]): { command: string; args: string[] } {
  const bundledEntry = resolveBundledEntry();
  if (bundledEntry) return { command: process.execPath, args: [bundledEntry, ...args] };
  if (process.platform === "win32") {
    const shim = findOnPath("lark-cli.cmd");
    if (shim) {
      const entry = join(dirname(shim), "node_modules", "@larksuite", "cli", "scripts", "run.js");
      if (existsSync(entry)) return { command: process.execPath, args: [entry, ...args] };
    }
  }
  return { command: "lark-cli", args };
}

function resolveBundledBinDirectory(): string | null {
  try {
    const packageJson = require.resolve("@larksuite/cli/package.json");
    const nodeModules = dirname(dirname(dirname(packageJson)));
    const binDirectory = join(nodeModules, ".bin");
    return existsSync(binDirectory) ? binDirectory : null;
  } catch {
    return null;
  }
}

function findOnPath(filename: string): string | null {
  for (const directory of String(process.env.PATH || "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory.replace(/^"|"$/g, ""), filename);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
