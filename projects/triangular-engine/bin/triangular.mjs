#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main as consensusMain } from "./triangular-consensus.mjs";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TESTING_COMMANDS = new Map([
  ["run", "triangular-test-run.mjs"],
  ["summary", "triangular-test-summary.mjs"],
  ["receiver", "triangular-test-receiver.mjs"],
  ["baseline", "triangular-test-baseline.mjs"],
]);

function rootAndArgs(args) {
  const remaining = [];
  let root = process.cwd();
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--root") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--root requires a directory");
      root = path.resolve(process.cwd(), value);
    } else {
      remaining.push(args[index]);
    }
  }
  return { root, args: remaining };
}

function spawnNode(script, args, cwd) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function sourceRecordsHelper() {
  const packaged = path.join(PACKAGE_ROOT, "bin", "engineering-records.mjs");
  if (existsSync(packaged)) return packaged;
  return path.resolve(PACKAGE_ROOT, "../../scripts/engineering-records.mjs");
}

function help() {
  return `Triangular CLI\n\n  triangular docs consensus new ...\n  triangular docs consensus prompt <id> ...\n  triangular docs consensus add-response <id> ...\n  triangular docs consensus check <id>\n  triangular docs records <new|next|review|baseline|check|manifest> ...\n  triangular docs plan new ...       Create a paired Plan and Engineering Record\n  triangular docs record new ...     Create a paired Plan and Engineering Record\n  triangular testing <run|summary|receiver|baseline> ...\n\nAll commands use the current directory by default. Pass --root <directory> to target another project.`;
}

export async function main(args = process.argv.slice(2)) {
  const [namespace, ...rest] = args;
  if (!namespace || namespace === "--help" || namespace === "help") {
    console.log(help());
    return 0;
  }
  const scoped = rootAndArgs(rest);
  if (namespace === "docs") {
    const [kind, ...commandArgs] = scoped.args;
    if (kind === "consensus")
      return consensusMain(commandArgs, scoped.root);
    if (kind === "records" || kind === "plan" || kind === "record") {
      if ((kind === "plan" || kind === "record") && commandArgs[0] !== "new") {
        console.error("Use `triangular docs plan new` or `triangular docs record new`; both create a paired Plan and Engineering Record.");
        return 2;
      }
      const argsForHelper =
        kind === "plan" || kind === "record"
          ? ["new", ...commandArgs.slice(1)]
          : commandArgs;
      return spawnNode(sourceRecordsHelper(), [
        ...argsForHelper,
        "--root",
        scoped.root,
      ], scoped.root);
    }
    if (kind === "--help" || kind === "help" || !kind) {
      console.log(help());
      return 0;
    }
    console.error(`Unknown docs command: ${kind}\n\n${help()}`);
    return 2;
  }
  if (namespace === "testing") {
    const [command, ...commandArgs] = scoped.args;
    if (command === "--help" || command === "help" || !command) {
      console.log(help());
      return 0;
    }
    const scriptName = TESTING_COMMANDS.get(command);
    if (!scriptName) {
      console.error(`Unknown testing command: ${command}\n\n${help()}`);
      return 2;
    }
    const script = path.join(PACKAGE_ROOT, "bin", scriptName);
    return spawnNode(script, commandArgs, scoped.root);
  }
  console.error(`Unknown command family: ${namespace}\n\n${help()}`);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
