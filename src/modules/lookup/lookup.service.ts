import { BankModel } from "../bank/bank.model";
import { ExchangeModel } from "../exchange/exchange.model";
import { PlayerModel } from "../player/player.model";
import { ExpenseTypeModel } from "../masters/expense-type.model";
import { Types } from "mongoose";
import { AppError } from "../../shared/errors/AppError";

type LookupQueryParams = {
  q?: string;
  limit: number;
};

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listBankLookupOptions({ q, limit }: LookupQueryParams) {
  const qTrim = q?.trim();
  const filter: Record<string, unknown> = { status: "active" };
  if (qTrim) {
    const esc = escapeRegex(qTrim);
    filter.$or = [
      { holderName: { $regex: esc, $options: "i" } },
      { bankName: { $regex: esc, $options: "i" } },
      { accountNumber: { $regex: esc, $options: "i" } },
      { ifsc: { $regex: esc, $options: "i" } },
    ];
  }
  const rows = await BankModel.find(filter)
    .sort({ holderName: 1, bankName: 1 })
    .limit(limit)
    .select({ holderName: 1, bankName: 1, accountNumber: 1 })
    .lean()
    .exec();
  return rows.map((row) => ({
    id: String(row._id),
    label: `${row.holderName} - ${row.bankName} (${String(row.accountNumber || "").slice(-4)})`,
    holderName: String(row.holderName ?? ""),
    bankName: String(row.bankName ?? ""),
    accountNumber: String(row.accountNumber ?? ""),
  }));
}

export async function listExpenseTypeLookupOptions({ q, limit }: LookupQueryParams) {
  const qTrim = q?.trim();
  const filter: Record<string, unknown> = {
    isActive: true,
    $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
  };
  if (qTrim) {
    const esc = escapeRegex(qTrim);
    filter.$and = [
      { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] },
      {
        $or: [
          { name: { $regex: esc, $options: "i" } },
          { code: { $regex: esc, $options: "i" } },
          { description: { $regex: esc, $options: "i" } },
        ],
      },
    ];
    delete filter.$or;
  }
  const rows = await ExpenseTypeModel.find(filter)
    .sort({ name: 1 })
    .limit(limit)
    .select({ name: 1, code: 1, description: 1 })
    .lean()
    .exec();
  return rows.map((row) => ({
    id: String(row._id),
    label: String(row.name ?? ""),
    name: String(row.name ?? ""),
    code: row.code != null ? String(row.code) : undefined,
    description: row.description != null ? String(row.description) : undefined,
  }));
}

export async function listPlayerLookupOptions({ q, limit }: LookupQueryParams) {
  const qTrim = q?.trim();
  const filter: Record<string, unknown> = {};
  if (qTrim) {
    const esc = escapeRegex(qTrim);
    filter.$or = [
      { playerId: { $regex: esc, $options: "i" } },
      { phone: { $regex: esc, $options: "i" } },
    ];
  }
  const rows = await PlayerModel.find(filter)
    .populate("exchange", "name provider")
    .sort({ playerId: 1 })
    .limit(limit)
    .select({ playerId: 1, phone: 1, exchange: 1 })
    .lean()
    .exec();
  return rows.map((row) => {
    const exchange = row.exchange as { _id?: unknown; name?: unknown; provider?: unknown } | undefined;
    const exchangeName = exchange?.name != null ? String(exchange.name) : "";
    const exchangeProvider = exchange?.provider != null ? String(exchange.provider) : "";
    const exchangeLabel = `${exchangeName}${exchangeProvider ? ` (${exchangeProvider})` : ""}`.trim();
    return {
      id: String(row._id),
      label: `${String(row.playerId ?? "")}${exchangeLabel ? ` - ${exchangeLabel}` : ""}`,
      playerId: String(row.playerId ?? ""),
      phone: String(row.phone ?? ""),
      exchangeId: exchange?._id != null ? String(exchange._id) : undefined,
      exchangeName,
      exchangeProvider,
    };
  });
}

export async function listExchangeLookupOptions({ q, limit }: LookupQueryParams) {
  const qTrim = q?.trim();
  const filter: Record<string, unknown> = { status: "active" };
  if (qTrim) {
    const esc = escapeRegex(qTrim);
    filter.$or = [
      { name: { $regex: esc, $options: "i" } },
      { provider: { $regex: esc, $options: "i" } },
    ];
  }
  const rows = await ExchangeModel.find(filter)
    .sort({ name: 1, provider: 1 })
    .limit(limit)
    .select({ name: 1, provider: 1, status: 1 })
    .lean()
    .exec();
  return rows.map((row) => ({
    id: String(row._id),
    label: `${String(row.name ?? "")}${row.provider ? ` (${String(row.provider)})` : ""}`,
    name: String(row.name ?? ""),
    provider: String(row.provider ?? ""),
    status: String(row.status ?? ""),
  }));
}

export async function getPlayerBonusProfileLookup(playerId: string) {
  const id = String(playerId || "").trim();
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("validation_error", "Invalid player id", 400);
  }
  const row = await PlayerModel.findById(id)
    .select({ playerId: 1, regularBonusPercentage: 1, firstDepositBonusPercentage: 1 })
    .lean()
    .exec();
  if (!row) {
    throw new AppError("not_found", "Player not found", 404);
  }
  return {
    id: String(row._id),
    playerId: String(row.playerId ?? ""),
    regularBonusPercentage: Number(row.regularBonusPercentage ?? 0),
    firstDepositBonusPercentage: Number(row.firstDepositBonusPercentage ?? 0),
  };
}

