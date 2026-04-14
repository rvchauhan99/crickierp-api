import mongoose, { Types } from "mongoose";
import xlsx from "xlsx";
import type { z } from "zod";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { ExchangeModel } from "../exchange/exchange.model";
import { PlayerModel } from "./player.model";
import { listPlayerQuerySchema } from "./player.validation";

type ListPlayerQuery = z.infer<typeof listPlayerQuerySchema>;

const EXPORT_MAX_ROWS = 10_000;

function trimUndef(s: string | undefined): string | undefined {
  if (s == null) return undefined;
  const t = String(s).trim();
  return t === "" ? undefined : t;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textFieldCondition(field: string, value: string, op: string | undefined): Record<string, unknown> {
  const operator = op || "contains";
  const esc = escapeRegex(value);
  switch (operator) {
    case "contains":
      return { [field]: { $regex: esc, $options: "i" } };
    case "notContains":
      return { [field]: { $not: new RegExp(esc, "i") } };
    case "equals":
      return { [field]: { $regex: `^${esc}$`, $options: "i" } };
    case "notEquals":
      return { [field]: { $not: new RegExp(`^${esc}$`, "i") } };
    case "startsWith":
      return { [field]: { $regex: `^${esc}`, $options: "i" } };
    case "endsWith":
      return { [field]: { $regex: `${esc}$`, $options: "i" } };
    default:
      return { [field]: { $regex: esc, $options: "i" } };
  }
}

function numberFieldCondition(
  field: string,
  value: string | undefined,
  op: string | undefined,
  valueTo: string | undefined,
): Record<string, unknown> | null {
  const v = trimUndef(value);
  if (v == null) return null;
  const num = Number(v);
  if (!Number.isFinite(num)) return null;
  const operator = op || "equals";
  const numToRaw = trimUndef(valueTo);
  const toNum = numToRaw != null ? Number(numToRaw) : NaN;

  switch (operator) {
    case "equals":
      return { [field]: num };
    case "notEquals":
      return { [field]: { $ne: num } };
    case "gt":
      return { [field]: { $gt: num } };
    case "gte":
      return { [field]: { $gte: num } };
    case "lt":
      return { [field]: { $lt: num } };
    case "lte":
      return { [field]: { $lte: num } };
    case "between":
      if (numToRaw != null && Number.isFinite(toNum)) {
        return { [field]: { $gte: Math.min(num, toNum), $lte: Math.max(num, toNum) } };
      }
      return { [field]: num };
    default:
      return { [field]: num };
  }
}

function ymdStart(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function ymdEnd(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

function createdAtCondition(
  from: string | undefined,
  to: string | undefined,
  op: string | undefined,
): Record<string, unknown> | null {
  const operator = op || "inRange";
  const f = trimUndef(from);
  const t = trimUndef(to);

  if (operator === "inRange" && f && t) {
    const start = ymdStart(f);
    const end = ymdEnd(t);
    if (!start || !end) return null;
    return { createdAt: { $gte: start, $lte: end } };
  }
  if (operator === "equals" && f) {
    const start = ymdStart(f);
    const end = ymdEnd(f);
    if (!start || !end) return null;
    return { createdAt: { $gte: start, $lte: end } };
  }
  if (operator === "before" && f) {
    const start = ymdStart(f);
    if (!start) return null;
    return { createdAt: { $lt: start } };
  }
  if (operator === "after" && f) {
    const end = ymdEnd(f);
    if (!end) return null;
    return { createdAt: { $gt: end } };
  }
  if (f && t) {
    const start = ymdStart(f);
    const end = ymdEnd(t);
    if (!start || !end) return null;
    return { createdAt: { $gte: start, $lte: end } };
  }
  if (f) {
    const start = ymdStart(f);
    if (!start) return null;
    return { createdAt: { $gte: start } };
  }
  if (t) {
    const end = ymdEnd(t);
    if (!end) return null;
    return { createdAt: { $lte: end } };
  }
  return null;
}

async function buildPlayerListFilter(q: ListPlayerQuery): Promise<Record<string, unknown>> {
  const conditions: Record<string, unknown>[] = [];

  const search = trimUndef(q.search);
  if (search) {
    conditions.push({
      $or: [
        { playerId: { $regex: escapeRegex(search), $options: "i" } },
        { phone: { $regex: escapeRegex(search), $options: "i" } },
      ],
    });
  }

  const playerId = trimUndef(q.playerId);
  if (playerId) {
    conditions.push(textFieldCondition("playerId", playerId, trimUndef(q.playerId_op)));
  }

  const phone = trimUndef(q.phone);
  if (phone) {
    conditions.push(textFieldCondition("phone", phone, trimUndef(q.phone_op)));
  }

  const exchangeName = trimUndef(q.exchangeName);
  if (exchangeName) {
    const exFilter = textFieldCondition("name", exchangeName, trimUndef(q.exchangeName_op));
    const matches = await ExchangeModel.find(exFilter).select("_id").lean();
    const ids = matches.map((m) => m._id);
    conditions.push({ exchange: { $in: ids } });
  }

  const exId = trimUndef(q.exchangeId);
  if (exId && Types.ObjectId.isValid(exId)) {
    conditions.push({ exchange: new Types.ObjectId(exId) });
  }

  const createdBy = trimUndef(q.createdBy);
  if (createdBy && Types.ObjectId.isValid(createdBy)) {
    conditions.push({ createdBy: new Types.ObjectId(createdBy) });
  }

  const dateCond = createdAtCondition(
    trimUndef(q.createdAt_from),
    trimUndef(q.createdAt_to),
    trimUndef(q.createdAt_op),
  );
  if (dateCond) {
    conditions.push(dateCond);
  }

  const regularBonus = numberFieldCondition(
    "regularBonusPercentage",
    trimUndef(q.regularBonusPercentage ?? q.bonusPercentage),
    trimUndef(q.regularBonusPercentage_op ?? q.bonusPercentage_op),
    trimUndef(q.regularBonusPercentage_to ?? q.bonusPercentage_to),
  );
  if (regularBonus) {
    conditions.push(regularBonus);
  }

  const firstDepositBonus = numberFieldCondition(
    "firstDepositBonusPercentage",
    trimUndef(q.firstDepositBonusPercentage),
    trimUndef(q.firstDepositBonusPercentage_op),
    trimUndef(q.firstDepositBonusPercentage_to),
  );
  if (firstDepositBonus) {
    conditions.push(firstDepositBonus);
  }

  if (conditions.length === 0) {
    return {};
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return { $and: conditions };
}

export async function resolveExchangeIdByName(name: string): Promise<{
  id: Types.ObjectId;
  ambiguous: boolean;
  notFound: boolean;
}> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { id: new Types.ObjectId(), ambiguous: false, notFound: true };
  }
  const matches = await ExchangeModel.find({
    name: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, "i") },
  })
    .select("_id")
    .lean();

  if (matches.length === 0) {
    return { id: new Types.ObjectId(), ambiguous: false, notFound: true };
  }
  if (matches.length > 1) {
    return { id: new Types.ObjectId(), ambiguous: true, notFound: false };
  }
  return { id: matches[0]._id as Types.ObjectId, ambiguous: false, notFound: false };
}

