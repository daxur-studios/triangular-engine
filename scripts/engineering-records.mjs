#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  confirmScopeBaseline as packageConfirmScopeBaseline,
  createPair as packageCreatePair,
  inspectDocuments as packageInspectDocuments,
  main as packageMain,
  nextNumber as packageNextNumber,
  refreshReview as packageRefreshReview,
} from "../projects/triangular-engine/bin/engineering-records.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WORKSPACE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const PACKAGE_ROOT = path.resolve(WORKSPACE_ROOT, "projects/triangular-engine");

export const nextNumber = (root = WORKSPACE_ROOT) => packageNextNumber(root);
export const createPair = (options = {}) =>
  packageCreatePair({
    ...options,
    root: options.root ?? WORKSPACE_ROOT,
    templateRoot: options.templateRoot ?? PACKAGE_ROOT,
  });
export const refreshReview = (options = {}) =>
  packageRefreshReview({ ...options, root: options.root ?? WORKSPACE_ROOT });
export const confirmScopeBaseline = (options = {}) =>
  packageConfirmScopeBaseline({ ...options, root: options.root ?? WORKSPACE_ROOT });
export const inspectDocuments = (root = WORKSPACE_ROOT) =>
  packageInspectDocuments(root);
export const main = (args = process.argv.slice(2), root = WORKSPACE_ROOT) =>
  packageMain(args, root, PACKAGE_ROOT);

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    process.exitCode = await main(process.argv.slice(2), WORKSPACE_ROOT);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
