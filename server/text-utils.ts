export function normalizeTag(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 80);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagPattern(tag: string, includeRange = false): RegExp {
  const range = includeRange ? "(?:\\[\\d+:[0-5]\\d-\\d+:[0-5]\\d\\])?" : "";
  return new RegExp(`@${escapeRegExp(tag)}(?![\\p{L}\\p{N}_-])${range}`, "gu");
}

export function replaceScriptTag(content: string, oldTag: string, newTag: string): string {
  if (oldTag === newTag) return content;
  return content.replace(tagPattern(oldTag), `@${newTag}`);
}

export function removeScriptTag(content: string, tag: string): string {
  return content.replace(tagPattern(tag, true), "");
}
