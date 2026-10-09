// "Fewer AI bugs" benchmark: common LLM mistakes, written once in typed Python and once in Tersa.
// For each: does plain Python notice? does mypy --strict notice? does Tersa notice before running?
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const dir = path.join(here, "bugs");
const run = (cmd, args, cwd) => spawnSync(cmd, args, { encoding: "utf8", cwd });
const hasMypy = run("python3", ["-m", "mypy", "--version"]).status === 0;

const rows = [];
for (const b of fs.readdirSync(dir).sort()) {
  const d = path.join(dir, b);
  const py = run("python3", [path.join(d, "bug.py")]);
  const pyResult = py.status === 0 ? "runs, wrong result" : "crashes at runtime";
  let mypy = "n/a";
  if (hasMypy) {
    const m = run("python3", ["-m", "mypy", "--strict", "--no-error-summary", "--cache-dir", "/dev/null", path.join(d, "bug.py")]);
    mypy = m.status === 0 ? "missed" : "caught";
  }
  const chk = run("node", [path.join(root, "dist", "cli.js"), "check", "--json", path.join(d, "bug.tsa")]);
  const j = JSON.parse(chk.stdout);
  let tersa;
  if (!j.ok) {
    const e = j.diagnostics.find((x) => x.severity === "error");
    tersa = `caught (${e.code}: ${e.message.replace(/\|/g, "/")})`;
  } else {
    const r = run("node", [path.join(root, "dist", "cli.js"), "run", path.join(d, "bug.tsa")]);
    const want = fs.existsSync(path.join(d, "correct.txt")) ? fs.readFileSync(path.join(d, "correct.txt"), "utf8") : null;
    tersa = want !== null && r.stdout === want ? "prevented by design (correct output)" : "MISSED";
  }
  rows.push({ b, pyResult, mypy, tersa });
}

const count = (f) => rows.filter(f).length;
let md = "# AI-bug benchmark\n\n";
md += "Each case is a mistake LLMs commonly make, written as typed Python (so mypy has a fair chance) and as the equivalent Tersa.\n\n";
md += `| Bug | Plain Python | mypy --strict | Tersa |\n|---|---|---|---|\n`;
for (const r of rows) md += `| ${r.b.replace(/_/g, " ")} | ${r.pyResult} | ${r.mypy} | ${r.tersa} |\n`;
md += `\n**Caught or prevented before running:** Python ${0}/${rows.length}, mypy --strict ${count((r) => r.mypy === "caught")}/${rows.length}, Tersa ${count((r) => !r.tersa.startsWith("MISSED"))}/${rows.length}.\n`;
md += `\nPlain Python silently produced a wrong result in ${count((r) => r.pyResult.startsWith("runs"))} of ${rows.length} cases.\n`;
md += "\nReproduce: `npm run bench:bugs` (needs python3; mypy optional: `pip install mypy`).\n";
fs.writeFileSync(path.join(here, "BUGS.md"), md);
console.log(md);
