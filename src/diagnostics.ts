// Diagnostics: errors designed to be read by both humans and LLMs.
// Every error has a stable code, an exact location, and (where possible) a concrete fix hint.

export interface Diagnostic {
  code: string;
  message: string;
  file: string;
  line: number;
  col: number;
  endCol?: number;
  hint?: string;
  severity?: "error" | "warning";
}

export class TersaError extends Error {
  diags: Diagnostic[];
  constructor(d: Diagnostic | Diagnostic[]) {
    const list = Array.isArray(d) ? d : [d];
    super(list.map((x) => x.message).join("; "));
    this.diags = list;
  }
}

/** Render a diagnostic with a source excerpt and caret, rustc-style. */
export function formatDiag(d: Diagnostic, src: string | undefined, color = false): string {
  const red = (s: string) => (color ? `\x1b[31m${s}\x1b[0m` : s);
  const yellow = (s: string) => (color ? `\x1b[33m${s}\x1b[0m` : s);
  const cyan = (s: string) => (color ? `\x1b[36m${s}\x1b[0m` : s);
  const sev = d.severity ?? "error";
  const head = `${sev === "error" ? red(`error[${d.code}]`) : yellow(`warning[${d.code}]`)} ${d.file}:${d.line}:${d.col}: ${d.message}`;
  const out = [head];
  const lineText = src?.split("\n")[d.line - 1];
  if (lineText !== undefined) {
    const num = String(d.line);
    const pad = " ".repeat(num.length);
    const width = Math.max(1, (d.endCol ?? d.col + 1) - d.col);
    out.push(`${pad} |`);
    out.push(`${num} | ${lineText}`);
    out.push(`${pad} | ${" ".repeat(Math.max(0, d.col - 1))}${red("^".repeat(width))}`);
  }
  if (d.hint) out.push(`  ${cyan("help:")} ${d.hint}`);
  return out.join("\n");
}

/** Edit distance, used for "did you mean ...?" hints. */
export function closest(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    if (c.startsWith("_ts_")) continue;
    const d = lev(name, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  const limit = name.length <= 3 ? 1 : name.length <= 6 ? 2 : 3;
  return bestD <= limit ? best : undefined;
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
