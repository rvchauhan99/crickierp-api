import { DEFAULT_TIMEZONE, formatDateForTimeZone } from "./timezone";

/** Admin and superadmin may set custom (including past/future) business entry datetimes. */
export function canSetCustomBusinessEntryDateTime(role: string | undefined | null): boolean {
  return role === "admin" || role === "superadmin";
}

export function todayBusinessYmd(timeZone: string = DEFAULT_TIMEZONE): string {
  return formatDateForTimeZone(new Date(), timeZone) || new Date().toISOString().slice(0, 10);
}

/**
 * For optional ISO datetime fields (deposit entryAt, withdrawal requestedAt):
 * non-privileged actors cannot supply a value — omit so create defaults to now and amend keeps existing.
 */
export function omitCustomBusinessDateTime<T extends Record<string, unknown>>(
  body: T,
  field: keyof T & string,
  role: string | undefined | null,
): T {
  if (canSetCustomBusinessEntryDateTime(role)) return body;
  if (!(field in body) || body[field] === undefined) return body;
  const next = { ...body };
  delete next[field];
  return next;
}

/** For required YYYY-MM-DD fields: non-privileged actors are forced to today. */
export function resolveBusinessYmdForActor(
  ymd: string,
  role: string | undefined | null,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (canSetCustomBusinessEntryDateTime(role)) return ymd;
  return todayBusinessYmd(timeZone);
}
