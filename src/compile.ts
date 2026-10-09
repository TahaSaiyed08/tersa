// Compiler driver: resolves modules, checks them, and generates Python.
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "./parser.js";
import { Checker, type ModuleExports, pyModulePath } from "./checker.js";
import { generate } from "./codegen.js";
import { TersaError, type Diagnostic } from "./diagnostics.js";
import type * as A from "./ast.js";

export interface CompiledModule { tsaPath: string; modName: string; pyRel: string; code: string }
export interface CompileResult {
  ok: boolean;
  modules: CompiledModule[];
  diags: Diagnostic[];
  sources: Map<string, string>;
  entryPy: string;
}

export interface CompileOptions { tests?: boolean; /** compile from an in-memory source instead of reading the entry file */ source?: string }

export function compileProject(entryPath: string, opts: CompileOptions = {}): CompileResult {
  const absEntry = path.resolve(entryPath);
  const root = path.dirname(absEntry);
  const entryMod = path.basename(absEntry).replace(/\.tsa$/, "");
  const diags: Diagnostic[] = [];
  const sources = new Map<string, string>();
  const cache = new Map<string, ModuleExports | "loading">();
  const order: { modName: string; file: string; prog: A.Program; result: ReturnType<Checker["run"]> }[] = [];
  const label = (file: string) => path.relative(process.cwd(), file) || file;

  const checkFile = (file: string, modName: string, isEntry: boolean, src: string): ModuleExports | undefined => {
    sources.set(label(file), src);
    let prog: A.Program;
    try {
      prog = parse(src, label(file));
    } catch (e) {
      if (e instanceof TersaError) { diags.push(...e.diags); return undefined; }
      throw e;
    }
    const chk = new Checker(prog, modName, loader, isEntry);
    let result: ReturnType<Checker["run"]>;
    try {
      result = chk.run();
    } catch (e) {
      if (e instanceof TersaError) { diags.push(...e.diags); return undefined; }
      throw e;
    }
    diags.push(...result.diags);
    order.push({ modName, file, prog, result });
    return result.exports;
  };

  const loader = (modPath: string, fromFile: string, _pos: A.Pos): ModuleExports | { error: string } => {
    if (modPath === entryMod) return { error: `module '${modPath}' is the main file; it can't be imported` };
    const cached = cache.get(modPath);
    if (cached === "loading") return { error: `circular import of module '${modPath}'` };
    if (cached) return cached;
    const file = path.join(root, ...modPath.split(".")) + ".tsa";
    if (!fs.existsSync(file)) {
      return { error: `module '${modPath}' not found (looked for ${label(file)})` };
    }
    cache.set(modPath, "loading");
    const exp = checkFile(file, modPath, false, fs.readFileSync(file, "utf8"));
    if (!exp) { cache.delete(modPath); return { error: `module '${modPath}' has errors` }; }
    cache.set(modPath, exp);
    return exp;
  };

  const src = opts.source ?? fs.readFileSync(absEntry, "utf8");
  checkFile(absEntry, entryMod, true, src);

  const ok = !diags.some((d) => (d.severity ?? "error") === "error");
  const modules: CompiledModule[] = [];
  if (ok) {
    for (const m of order) {
      try {
        const code = generate(m.prog, m.result, { tests: !!opts.tests && m.modName === entryMod, srcLabel: label(m.file) });
        modules.push({ tsaPath: m.file, modName: m.modName, pyRel: pyModulePath(m.modName).split(".").join("/") + ".py", code });
      } catch (e) {
        if (e instanceof TersaError) diags.push(...e.diags);
        else throw e;
      }
    }
  }
  return {
    ok: ok && !diags.some((d) => (d.severity ?? "error") === "error"),
    modules,
    diags,
    sources,
    entryPy: pyModulePath(entryMod) + ".py",
  };
}
