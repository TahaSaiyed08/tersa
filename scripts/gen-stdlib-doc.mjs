// Generates docs/STDLIB.md from the compiler's own builtin table, so the docs can't drift.
import fs from "node:fs";
import { BUILTINS } from "../dist/builtins.js";

const groups = [
  ["Output and conversion", /^(print|str|int|float|parse_int|parse_float|len|is_empty|some|ok|err|panic|exit)[[(]/],
  ["Ranges", /^range\(/],
  ["Math", /^(abs|min|max|sum|clamp|round|floor|ceil|sqrt|sin|cos|tan|atan2|log|log10|exp|random|rand_int|choice|shuffle)[[(]/],
];
const byFirstParam = (sig) => {
  const m = sig.match(/\(\s*(?:var\s+)?\w+:\s*([^,)]+)/);
  return m ? m[1].trim() : "";
};
const sections = new Map([["Output and conversion", []], ["Ranges", []], ["Math", []], ["Strings", []], ["Lists", []], ["Maps", []], ["Sets", []], ["Files, system, JSON", []]]);
for (const b of BUILTINS) {
  const g = groups.find(([, re]) => re.test(b.sig));
  let sec = g?.[0];
  if (!sec) {
    const p = byFirstParam(b.sig);
    if (/^(input|args|read_file|write_file|append_file|file_exists|env|now|sleep|to_json|parse_json)\(/.test(b.sig)) sec = "Files, system, JSON";
    else if (p === "str") sec = "Strings";
    else if (p.startsWith("{")) sec = "Maps";
    else if (p.startsWith("set[")) sec = "Sets";
    else sec = "Lists";
  }
  sections.get(sec).push(b);
}
let md = "# Tersa standard library\n\nGenerated from the compiler (`scripts/gen-stdlib-doc.mjs`). Every function can also be called as a method on its first argument: `xs.map(f)` is `map(xs, f)`.\n\n";
md += "`var` on the first parameter means the function changes that argument in place, so it must be a `var` variable or field.\n\n";
for (const [sec, items] of sections) {
  md += `## ${sec}\n\n| Signature | Notes |\n|---|---|\n`;
  for (const b of items) md += `| \`${b.sig.replace(/\|/g, "\\|")}\` | ${(b.doc ?? (b.mut ? "mutates its first argument" : "")).replace(/\|/g, "\\|")} |\n`;
  md += "\n";
}
md += "## Constants\n\n`pi`, `inf`\n";
fs.writeFileSync(new URL("../docs/STDLIB.md", import.meta.url), md);
console.log("wrote docs/STDLIB.md");