export async function createPlayer(
  input: {
    exchangeId: string;
    playerId: string;
    phone: string;
    regularBonusPercentage: number;
    firstDepositBonusPercentage: number;
  },
  actorId: string,
  requestId?: string,
) {
  const exchange = await ExchangeModel.findById(input.exchangeId);
  if (!exchange) {
    throw new AppError("not_found", "Exchange not found", 404);
  }

  const playerId = input.playerId.trim();
  const phone = input.phone.trim();
  const regularBonusPercentage = input.regularBonusPercentage;
  const firstDepositBonusPercentage = input.firstDepositBonusPercentage;

  try {
    const doc = await PlayerModel.create({
      exchange: new Types.ObjectId(input.exchangeId),
      playerId,
      phone,
      regularBonusPercentage,
      firstDepositBonusPercentage,
      createdBy: new Types.ObjectId(actorId),
      updatedBy: new Types.ObjectId(actorId),
    });

    await createAuditLog({
      actorId,
      action: "player.create",
      entity: "player",
      entityId: doc._id.toString(),
      newValue: {
        exchangeId: input.exchangeId,
        playerId,
        phone,
        regularBonusPercentage,
        firstDepositBonusPercentage,
      },
      requestId,
    });

    return doc;
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code?: number }).code : undefined;
    if (code === 11000) {
      throw new AppError("business_rule_error", "Player ID already exists for this exchange", 409);
    }
    throw err;
  }
}

export async function getPlayerById(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError("validation_error", "Invalid player id", 400);
  }
  const doc = await PlayerModel.findById(id)
    .select("exchange playerId phone regularBonusPercentage firstDepositBonusPercentage")
    .populate("exchange", "name provider")
    .lean();
  if (!doc) {
    throw new AppError("not_found", "Player not found", 404);
  }
  return {
    ...doc,
    bonusPercentage: doc.regularBonusPercentage,
  };
}

