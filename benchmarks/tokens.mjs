// Token benchmark: the same 8 programs, written idiomatically in each language,
// all producing byte-identical output (see verify.sh). Counts LLM tokens with
// OpenAI's public tokenizers (o200k_base = GPT-4o family, cl100k_base = GPT-4).
// Not every model's tokenizer is public, so these are a proxy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encode as o200k } from "gpt-tokenizer/encoding/o200k_base";
import { encode as cl100k } from "gpt-tokenizer/encoding/cl100k_base";

const here = path.dirname(fileURLToPath(import.meta.url));
const tasksDir = path.join(here, "tasks");
const langs = [
  ["Tersa", "main.tsa"],
  ["Python", "main.py"],
  ["Python (typed)", "typed.py"],
  ["TypeScript", "main.ts"],
  ["Go", "main.go"],
  ["Java", "Main.java"],
];

const tasks = fs.readdirSync(tasksDir).filter((t) => fs.statSync(path.join(tasksDir, t)).isDirectory()).sort();
const totals = Object.fromEntries(langs.map(([l]) => [l, { o200k: 0, cl100k: 0, lines: 0 }]));
const perTask = [];

for (const t of tasks) {
  const row = { task: t };
  for (const [lang, file] of langs) {
    const src = fs.readFileSync(path.join(tasksDir, t, file), "utf8");
    const a = o200k(src).length, b = cl100k(src).length;
    const lines = src.split("\n").filter((l) => l.trim()).length;
    row[lang] = a;
    totals[lang].o200k += a;
    totals[lang].cl100k += b;
    totals[lang].lines += lines;
  }
  perTask.push(row);
}

const pct = (x, base) => `${x >= base ? "+" : ""}${Math.round(((x - base) / base) * 100)}%`;
const base = totals["Tersa"];
let md = "# Token benchmark\n\n";
md += "Eight small programs (fizzbuzz, word frequency, shapes, bank transfers, CSV report, inventory, binary tree, todo list), ";
md += "each written idiomatically in every language and verified to print byte-identical output.\n\n";
md += "## Totals\n\n| Language | Tokens (o200k) | vs Tersa | Tokens (cl100k) | vs Tersa | Non-blank lines |\n|---|---:|---:|---:|---:|---:|\n";
for (const [lang] of langs) {
  const t = totals[lang];
  md += `| ${lang} | ${t.o200k} | ${lang === "Tersa" ? "-" : pct(t.o200k, base.o200k)} | ${t.cl100k} | ${lang === "Tersa" ? "-" : pct(t.cl100k, base.cl100k)} | ${t.lines} |\n`;
}
md += "\n## Per task (o200k tokens)\n\n| Task | " + langs.map(([l]) => l).join(" | ") + " |\n|---|" + langs.map(() => "---:").join("|") + "|\n";
for (const r of perTask) md += `| ${r.task} | ` + langs.map(([l]) => r[l]).join(" | ") + " |\n";
md += "\nTokenizers: OpenAI o200k_base and cl100k_base via the `gpt-tokenizer` package. Not every model's tokenizer is public, so treat these as a proxy; relative differences are what matter.\n";
md += "\nReproduce: `npm run bench` (counts) and `bash benchmarks/verify.sh` (checks every version prints the same output).\n";

fs.writeFileSync(path.join(here, "RESULTS.md"), md);
console.log(md);
