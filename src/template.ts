import type { TemplateContext } from "./types.js";

export function renderTemplate(template: string, context: TemplateContext): string {
  return String(template || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = readPath(context, path);
    return value === undefined || value === null ? "" : String(value);
  });
}

function readPath(value: TemplateContext, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);
}