export async function updatePlayer(
  id: string,
  input: {
    phone: string;
    regularBonusPercentage: number;
    firstDepositBonusPercentage: number;
  },
  actorId: string,
  requestId?: string,
) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError("validation_error", "Invalid player id", 400);
  }
  const doc = await PlayerModel.findById(id);
  if (!doc) {
    throw new AppError("not_found", "Player not found", 404);
  }

  const oldValue = {
    phone: doc.phone,
    regularBonusPercentage: doc.regularBonusPercentage,
    firstDepositBonusPercentage: doc.firstDepositBonusPercentage,
  };

  doc.phone = input.phone.trim();
  doc.regularBonusPercentage = input.regularBonusPercentage;
  doc.firstDepositBonusPercentage = input.firstDepositBonusPercentage;
  doc.updatedBy = new Types.ObjectId(actorId);
  await doc.save();

  await createAuditLog({
    actorId,
    action: "player.update",
    entity: "player",
    entityId: doc._id.toString(),
    oldValue,
    newValue: {
      phone: doc.phone,
      regularBonusPercentage: doc.regularBonusPercentage,
      firstDepositBonusPercentage: doc.firstDepositBonusPercentage,
    },
    requestId,
  });

  return doc;
}

export async function listPlayers(query: ListPlayerQuery) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? query.limit ?? 20;
  const skip = (page - 1) * pageSize;
  const requestedSortBy = query.sortBy ?? "createdAt";
  const sortBy = requestedSortBy === "bonusPercentage" ? "regularBonusPercentage" : requestedSortBy;
  const sortOrder = query.sortOrder === "asc" ? 1 : -1;

  const filter = await buildPlayerListFilter(query);

  const [rows, total] = await Promise.all([
    PlayerModel.find(filter)
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(pageSize)
      .populate("exchange", "name provider")
      .populate("createdBy", "fullName username")
      .populate("updatedBy", "fullName username")
      .lean(),
    PlayerModel.countDocuments(filter),
  ]);

  const normalizedRows = rows.map((row) => ({
    ...row,
    bonusPercentage:
      typeof row.regularBonusPercentage === "number"
        ? row.regularBonusPercentage
        : Number((row as { bonusPercentage?: unknown }).bonusPercentage ?? 0),
  }));

  return {
    rows: normalizedRows,
    meta: {
      total,
      page,
      pageSize,
    },
  };
}

