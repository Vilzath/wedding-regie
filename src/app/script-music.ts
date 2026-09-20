import type {MusicButton, ScriptSegment} from "./models";

const tokenExpression = /@([a-z0-9][a-z0-9_-]{0,79})(?:\[(\d+:[0-5]\d)-(\d+:[0-5]\d)\])?/gi;

export function parseTimecode(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isSafeInteger(part))) return null;
  if (numbers.length === 1) return numbers[0] ?? null;
  const seconds = numbers.at(-1) ?? 0;
  const minutes = numbers.at(-2) ?? 0;
  if (seconds >= 60 || (numbers.length === 3 && minutes >= 60)) return null;
  const hours = numbers.length === 3 ? numbers[0] ?? 0 : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatTimecode(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${String(rounded % 60).padStart(2, "0")}`;
}

export function buildMusicToken(tag: string, startSeconds?: number, endSeconds?: number): string {
  if (startSeconds === undefined || endSeconds === undefined) return `@${tag}`;
  return `@${tag}[${formatTimecode(startSeconds)}-${formatTimecode(endSeconds)}]`;
}

export function parseScriptSegments(content: string, buttons: MusicButton[]): ScriptSegment[] {
  const buttonByTag = new Map(buttons.map((button) => [button.tag.toLowerCase(), button]));
  const segments: ScriptSegment[] = [];
  let cursor = 0;

  for (const match of content.matchAll(tokenExpression)) {
    const button = buttonByTag.get(match[1]?.toLowerCase() ?? "");
    if (!button || match.index === undefined) continue;
    const hasRange = Boolean(match[2] && match[3]);
    const parsedStart = match[2] ? parseTimecode(match[2]) : 0;
    const parsedEnd = match[3] ? parseTimecode(match[3]) : null;
    if (hasRange && (parsedStart === null || parsedEnd === null || parsedEnd <= parsedStart)) continue;
    if (match.index > cursor) segments.push({type: "text", content: content.slice(cursor, match.index)});
    const startSeconds = parsedStart ?? 0;
    segments.push({
      type: "button",
      button,
      startSeconds,
      endSeconds: parsedEnd,
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < content.length) segments.push({type: "text", content: content.slice(cursor)});
  return segments;
}
