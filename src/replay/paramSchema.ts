import { z } from "zod";
import type { FieldSpec } from "../artifact/schema.js";

export function buildZodObject(
  fields: Record<string, FieldSpec>
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, spec] of Object.entries(fields)) {
    let field: z.ZodTypeAny =
      spec.type === "string"
        ? z.string()
        : spec.type === "number"
          ? z.number()
          : z.boolean();
    if (spec.optional) field = field.optional();
    shape[name] = field;
  }
  return z.object(shape);
}