export async function exportPlayersToBuffer(query: ListPlayerQuery): Promise<Buffer> {
  const filter = await buildPlayerListFilter(query);
  const requestedSortBy = query.sortBy ?? "createdAt";
  const sortBy = requestedSortBy === "bonusPercentage" ? "regularBonusPercentage" : requestedSortBy;
  const sortOrder = query.sortOrder === "asc" ? 1 : -1;

  const rows = await PlayerModel.find(filter)
    .sort({ [sortBy]: sortOrder })
    .limit(EXPORT_MAX_ROWS)
    .populate("exchange", "name provider")
    .populate("createdBy", "fullName username")
    .lean();

  function formatCreatedBy(createdBy: unknown): string {
    if (createdBy == null) return "";
    if (typeof createdBy === "object" && createdBy !== null && "fullName" in createdBy) {
      const u = createdBy as { fullName?: string; username?: string };
      const fn = u.fullName?.trim();
      const un = u.username?.trim();
      if (fn && un) return `${fn} (${un})`;
      if (fn) return fn;
      if (un) return un;
    }
    return "";
  }

  const exportData = rows.map((r) => {
    const ex = r.exchange as { name?: string; provider?: string } | null;
    return {
      "Exchange Name": ex?.name ?? "",
      Provider: ex?.provider ?? "",
      "Player Id": r.playerId,
      Phone: r.phone,
      "Regular Bonus %": r.regularBonusPercentage ?? 0,
      "First Deposit Bonus %": r.firstDepositBonusPercentage ?? 0,
      "Created By": formatCreatedBy(r.createdBy),
      "Created At": r.createdAt ? new Date(r.createdAt).toISOString() : "",
    };
  });

  const worksheet = xlsx.utils.json_to_sheet(exportData);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Players");
  return xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function getSampleCsvBuffer(): Buffer {
  const header = "exchange_name,player_id,phone,bonus_percentage,first_deposit_bonus_percentage\n";
  const example = "Example Exchange,PLAYER001,9876543210,5,10\n";
  return Buffer.from(header + example, "utf-8");
}

function normalizeHeaderKey(raw: string): string {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function pickCell(row: Record<string, unknown>, ...aliases: string[]): string {
  const wanted = new Set(aliases.map((a) => normalizeHeaderKey(a)));
  for (const [key, val] of Object.entries(row)) {
    if (!wanted.has(normalizeHeaderKey(key))) continue;
    if (val != null && String(val).trim() !== "") return String(val).trim();
  }
  return "";
}

/** First matching column value, may be empty (for optional numeric cells). */
function pickCellRaw(row: Record<string, unknown>, ...aliases: string[]): string {
  const wanted = new Set(aliases.map((a) => normalizeHeaderKey(a)));
  for (const [key, val] of Object.entries(row)) {
    if (!wanted.has(normalizeHeaderKey(key))) continue;
    return val == null ? "" : String(val).trim();
  }
  return "";
}

export type ImportRowError = { row: number; message: string };

function parsePercentageCell(
  raw: string,
  rowNum: number,
  fieldName: string,
): { ok: true; value: number } | { ok: false; error: ImportRowError } {
  const t = raw.trim();
  if (t === "") {
    return { ok: true, value: 0 };
  }
  const n = Number(t);
  if (!Number.isFinite(n)) {
    return {
      ok: false,
      error: { row: rowNum, message: `${fieldName} must be a valid number` },
    };
  }
  if (n < 0 || n > 100) {
    return {
      ok: false,
      error: { row: rowNum, message: `${fieldName} must be between 0 and 100` },
    };
  }
  return { ok: true, value: n };
}

function sheetRowsToObjects(sheet: xlsx.WorkSheet): Record<string, unknown>[] {
  return xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
}

type ParsedImportRow = {
  rowNum: number;
  exchangeId: Types.ObjectId;
  playerId: string;
  phone: string;
  regularBonusPercentage: number;
  firstDepositBonusPercentage: number;
};

function throwImportValidation(message: string, errors: ImportRowError[]): never {
  throw new AppError("validation_error", message, 400, { errors });
}

export async function importPlayersFromFile(
  buffer: Buffer,
  originalName: string,
  actorId: string,
  requestId?: string,
): Promise<{
  created: number;
  updated: number;
  skipped: number;
}> {
  const lower = originalName.toLowerCase();
  let rows: Record<string, unknown>[];

  if (lower.endsWith(".csv")) {
    const wb = xlsx.read(buffer, { type: "buffer", raw: false });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      throw new AppError("validation_error", "CSV file is empty", 400);
    }
    rows = sheetRowsToObjects(wb.Sheets[sheetName]);
  } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const wb = xlsx.read(buffer, { type: "buffer", raw: false });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      throw new AppError("validation_error", "Spreadsheet has no sheets", 400);
    }
    rows = sheetRowsToObjects(wb.Sheets[sheetName]);
  } else {
    throw new AppError("validation_error", "Unsupported file type. Use .csv, .xlsx, or .xls", 400);
  }

  const errors: ImportRowError[] = [];
  let skipped = 0;
  const parsedRows: ParsedImportRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const exchangeName = pickCell(row, "exchange_name", "exchange", "exchange name");
    const playerId = pickCell(row, "player_id", "playerid", "player id");
    const phone = pickCell(row, "phone", "phone_number", "phone number", "mobile");

    if (!exchangeName && !playerId && !phone) {
      skipped += 1;
      continue;
    }

    if (!exchangeName) {
      errors.push({ row: rowNum, message: "exchange_name is required" });
      continue;
    }
    if (!playerId) {
      errors.push({ row: rowNum, message: "player_id is required" });
      continue;
    }
    if (!phone) {
      errors.push({ row: rowNum, message: "phone is required" });
      continue;
    }

    const resolved = await resolveExchangeIdByName(exchangeName);
    if (resolved.notFound) {
      errors.push({ row: rowNum, message: `No exchange found for name "${exchangeName}"` });
      continue;
    }
    if (resolved.ambiguous) {
      errors.push({
        row: rowNum,
        message: `Multiple exchanges match "${exchangeName}"; names must be unique for import`,
      });
      continue;
    }

    const regularBonusRaw = pickCellRaw(
      row,
      "bonus_percentage",
      "bonus_percent",
      "bonus",
      "bonus percentage",
      "bonus%",
    );
    const regularBonusParsed = parsePercentageCell(regularBonusRaw, rowNum, "bonus_percentage");
    if (!regularBonusParsed.ok) {
      errors.push(regularBonusParsed.error);
      continue;
    }

    const firstDepositBonusRaw = pickCellRaw(
      row,
      "first_deposit_bonus_percentage",
      "first_deposit_bonus_percent",
      "first deposit bonus percentage",
      "first deposit bonus%",
      "firstdepositbonuspercentage",
    );
    const firstDepositBonusParsed = parsePercentageCell(
      firstDepositBonusRaw,
      rowNum,
      "first_deposit_bonus_percentage",
    );
    if (!firstDepositBonusParsed.ok) {
      errors.push(firstDepositBonusParsed.error);
      continue;
    }

    parsedRows.push({
      rowNum,
      exchangeId: resolved.id,
      playerId,
      phone,
      regularBonusPercentage: regularBonusParsed.value,
      firstDepositBonusPercentage: firstDepositBonusParsed.value,
    });
  }

  if (errors.length > 0) {
    throwImportValidation("Import failed — no rows were imported. Fix the issues below and try again.", errors);
  }

  if (parsedRows.length === 0) {
    throw new AppError("validation_error", "No data rows to import. Add at least one row with exchange_name, player_id, and phone.", 400);
  }

  const seenFirstRow = new Map<string, number>();
  const dupErrors: ImportRowError[] = [];
  for (const p of parsedRows) {
    const key = `${p.exchangeId.toString()}:${p.playerId}`;
    const first = seenFirstRow.get(key);
    if (first !== undefined) {
      dupErrors.push({
        row: p.rowNum,
        message: `Duplicate player_id "${p.playerId}" for this exchange (same as row ${first})`,
      });
    } else {
      seenFirstRow.set(key, p.rowNum);
    }
  }
  if (dupErrors.length > 0) {
    throwImportValidation("Import failed — no rows were imported. Fix the issues below and try again.", dupErrors);
  }

  const actorOid = new Types.ObjectId(actorId);
  const orConditions = parsedRows.map((p) => ({
    exchange: p.exchangeId,
    playerId: p.playerId,
  }));
  const existing = await PlayerModel.find({ $or: orConditions }).select("_id exchange playerId").lean();
  const existingByKey = new Map<string, Types.ObjectId>();
  for (const doc of existing) {
    const exId = (doc.exchange as Types.ObjectId).toString();
    existingByKey.set(`${exId}:${doc.playerId}`, doc._id as Types.ObjectId);
  }

  const docsToCreate = parsedRows
    .filter((p) => !existingByKey.has(`${p.exchangeId.toString()}:${p.playerId}`))
    .map((p) => ({
      exchange: p.exchangeId,
      playerId: p.playerId,
      phone: p.phone,
      regularBonusPercentage: p.regularBonusPercentage,
      firstDepositBonusPercentage: p.firstDepositBonusPercentage,
      createdBy: actorOid,
      updatedBy: actorOid,
    }));

  const updateOps = parsedRows
    .map((p) => {
      const key = `${p.exchangeId.toString()}:${p.playerId}`;
      const existingId = existingByKey.get(key);
      if (!existingId) return null;
      return {
        updateOne: {
          filter: { _id: existingId },
          update: {
            $set: {
              phone: p.phone,
              regularBonusPercentage: p.regularBonusPercentage,
              firstDepositBonusPercentage: p.firstDepositBonusPercentage,
              updatedBy: actorOid,
            },
          },
        },
      };
    })
    .filter((op): op is NonNullable<typeof op> => op !== null);

  const created = docsToCreate.length;
  const updated = updateOps.length;

  const transactionalWrite = async (session?: mongoose.ClientSession) => {
    if (docsToCreate.length > 0) {
      if (session) {
        await PlayerModel.insertMany(docsToCreate, { session });
      } else {
        await PlayerModel.insertMany(docsToCreate);
      }
    }
    if (updateOps.length > 0) {
      if (session) {
        await PlayerModel.bulkWrite(updateOps, { session });
      } else {
        await PlayerModel.bulkWrite(updateOps);
      }
    }
  };

  try {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await transactionalWrite(session);
      });
    } finally {
      await session.endSession();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/replica set|Transaction numbers|multi-document transactions/i.test(msg)) {
      await transactionalWrite();
    } else {
      throw err;
    }
  }

  await createAuditLog({
    actorId,
    action: "player.import",
    entity: "player",
    entityId: "bulk",
    newValue: {
      created,
      updated,
      skipped,
      fileName: originalName,
    },
    requestId,
  });

  return { created, updated, skipped };
}
