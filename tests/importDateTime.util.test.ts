import {
  formatImportDateTimeForDisplay,
  importPickRaw,
  isImportDateTimePresent,
  parseImportDateTime,
} from "../src/shared/utils/importDateTime";

describe("importDateTime utilities", () => {
  it("returns null for empty values", () => {
    expect(parseImportDateTime(null)).toBeNull();
    expect(parseImportDateTime(undefined)).toBeNull();
    expect(parseImportDateTime("")).toBeNull();
    expect(parseImportDateTime("   ")).toBeNull();
    expect(isImportDateTimePresent("")).toBe(false);
  });

  it("parses Excel serial numbers", () => {
    const d = parseImportDateTime(45772.925);
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBeGreaterThanOrEqual(2025);
  });

  it("accepts Date instances", () => {
    const input = new Date("2026-05-25T22:15:00");
    const d = parseImportDateTime(input);
    expect(d?.toISOString()).toBe(input.toISOString());
  });

  it("parses DD/MM/YY HH:mm", () => {
    const d = parseImportDateTime("25/05/26 22:15");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(4);
    expect(d!.getDate()).toBe(25);
    expect(d!.getHours()).toBe(22);
    expect(d!.getMinutes()).toBe(15);
  });

  it("parses DD/MM/YYYY HH:mm:ss", () => {
    const d = parseImportDateTime("25/05/2026 22:15:00");
    expect(d).not.toBeNull();
    expect(d!.getSeconds()).toBe(0);
    expect(d!.getHours()).toBe(22);
    expect(d!.getMinutes()).toBe(15);
  });

  it("parses DD/MM/YYYY with AM/PM", () => {
    const d = parseImportDateTime("25/05/2026 10:15:00 PM");
    expect(d).not.toBeNull();
    expect(d!.getHours()).toBe(22);
    expect(d!.getMinutes()).toBe(15);
  });

  it("parses YYYY-MM-DD HH:mm", () => {
    const d = parseImportDateTime("2026-05-25 22:15");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(4);
    expect(d!.getDate()).toBe(25);
    expect(d!.getHours()).toBe(22);
    expect(d!.getMinutes()).toBe(15);
  });

  it("importPickRaw preserves Date and number types", () => {
    const date = new Date("2026-05-25T22:15:00");
    const row = { "Date Time": date, Amount: 100 };
    expect(importPickRaw(row, "date time")).toBe(date);

    const serialRow = { datetime: 45772.925 };
    expect(importPickRaw(serialRow, "datetime")).toBe(45772.925);
  });

  it("formatImportDateTimeForDisplay stringifies values for error export", () => {
    const date = new Date("2026-05-25T22:15:00.000Z");
    expect(formatImportDateTimeForDisplay(date)).toBe("2026-05-25T22:15:00.000Z");
    expect(formatImportDateTimeForDisplay("25/05/26 22:15")).toBe("25/05/26 22:15");
  });
});
