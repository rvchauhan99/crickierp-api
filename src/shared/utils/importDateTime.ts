function normalizeHeaderKey(raw: string): string {
  return String(raw).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function expandTwoDigitYear(yy: string): string {
  if (yy.length === 4) return yy;
  const num = parseInt(yy, 10);
  return String(num < 70 ? 2000 + num : 1900 + num);
}

function parseExcelSerial(serial: number): Date | null {
  if (serial <= 1000 || serial >= 100000) return null;
  const excelEpoch = new Date(1899, 11, 30);
  const d = new Date(excelEpoch.getTime() + serial * 86400000);
  return Number.isNaN(d.getTime()) ? null : d;
}

function apply12Hour(hour: number, ampm?: string): number {
  if (!ampm) return hour;
  const upper = ampm.toUpperCase();
  if (upper === "PM" && hour < 12) return hour + 12;
  if (upper === "AM" && hour === 12) return 0;
  return hour;
}

function parseDateTimeString(trimmed: string): Date | null {
  if (/^\d{4,5}(\.\d+)?$/.test(trimmed) && !trimmed.includes("/") && !trimmed.includes("-")) {
    const serial = parseFloat(trimmed);
    const fromSerial = parseExcelSerial(serial);
    if (fromSerial) return fromSerial;
  }

  const ddmmMatch = trimmed.match(
    /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(AM|PM)?$/i,
  );
  if (ddmmMatch) {
    const [, dd, mm, yyOrYyyy, hh, min, sec, ampm] = ddmmMatch;
    const yyyy = expandTwoDigitYear(yyOrYyyy!);
    const hour = apply12Hour(parseInt(hh ?? "0", 10), ampm);
    const iso = `${yyyy}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}T${String(hour).padStart(2, "0")}:${(min ?? "00").padStart(2, "0")}:${(sec ?? "00").padStart(2, "0")}`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const isoMatch = trimmed.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(AM|PM)?$/i,
  );
  if (isoMatch) {
    const [, yyyy, mm, dd, hh, min, sec, ampm] = isoMatch;
    const hour = apply12Hour(parseInt(hh ?? "0", 10), ampm);
    const iso = `${yyyy}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}T${String(hour).padStart(2, "0")}:${(min ?? "00").padStart(2, "0")}:${(sec ?? "00").padStart(2, "0")}`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** First matching non-empty cell value without string coercion (preserves Date/number from Excel). */
export function importPickRaw(row: Record<string, unknown>, ...aliases: string[]): unknown {
  const wanted = new Set(aliases.map((a) => normalizeHeaderKey(a)));
  for (const [key, val] of Object.entries(row)) {
    if (!wanted.has(normalizeHeaderKey(key))) continue;
    if (val == null) continue;
    if (val instanceof Date) {
      if (!Number.isNaN(val.getTime())) return val;
      continue;
    }
    if (typeof val === "number" && !Number.isNaN(val)) return val;
    if (String(val).trim() !== "") return val;
  }
  return undefined;
}

export function isImportDateTimePresent(value: unknown): boolean {
  if (value == null) return false;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === "number") return !Number.isNaN(value);
  return String(value).trim() !== "";
}

export function formatImportDateTimeForDisplay(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  return String(value).trim();
}

export function parseImportDateTime(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    return parseExcelSerial(value);
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return parseDateTimeString(trimmed);
}
