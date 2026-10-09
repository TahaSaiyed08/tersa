#!/usr/bin/env node
// Tersa command-line interface.
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compileProject, type CompileResult } from "./compile.js";
import { formatDiag } from "./diagnostics.js";
import { RUNTIME_PY, BOOT_PY } from "./runtime.js";
import { VERSION } from "./codegen.js";

const HELP = `Tersa ${VERSION} - a compact, type-safe language built for AI-written code

Usage:
  tersa run <file.tsa> [args...]   Type-check, compile to Python, and run
  tersa check <file.tsa> [--json]  Type-check only (--json: machine-readable diagnostics)
  tersa build <file.tsa> [-o dir]  Compile to Python files (default: ./build)
  tersa test <file.tsa>            Run the file's test blocks
  tersa spec                       Print the compact language spec (paste it into an LLM prompt)
  tersa version                    Print the version

Requires Python 3.10+ to run programs (set TERSA_PYTHON to choose the interpreter).`;

const useColor = process.stderr.isTTY && !process.env.NO_COLOR;

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined: case "help": case "-h": case "--help":
      console.log(HELP); return 0;
    case "version": case "-v": case "--version":
      console.log(VERSION); return 0;
    case "spec":
      process.stdout.write(readSpec()); return 0;
    case "check": return cmdCheck(rest);
    case "build": return cmdBuild(rest);
    case "run": return cmdRun(rest, "run");
    case "test": return cmdRun(rest, "test");
    default:
      if (cmd.endsWith(".tsa")) return cmdRun(argv, "run"); // `tersa file.tsa` shorthand
      console.error(`unknown command '${cmd}'\n\n${HELP}`);
      return 2;
  }
}

function readSpec(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [path.join(here, "..", "llms.txt"), path.join(here, "..", "..", "llms.txt")]) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return "spec not found (llms.txt missing from the package)\n";
}

function needFile(args: string[]): string | undefined {
  const f = args.find((a) => !a.startsWith("-"));
  if (!f) { console.error("error: missing <file.tsa>"); return undefined; }
  if (!fs.existsSync(f)) { console.error(`error: file not found: ${f}`); return undefined; }
  return f;
}

function report(res: CompileResult, showWarnings: boolean): void {
  const ds = res.diags.filter((d) => showWarnings || (d.severity ?? "error") === "error");
  for (const d of ds) console.error(formatDiag(d, res.sources.get(d.file), useColor) + "\n");
  const errs = res.diags.filter((d) => (d.severity ?? "error") === "error").length;
  if (errs) console.error(`${errs} error${errs > 1 ? "s" : ""} found`);
}

function cmdCheck(args: string[]): number {
  const json = args.includes("--json");
  const file = needFile(args);
  if (!file) return 2;
  const res = compileProject(file);
  if (json) {
    console.log(JSON.stringify({ ok: res.ok, diagnostics: res.diags.map((d) => ({ severity: d.severity ?? "error", ...d })) }, null, 2));
    return res.ok ? 0 : 1;
  }
  report(res, true);
  if (res.ok) console.error(`ok: ${file} has no errors`);
  return res.ok ? 0 : 1;
}

function writeBuild(res: CompileResult, dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tersa_rt.py"), RUNTIME_PY);
  fs.writeFileSync(path.join(dir, "tersa_boot.py"), BOOT_PY);
  for (const m of res.modules) {
    const out = path.join(dir, m.pyRel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, m.code);
  }
}

function cmdBuild(args: string[]): number {
  const file = needFile(args);
  if (!file) return 2;
  const oi = args.indexOf("-o");
  const outDir = oi >= 0 && args[oi + 1] ? args[oi + 1] : "build";
  const res = compileProject(file);
  report(res, true);
  if (!res.ok) return 1;
  writeBuild(res, outDir);
  // a tiny launcher so the build runs with plain `python main.py`
  const launcher = path.join(outDir, path.basename(file).replace(/\.tsa$/, ".py"));
  fs.writeFileSync(launcher, `import os, sys, subprocess\nhere = os.path.dirname(os.path.abspath(__file__))\nsys.exit(subprocess.call([sys.executable, os.path.join(here, "tersa_boot.py"), here, os.path.join(here, ${JSON.stringify(res.entryPy)}), "run", *sys.argv[1:]]))\n`);
  console.error(`built ${res.modules.length} module(s) into ${outDir}/  (run: python ${path.join(outDir, path.basename(launcher))})`);
  return 0;
}

let pythonCmd: string | undefined;
function findPython(): string | undefined {
  if (pythonCmd) return pythonCmd;
  const candidates = process.env.TERSA_PYTHON ? [process.env.TERSA_PYTHON] : ["python3", "python", "py"];
  for (const c of candidates) {
    const r = spawnSync(c, ["-c", "import sys; print(1 if sys.version_info >= (3, 10) else 0)"], { encoding: "utf8" });
    if (r.status === 0) {
      if (r.stdout.trim() === "1") { pythonCmd = c; return c; }
      console.error(`error: ${c} is older than Python 3.10; Tersa needs 3.10+ (set TERSA_PYTHON to a newer interpreter)`);
      return undefined;
    }
  }
  console.error("error: Python 3.10+ not found. Install it from https://python.org or set TERSA_PYTHON.");
  return undefined;
}

function cmdRun(args: string[], mode: "run" | "test"): number {
  const fileIdx = args.findIndex((a) => !a.startsWith("-"));
  if (fileIdx < 0) { console.error("error: missing <file.tsa>"); return 2; }
  const file = args[fileIdx];
  if (!fs.existsSync(file)) { console.error(`error: file not found: ${file}`); return 2; }
  const progArgs = args.slice(fileIdx + 1);
  const res = compileProject(file, { tests: mode === "test" });
  report(res, mode === "test");
  if (!res.ok) return 1;
  const py = findPython();
  if (!py) return 1;
  const hash = crypto.createHash("sha1").update(path.resolve(file)).digest("hex").slice(0, 12);
  const dir = path.join(os.tmpdir(), `tersa-${hash}`);
  writeBuild(res, dir);
  const r = spawnSync(py, [path.join(dir, "tersa_boot.py"), dir, path.join(dir, res.entryPy), mode, ...progArgs], { stdio: "inherit" });
  if (r.error) { console.error(`error: failed to start Python: ${r.error.message}`); return 1; }
  return r.status ?? 1;
}

process.exitCode = main(process.argv.slice(2));
