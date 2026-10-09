// Public API for using Tersa as a library (e.g. in editors or AI agents).
export { compileProject, type CompileResult, type CompiledModule, type CompileOptions } from "./compile.js";
export { parse } from "./parser.js";
export { lex } from "./lexer.js";
export { generate, VERSION } from "./codegen.js";
export { formatDiag, TersaError, type Diagnostic } from "./diagnostics.js";
export { RUNTIME_PY, BOOT_PY } from "./runtime.js";
export { BUILTINS } from "./builtins.js";
