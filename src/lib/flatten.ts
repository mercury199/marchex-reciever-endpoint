export type JsonType = "string" | "number" | "boolean" | "null" | "object" | "array";

export interface FlattenedPath {
  path: string;
  type: JsonType;
}

function jsonTypeOf(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
}

/**
 * Flattens an object into dot-path leaves for the field_catalog.
 * - Objects recurse, joining keys with ".".
 * - Arrays stop (recorded as "array" at their own path, not indexed into).
 * - null, and primitives, are recorded as leaves.
 * - Empty objects ({}) are recorded as "object" leaves with no children.
 */
export function flatten(value: unknown, prefix = ""): FlattenedPath[] {
  const type = jsonTypeOf(value);

  if (type !== "object") {
    return [{ path: prefix, type }];
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return [{ path: prefix, type: "object" }];
  }

  const results: FlattenedPath[] = [];
  for (const key of keys) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    results.push(...flatten(obj[key], childPath));
  }
  return results;
}
