import { Types } from "mongoose";
import type { z } from "zod";
import xlsx from "xlsx";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { DepositModel } from "../deposit/deposit.model";
import { PlayerModel } from "../player/player.model";
import { WithdrawalModel } from "../withdrawal/withdrawal.model";
import { ExchangeModel } from "./exchange.model";
import { exchangeStatementQuerySchema, listExchangeQuerySchema } from "./exchange.validation";

type CreateExchangeInput = {
  name: string;
  provider: string;
  openingBalance: number;
  bonus: number;
  status: "active" | "deactive";
};

type ListExchangeQuery = z.infer<typeof listExchangeQuerySchema>;
type ExchangeStatementQuery = z.infer<typeof exchangeStatementQuerySchema>;

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

function buildExchangeListFilter(q: ListExchangeQuery): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [];

  const search = trimUndef(q.search);
  if (search) {
    conditions.push({
      $or: [
        { name: { $regex: escapeRegex(search), $options: "i" } },
        { provider: { $regex: escapeRegex(search), $options: "i" } },
      ],
    });
  }

  const name = trimUndef(q.name);
  if (name) {
    conditions.push(textFieldCondition("name", name, trimUndef(q.name_op)));
  }

  const provider = trimUndef(q.provider);
  if (provider) {
    conditions.push(textFieldCondition("provider", provider, trimUndef(q.provider_op)));
  }

  const status = trimUndef(q.status);
  if (status === "active" || status === "deactive") {
    conditions.push({ status });
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

  const ob = numberFieldCondition(
    "openingBalance",
    trimUndef(q.openingBalance),
    trimUndef(q.openingBalance_op),
    trimUndef(q.openingBalance_to),
  );
  if (ob) {
    conditions.push(ob);
  }

  const bonus = numberFieldCondition("bonus", trimUndef(q.bonus), trimUndef(q.bonus_op), trimUndef(q.bonus_to));
  if (bonus) {
    conditions.push(bonus);
  }

  if (conditions.length === 0) {
    return {};
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return { $and: conditions };
}

export async function createExchange(
  input: CreateExchangeInput,
  actorId: string,
  requestId?: string,
) {
  const exists = await ExchangeModel.findOne({ name: input.name, provider: input.provider });
  if (exists) {
    throw new AppError("business_rule_error", "Exchange already exists for provider", 409);
  }

  const payload = {
    ...input,
    createdBy: new Types.ObjectId(actorId),
    updatedBy: new Types.ObjectId(actorId),
  };
  const doc = await ExchangeModel.create(payload);

  await createAuditLog({
    actorId,
    action: "exchange.create",
    entity: "exchange",
    entityId: doc._id.toString(),
    newValue: {
      name: doc.name,
      provider: doc.provider,
      openingBalance: doc.openingBalance,
      bonus: doc.bonus,
      status: doc.status,
    },
    requestId,
  });

  return doc;
}

export async function listExchanges(query: ListExchangeQuery) {
  const filter = buildExchangeListFilter(query);

  const skip = (query.page - 1) * query.pageSize;
  const sortValue = query.sortOrder === "asc" ? 1 : -1;

  const [rows, total] = await Promise.all([
    ExchangeModel.find(filter)
      .populate("createdBy", "fullName username")
      .sort({ [query.sortBy]: sortValue })
      .skip(skip)
      .limit(query.pageSize),
    ExchangeModel.countDocuments(filter),
  ]);

  return {
    rows,
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
    },
  };
}

const EXPORT_MAX_ROWS = 10_000;

function formatCreatedByForExport(createdBy: unknown): string {
  if (createdBy == null) return "";
  if (typeof createdBy === "object" && createdBy !== null && "_id" in createdBy) {
    const u = createdBy as { fullName?: string; username?: string; _id?: Types.ObjectId };
    const fn = u.fullName?.trim();
    const un = u.username?.trim();
    if (fn && un) return `${fn} (${un})`;
    if (fn) return fn;
    if (un) return un;
    return u._id?.toString() ?? "";
  }
  return String(createdBy);
}

