export interface PresetMacroContext {
  user: string;
  char: string;
  lastUserMessage: string;
  date: string;
  time: string;
}

export interface MacroDiagnostic {
  code: "unknown_macro";
  macro: string;
}

export interface MacroScope {
  context: PresetMacroContext;
  variables: Map<string, string>;
  diagnostics: MacroDiagnostic[];
}

export function createMacroScope(context: PresetMacroContext): MacroScope {
  return { context, variables: new Map(), diagnostics: [] };
}

export function expandSillyTavernMacros(
  text: string,
  scope: MacroScope,
): string {
  return text.replace(/\{\{([^{}]+)\}\}/g, (full, body: string) => {
    if (body === "user") return scope.context.user;
    if (body === "char") return scope.context.char;
    if (body === "lastUserMessage") return scope.context.lastUserMessage;
    if (body === "date") return scope.context.date;
    if (body === "time") return scope.context.time;
    if (body.startsWith("setvar::")) {
      const [, name, ...rest] = body.split("::");
      if (name) scope.variables.set(name, rest.join("::"));
      return "";
    }
    if (body.startsWith("getvar::")) {
      const [, name] = body.split("::");
      return scope.variables.get(name ?? "") ?? "";
    }
    scope.diagnostics.push({ code: "unknown_macro", macro: full });
    return full;
  });
}
