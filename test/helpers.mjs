import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compileProject } from "../dist/compile.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(ROOT, "dist", "cli.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tersa-test-"));
let n = 0;

/** Write source to a temp file and type-check it. */
export function checkSource(src, name) {
  const file = path.join(tmp, name ?? `case${++n}.tsa`);
  fs.writeFileSync(file, src);
  return compileProject(file);
}

/** Run a Tersa program through the CLI and return { status, stdout, stderr }. */
export function runSource(src, args = [], cmd = "run") {
  const file = path.join(tmp, `run${++n}.tsa`);
  fs.writeFileSync(file, src);
  return runFile(file, args, cmd);
}

export function runFile(file, args = [], cmd = "run") {
  const r = spawnSync(process.execPath, [CLI, cmd, file, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function tempDir() {
  return fs.mkdtempSync(path.join(tmp, "dir-"));
}