export async function exportExchangesToBuffer(query: ListExchangeQuery): Promise<Buffer> {
  const filter = buildExchangeListFilter(query);
  const sortValue = query.sortOrder === "asc" ? 1 : -1;

  const rows = await ExchangeModel.find(filter)
    .populate("createdBy", "fullName username")
    .sort({ [query.sortBy]: sortValue })
    .limit(EXPORT_MAX_ROWS)
    .lean();

  const exportData = rows.map((r) => ({
    "Exchange Name": r.name,
    Provider: r.provider,
    "Opening Balance": r.openingBalance,
    Bonus: r.bonus,
    Version: r.version ?? "",
    Status: r.status,
    "Created By": formatCreatedByForExport(r.createdBy),
    "Created At": r.createdAt ? new Date(r.createdAt).toISOString() : "",
  }));

  const worksheet = xlsx.utils.json_to_sheet(exportData);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Exchanges");
  return xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export async function getExchangeById(id: string) {
  const doc = await ExchangeModel.findById(id);
  if (!doc) throw new AppError("not_found", "Exchange not found", 404);
  return doc;
}

export async function updateExchange(
  id: string,
  input: Partial<CreateExchangeInput> & { version: number },
  actorId: string,
  requestId?: string,
) {
  const existing = await ExchangeModel.findById(id);
  if (!existing) throw new AppError("not_found", "Exchange not found", 404);

  if (existing.version !== input.version) {
    throw new AppError("business_rule_error", "Concurrent update conflict", 409);
  }

  const oldValue = {
    name: existing.name,
    provider: existing.provider,
    openingBalance: existing.openingBalance,
    bonus: existing.bonus,
    status: existing.status,
    version: existing.version,
  };

  Object.assign(existing, input);
  existing.updatedBy = new Types.ObjectId(actorId);
  existing.version += 1;
  await existing.save();

  await createAuditLog({
    actorId,
    action: "exchange.update",
    entity: "exchange",
    entityId: existing._id.toString(),
    oldValue,
    newValue: {
      name: existing.name,
      provider: existing.provider,
      openingBalance: existing.openingBalance,
      bonus: existing.bonus,
      status: existing.status,
      version: existing.version,
    },
    requestId,
  });

  return existing;
}

function ledgerYmdStart(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function ledgerYmdEnd(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

function depositEventTime(d: { settledAt?: Date; exchangeActionAt?: Date; updatedAt?: Date; createdAt?: Date }): Date {
  if (d.settledAt) return new Date(d.settledAt);
  if (d.exchangeActionAt) return new Date(d.exchangeActionAt);
  if (d.updatedAt) return new Date(d.updatedAt);
  if (d.createdAt) return new Date(d.createdAt);
  return new Date(0);
}

function withdrawalEventTime(w: { updatedAt?: Date; createdAt?: Date }): Date {
  if (w.updatedAt) return new Date(w.updatedAt);
  if (w.createdAt) return new Date(w.createdAt);
  return new Date(0);
}

/**
 * Exchange-perspective statement:
 * - deposit -> debit (money withdrawn from exchange)
 * - withdrawal -> credit (money deposited into exchange)
 */
export async function getExchangeStatement(exchangeId: string, query: ExchangeStatementQuery) {
  if (!Types.ObjectId.isValid(exchangeId)) {
    throw new AppError("validation_error", "Invalid exchange id", 400);
  }
  const exchangeObjectId = new Types.ObjectId(exchangeId);
  const exchange = await ExchangeModel.findById(exchangeObjectId).lean();
  if (!exchange) throw new AppError("not_found", "Exchange not found", 404);

  const fromDate = query.fromDate?.trim();
  const toDate = query.toDate?.trim();
  const from = fromDate ? ledgerYmdStart(fromDate) : null;
  const to = toDate ? ledgerYmdEnd(toDate) : null;
  if (fromDate && !from) {
    throw new AppError("validation_error", "fromDate must be in YYYY-MM-DD format", 400);
  }
  if (toDate && !to) {
    throw new AppError("validation_error", "toDate must be in YYYY-MM-DD format", 400);
  }

  const playerFilter: Record<string, unknown> = { exchange: exchangeObjectId };
  if (query.playerId) {
    if (!Types.ObjectId.isValid(query.playerId)) {
      throw new AppError("validation_error", "Invalid player id", 400);
    }
    playerFilter._id = new Types.ObjectId(query.playerId);
  }

  const players = await PlayerModel.find(playerFilter).select("_id playerId").lean();
  const playerIds = players.map((p) => p._id);
  const playerMap = new Map(players.map((p) => [String(p._id), p.playerId]));

  if (playerIds.length === 0) {
    return {
      exchange: {
        _id: exchange._id.toString(),
        name: exchange.name,
        provider: exchange.provider,
        openingBalance: exchange.openingBalance,
      },
      periodOpeningBalance: exchange.openingBalance,
      periodClosingBalance: exchange.openingBalance,
      totalCredits: 0,
      totalDebits: 0,
      totalDepositOutflow: 0,
      totalWithdrawalInflow: 0,
      rows: [],
    };
  }

  const [allDeposits, allWithdrawals] = await Promise.all([
    DepositModel.find({
      player: { $in: playerIds },
      status: { $in: ["verified", "finalized"] },
    })
      .select("_id player amount bonusAmount totalAmount utr settledAt exchangeActionAt updatedAt createdAt")
      .lean(),
    WithdrawalModel.find({
      player: { $in: playerIds },
      status: { $in: ["approved", "finalized"] },
    })
      .select("_id player playerName amount payableAmount reverseBonus utr updatedAt createdAt")
      .lean(),
  ]);

  let priorNet = 0;
  if (from) {
    for (const d of allDeposits) {
      if (depositEventTime(d) >= from) continue;
      priorNet -= d.totalAmount ?? d.amount;
    }
    for (const w of allWithdrawals) {
      if (withdrawalEventTime(w) >= from) continue;
      priorNet += w.payableAmount ?? w.amount;
    }
  }

  type StatementEvent =
    | { kind: "deposit"; t: number; doc: (typeof allDeposits)[0] }
    | { kind: "withdrawal"; t: number; doc: (typeof allWithdrawals)[0] };

  const events: StatementEvent[] = [];
  const entryType = query.entryType || "all";

  for (const d of allDeposits) {
    const at = depositEventTime(d);
    if (from && at < from) continue;
    if (to && at > to) continue;
    if (entryType === "all" || entryType === "deposit") {
      events.push({ kind: "deposit", t: at.getTime(), doc: d });
    }
  }
  for (const w of allWithdrawals) {
    const at = withdrawalEventTime(w);
    if (from && at < from) continue;
    if (to && at > to) continue;
    if (entryType === "all" || entryType === "withdrawal") {
      events.push({ kind: "withdrawal", t: at.getTime(), doc: w });
    }
  }
  events.sort((a, b) => a.t - b.t);

  const periodOpeningBalance = exchange.openingBalance + priorNet;
  let running = periodOpeningBalance;
  let totalCredits = 0;
  let totalDebits = 0;
  let totalDepositOutflow = 0;
  let totalWithdrawalInflow = 0;

  const rows = events.map((ev) => {
    if (ev.kind === "deposit") {
      const d = ev.doc;
      const amount = d.totalAmount ?? d.amount;
      running -= amount;
      totalDebits += amount;
      totalDepositOutflow += amount;

      return {
        kind: "deposit" as const,
        refId: d._id.toString(),
        at: new Date(ev.t).toISOString(),
        label: "Deposit",
        playerId: playerMap.get(String(d.player)) ?? "",
        amount,
        direction: "debit" as const,
        balanceAfter: running,
        bonusMemo: d.bonusAmount ?? 0,
        utr: d.utr,
      };
    }

    const w = ev.doc;
    const amount = w.payableAmount ?? w.amount;
    running += amount;
    totalCredits += amount;
    totalWithdrawalInflow += amount;

    return {
      kind: "withdrawal" as const,
      refId: w._id.toString(),
      at: new Date(ev.t).toISOString(),
      label: "Withdrawal",
      playerId: playerMap.get(String(w.player)) ?? w.playerName ?? "",
      amount,
      direction: "credit" as const,
      balanceAfter: running,
      bonusMemo: w.reverseBonus ?? 0,
      utr: w.utr,
    };
  });

  return {
    exchange: {
      _id: exchange._id.toString(),
      name: exchange.name,
      provider: exchange.provider,
      openingBalance: exchange.openingBalance,
    },
    periodOpeningBalance,
    periodClosingBalance: running,
    totalCredits,
    totalDebits,
    totalDepositOutflow,
    totalWithdrawalInflow,
    rows,
  };
}
