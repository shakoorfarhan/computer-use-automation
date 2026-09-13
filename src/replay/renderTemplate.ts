export function renderTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in params)) {
      throw new Error(`Missing param "${key}" referenced by template "${template}".`);
    }
    return String(params[key]);
  });
}
