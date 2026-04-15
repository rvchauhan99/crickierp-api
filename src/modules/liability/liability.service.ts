import { Types } from "mongoose";
import { generateExcelBuffer } from "../../shared/services/excel.service";
import type { z } from "zod";
import { AppError } from "../../shared/errors/AppError";
import { createAuditLog } from "../audit/audit.service";
import { BankModel } from "../bank/bank.model";
import { ExpenseModel } from "../expense/expense.model";
import { LiabilityEntryModel } from "./liability-entry.model";
import { LiabilityPersonModel } from "./liability-person.model";
import { liabilityLedgerQuerySchema, listLiabilityEntryQuerySchema, listLiabilityPersonQuerySchema } from "./liability.validation";

type ListLiabilityPersonQuery = z.infer<typeof listLiabilityPersonQuerySchema>;
type ListLiabilityEntryQuery = z.infer<typeof listLiabilityEntryQuerySchema>;
type LedgerQuery = z.infer<typeof liabilityLedgerQuerySchema>;

const EXPORT_MAX_ROWS = 10_000;

function pageSizeFromQuery(q: { pageSize: number; limit?: number }): number {
  return q.limit ?? q.pageSize;
}

function trimUndef(s: string | undefined): string | undefined {
  if (s == null) return undefined;
  const t = String(s).trim();
  return t === "" ? undefined : t;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseYmdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
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

export async function recomputePersonRollup(personId: string): Promise<void> {
  if (!Types.ObjectId.isValid(personId)) return;
  const pid = new Types.ObjectId(personId);
  const person = await LiabilityPersonModel.findById(pid);
  if (!person) return;

  const [creditAgg, debitAgg] = await Promise.all([
    LiabilityEntryModel.aggregate<{ total: number }>([
      {
        $match: {
          fromAccountType: "person",
          fromAccountId: pid,
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    LiabilityEntryModel.aggregate<{ total: number }>([
      {
        $match: {
          toAccountType: "person",
          toAccountId: pid,
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  const totalCredits = Number(creditAgg[0]?.total ?? 0);
  const totalDebits = Number(debitAgg[0]?.total ?? 0);
  const closingBalance = (person.openingBalance ?? 0) + totalDebits - totalCredits;

  person.totalCredits = totalCredits;
  person.totalDebits = totalDebits;
  person.closingBalance = closingBalance;
  await person.save();
}

function validateDistinctEndpoints(input: {
  fromAccountType: "bank" | "person" | "expense";
  fromAccountId: string;
  toAccountType: "bank" | "person" | "expense";
  toAccountId: string;
}) {
  if (input.fromAccountType === input.toAccountType && input.fromAccountId === input.toAccountId) {
    throw new AppError("business_rule_error", "From and To account cannot be same", 400);
  }
}

async function ensureAccountExists(type: "bank" | "person" | "expense", id: string) {
  if (!Types.ObjectId.isValid(id)) throw new AppError("validation_error", "Invalid account id", 400);
  if (type === "bank") {
    const bank = await BankModel.findById(id).lean();
    if (!bank) throw new AppError("not_found", "Bank not found", 404);
    if (bank.status !== "active") throw new AppError("business_rule_error", "Bank is not active", 400);
    return;
  }
  if (type === "expense") {
    const expense = await ExpenseModel.findById(id).select("_id").lean();
    if (!expense) throw new AppError("not_found", "Expense not found", 404);
    return;
  }
  const person = await LiabilityPersonModel.findById(id).lean();
  if (!person) throw new AppError("not_found", "Liability person not found", 404);
  if (!person.isActive) throw new AppError("business_rule_error", "Liability person is inactive", 400);
}

export async function createLiabilityPerson(
  input: {
    name: string;
    phone?: string;
    email?: string;
    notes?: string;
    isActive?: boolean;
    openingBalance?: number;
  },
  actorId: string,
  requestId?: string,
) {
  const doc = await LiabilityPersonModel.create({
    name: input.name.trim(),
    phone: input.phone?.trim() ?? "",
    email: input.email?.trim() ?? "",
    notes: input.notes?.trim() ?? "",
    isActive: input.isActive ?? true,
    openingBalance: input.openingBalance ?? 0,
    totalDebits: 0,
    totalCredits: 0,
    closingBalance: input.openingBalance ?? 0,
    createdBy: new Types.ObjectId(actorId),
  });

  await createAuditLog({
    actorId,
    action: "liability.person.create",
    entity: "liability_person",
    entityId: doc._id.toString(),
    newValue: {
      name: doc.name,
      openingBalance: doc.openingBalance,
      isActive: doc.isActive,
    },
    requestId,
  });

  return doc;
}

export async function updateLiabilityPerson(
  id: string,
  input: {
    name?: string;
    phone?: string;
    email?: string;
    notes?: string;
    isActive?: boolean;
    openingBalance?: number;
  },
  actorId: string,
  requestId?: string,
) {
  const doc = await LiabilityPersonModel.findById(id);
  if (!doc) throw new AppError("not_found", "Liability person not found", 404);

  const prev = {
    name: doc.name,
    phone: doc.phone,
    email: doc.email,
    notes: doc.notes,
    isActive: doc.isActive,
    openingBalance: doc.openingBalance,
  };

  if (input.name !== undefined) doc.name = input.name.trim();
  if (input.phone !== undefined) doc.phone = input.phone.trim();
  if (input.email !== undefined) doc.email = input.email.trim();
  if (input.notes !== undefined) doc.notes = input.notes.trim();
  if (input.isActive !== undefined) doc.isActive = input.isActive;
  if (input.openingBalance !== undefined) doc.openingBalance = input.openingBalance;
  doc.updatedBy = new Types.ObjectId(actorId);
  await doc.save();
  if (input.openingBalance !== undefined) {
    await recomputePersonRollup(id);
    const refreshed = await LiabilityPersonModel.findById(id);
    if (refreshed) doc.set(refreshed.toObject());
  }

  await createAuditLog({
    actorId,
    action: "liability.person.update",
    entity: "liability_person",
    entityId: doc._id.toString(),
    oldValue: prev as unknown as Record<string, unknown>,
    newValue: {
      name: doc.name,
      phone: doc.phone,
      email: doc.email,
      notes: doc.notes,
      isActive: doc.isActive,
      openingBalance: doc.openingBalance,
    },
    requestId,
  });

  return doc;
}

export async function listLiabilityPersons(query: ListLiabilityPersonQuery) {
  const page = query.page;
  const pageSize = pageSizeFromQuery(query);
  const skip = (page - 1) * pageSize;
  const sortValue = query.sortOrder === "asc" ? 1 : -1;

  const conditions: Record<string, unknown>[] = [];
  const search = trimUndef(query.search);
  if (search) {
    const esc = escapeRegex(search);
    conditions.push({
      $or: [
        { name: { $regex: esc, $options: "i" } },
        { phone: { $regex: esc, $options: "i" } },
        { email: { $regex: esc, $options: "i" } },
      ],
    });
  }
  if (query.isActive === "true") conditions.push({ isActive: true });
  if (query.isActive === "false") conditions.push({ isActive: false });

  const filter = conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : { $and: conditions };

  const [rows, total] = await Promise.all([
    LiabilityPersonModel.find(filter)
      .populate("createdBy", "fullName username")
      .populate("updatedBy", "fullName username")
      .sort({ [query.sortBy]: sortValue })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    LiabilityPersonModel.countDocuments(filter),
  ]);

  return {
    rows,
    meta: { total, page, pageSize },
  };
}

export async function createLiabilityEntry(
  input: {
    entryDate: string;
    entryType: "receipt" | "payment" | "contra" | "journal";
    amount: number;
    fromAccountType: "bank" | "person" | "expense";
    fromAccountId: string;
    toAccountType: "bank" | "person" | "expense";
    toAccountId: string;
    sourceType?: "expense";
    sourceExpenseId?: string;
    referenceNo?: string;
    remark?: string;
  },
  actorId: string,
  requestId?: string,
) {
  validateDistinctEndpoints(input);
  await Promise.all([
    ensureAccountExists(input.fromAccountType, input.fromAccountId),
    ensureAccountExists(input.toAccountType, input.toAccountId),
  ]);

  const doc = await LiabilityEntryModel.create({
    entryDate: parseYmdToDate(input.entryDate),
    entryType: input.entryType,
    amount: input.amount,
    fromAccountType: input.fromAccountType,
    fromAccountId: new Types.ObjectId(input.fromAccountId),
    toAccountType: input.toAccountType,
    toAccountId: new Types.ObjectId(input.toAccountId),
    sourceType: input.sourceType,
    sourceExpenseId: input.sourceExpenseId ? new Types.ObjectId(input.sourceExpenseId) : undefined,
    referenceNo: input.referenceNo?.trim() ?? "",
    remark: input.remark?.trim() ?? "",
    createdBy: new Types.ObjectId(actorId),
  });

  const recalcTargets = new Set<string>();
  if (input.fromAccountType === "person") recalcTargets.add(input.fromAccountId);
  if (input.toAccountType === "person") recalcTargets.add(input.toAccountId);
  await Promise.all([...recalcTargets].map((personId) => recomputePersonRollup(personId)));

  await createAuditLog({
    actorId,
    action: "liability.entry.create",
    entity: "liability_entry",
    entityId: doc._id.toString(),
    newValue: {
      entryDate: input.entryDate,
      entryType: input.entryType,
      amount: input.amount,
      fromAccountType: input.fromAccountType,
      fromAccountId: input.fromAccountId,
      toAccountType: input.toAccountType,
      toAccountId: input.toAccountId,
      sourceType: input.sourceType,
      sourceExpenseId: input.sourceExpenseId,
      referenceNo: input.referenceNo?.trim() || undefined,
      remark: input.remark?.trim() || undefined,
    },
    requestId,
  });

  return doc;
}

export async function listLiabilityEntries(query: ListLiabilityEntryQuery) {
  const page = query.page;
  const pageSize = pageSizeFromQuery(query);
  const skip = (page - 1) * pageSize;
  const sortValue = query.sortOrder === "asc" ? 1 : -1;

  const conditions: Record<string, unknown>[] = [];
  if (query.entryType) conditions.push({ entryType: query.entryType });

  const accountType = trimUndef(query.accountType);
  const accountId = trimUndef(query.accountId);
  if (accountType && accountId && Types.ObjectId.isValid(accountId)) {
    const aid = new Types.ObjectId(accountId);
    conditions.push({
      $or: [
        { fromAccountType: accountType, fromAccountId: aid },
        { toAccountType: accountType, toAccountId: aid },
      ],
    });
  }

  const search = trimUndef(query.search);
  if (search) {
    const esc = escapeRegex(search);
    conditions.push({
      $or: [
        { referenceNo: { $regex: esc, $options: "i" } },
        { remark: { $regex: esc, $options: "i" } },
      ],
    });
  }

  const from = trimUndef(query.entryDate_from);
  const to = trimUndef(query.entryDate_to);
  const fromD = from ? ymdStart(from) : null;
  const toD = to ? ymdEnd(to) : null;
  if (fromD || toD) {
    conditions.push({
      entryDate: {
        ...(fromD ? { $gte: fromD } : {}),
        ...(toD ? { $lte: toD } : {}),
      },
    });
  }

  const filter = conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : { $and: conditions };

  const [rows, total] = await Promise.all([
    LiabilityEntryModel.find(filter)
      .populate("createdBy", "fullName username")
      .sort({ [query.sortBy]: sortValue })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    LiabilityEntryModel.countDocuments(filter),
  ]);

  const accountIds = new Set<string>();
  rows.forEach((r) => {
    accountIds.add(String(r.fromAccountId));
    accountIds.add(String(r.toAccountId));
  });
  const objectIds = [...accountIds]
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  const [banks, persons, expenses] = await Promise.all([
    BankModel.find({ _id: { $in: objectIds } }).select("_id holderName bankName accountNumber").lean(),
    LiabilityPersonModel.find({ _id: { $in: objectIds } }).select("_id name").lean(),
    ExpenseModel.find({ _id: { $in: objectIds } }).select("_id description").lean(),
  ]);
  const bankMap = new Map(
    banks.map((b) => [
      String(b._id),
      `${b.holderName} — ${b.bankName}${b.accountNumber ? ` (${String(b.accountNumber).slice(-4)})` : ""}`.trim(),
    ]),
  );
  const personMap = new Map(persons.map((p) => [String(p._id), p.name]));
  const expenseMap = new Map(
    expenses.map((e) => [String(e._id), e.description?.trim() ? `Expense: ${e.description.trim()}` : `Expense ${String(e._id).slice(-6)}`]),
  );

  const mapped = rows.map((r) => {
    const fromId = String(r.fromAccountId);
    const toId = String(r.toAccountId);
    return {
      ...r,
      fromAccountName:
        r.fromAccountType === "bank"
          ? bankMap.get(fromId) ?? fromId
          : r.fromAccountType === "person"
            ? personMap.get(fromId) ?? fromId
            : expenseMap.get(fromId) ?? fromId,
      toAccountName:
        r.toAccountType === "bank"
          ? bankMap.get(toId) ?? toId
          : r.toAccountType === "person"
            ? personMap.get(toId) ?? toId
            : expenseMap.get(toId) ?? toId,
    };
  });

  return {
    rows: mapped,
    meta: { total, page, pageSize },
  };
}

export async function getLiabilityPersonLedger(personId: string, query: LedgerQuery) {
  if (!Types.ObjectId.isValid(personId)) throw new AppError("validation_error", "Invalid person id", 400);
  const pid = new Types.ObjectId(personId);
  const person = await LiabilityPersonModel.findById(pid).lean();
  if (!person) throw new AppError("not_found", "Liability person not found", 404);

  const entries = await LiabilityEntryModel.find({
    $or: [
      { fromAccountType: "person", fromAccountId: pid },
      { toAccountType: "person", toAccountId: pid },
    ],
  })
    .sort({ entryDate: 1, createdAt: 1 })
    .lean();

  const from = query.fromDate ? ymdStart(query.fromDate) : null;
  const to = query.toDate ? ymdEnd(query.toDate) : null;

  let running = person.openingBalance ?? 0;
  const rows: Array<{
    _id: string;
    at: string;
    entryType: string;
    from: string;
    to: string;
    debit: number;
    credit: number;
    runningBalance: number;
    referenceNo?: string;
    remark?: string;
  }> = [];

  const accountIds = new Set<string>([personId]);
  entries.forEach((e) => {
    accountIds.add(String(e.fromAccountId));
    accountIds.add(String(e.toAccountId));
  });
  const objectIds = [...accountIds]
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  const [banks, persons, expenses] = await Promise.all([
    BankModel.find({ _id: { $in: objectIds } }).select("_id holderName bankName accountNumber").lean(),
    LiabilityPersonModel.find({ _id: { $in: objectIds } }).select("_id name").lean(),
    ExpenseModel.find({ _id: { $in: objectIds } }).select("_id description").lean(),
  ]);
  const bankMap = new Map(
    banks.map((b) => [
      String(b._id),
      `${b.holderName} — ${b.bankName}${b.accountNumber ? ` (${String(b.accountNumber).slice(-4)})` : ""}`.trim(),
    ]),
  );
  const personMap = new Map(persons.map((p) => [String(p._id), p.name]));
  const expenseMap = new Map(
    expenses.map((e) => [String(e._id), e.description?.trim() ? `Expense: ${e.description.trim()}` : `Expense ${String(e._id).slice(-6)}`]),
  );

  for (const e of entries) {
    const at = new Date(e.entryDate ?? e.createdAt ?? new Date(0));
    const isInRange = (!from || at >= from) && (!to || at <= to);
    const fromId = String(e.fromAccountId);
    const toId = String(e.toAccountId);
    const isPersonFrom = e.fromAccountType === "person" && fromId === personId;
    const isPersonTo = e.toAccountType === "person" && toId === personId;
    const debit = isPersonTo ? e.amount : 0;
    const credit = isPersonFrom ? e.amount : 0;
    running += debit - credit;

    if (isInRange) {
      rows.push({
        _id: String(e._id),
        at: at.toISOString(),
        entryType: e.entryType,
        from:
          e.fromAccountType === "bank"
            ? bankMap.get(fromId) ?? fromId
            : e.fromAccountType === "person"
              ? personMap.get(fromId) ?? fromId
              : expenseMap.get(fromId) ?? fromId,
        to:
          e.toAccountType === "bank"
            ? bankMap.get(toId) ?? toId
            : e.toAccountType === "person"
              ? personMap.get(toId) ?? toId
              : expenseMap.get(toId) ?? toId,
        debit,
        credit,
        runningBalance: running,
        referenceNo: e.referenceNo?.trim() || undefined,
        remark: e.remark?.trim() || undefined,
      });
    }
  }

  return {
    person: {
      _id: String(person._id),
      name: person.name,
      openingBalance: person.openingBalance ?? 0,
    },
    rows,
    closingBalance: running,
  };
}

function formatUserForExport(user: unknown): string {
  if (user == null) return "";
  if (typeof user === "object" && user !== null && "fullName" in user) {
    const u = user as { fullName?: string; username?: string };
    const fn = u.fullName?.trim();
    const un = u.username?.trim();
    if (fn && un) return `${fn} (${un})`;
    if (fn) return fn;
    if (un) return un;
  }
  return "";
}

export async function exportLiabilityPersonsToBuffer(query: ListLiabilityPersonQuery): Promise<Buffer> {
  const result = await listLiabilityPersons({ ...query, page: 1, limit: EXPORT_MAX_ROWS });
  const exportData = result.rows.map((r) => ({
    Name: r.name,
    Phone: r.phone ?? "",
    Email: r.email ?? "",
    Status: r.isActive ? "Active" : "Inactive",
    "Opening Balance": r.openingBalance ?? 0,
    "Total Credits": r.totalCredits ?? 0,
    "Total Debits": r.totalDebits ?? 0,
    "Closing Balance": r.closingBalance ?? 0,
    Notes: r.notes ?? "",
    "Created By": formatUserForExport(r.createdBy),
    "Updated By": formatUserForExport(r.updatedBy),
    "Created At": r.createdAt ? new Date(r.createdAt).toISOString() : "",
  }));

  return generateExcelBuffer(exportData, "Liability Persons");
}

export async function exportLiabilityEntriesToBuffer(query: ListLiabilityEntryQuery): Promise<Buffer> {
  const result = await listLiabilityEntries({ ...query, page: 1, limit: EXPORT_MAX_ROWS });
  const exportData = result.rows.map((r) => ({
    Date: r.entryDate ? new Date(r.entryDate).toISOString().split("T")[0] : "",
    Type: r.entryType,
    Amount: r.amount,
    "From Account": r.fromAccountName,
    "To Account": r.toAccountName,
    "Reference No": r.referenceNo ?? "",
    Remark: r.remark ?? "",
    "Source Type": r.sourceType ?? "",
    "Created By": formatUserForExport(r.createdBy),
    "Created At": r.createdAt ? new Date(r.createdAt).toISOString() : "",
  }));

  return generateExcelBuffer(exportData, "Liability Entries");
}

export async function exportLiabilityLedgerToBuffer(personId: string, query: LedgerQuery): Promise<Buffer> {
  const result = await getLiabilityPersonLedger(personId, query);
  const exportData = result.rows.map((r) => ({
    Date: r.at ? new Date(r.at).toISOString().split("T")[0] : "",
    "Entry Type": r.entryType,
    From: r.from,
    To: r.to,
    Debit: r.debit,
    Credit: r.credit,
    "Running Balance": r.runningBalance,
    "Reference No": r.referenceNo ?? "",
    Remark: r.remark ?? "",
  }));

  return generateExcelBuffer(exportData, `Ledger - ${result.person.name}`);
}
export async function getLiabilityReportSummary() {
  const persons = await LiabilityPersonModel.find({ isActive: true }).lean();
  let totalReceivable = 0;
  let totalPayable = 0;
  persons.forEach((p) => {
    const bal = Number(p.closingBalance ?? p.openingBalance ?? 0);
    if (bal > 0) totalReceivable += bal;
    if (bal < 0) totalPayable += Math.abs(bal);
  });

  return {
    totalReceivable,
    totalPayable,
    netPosition: totalReceivable - totalPayable,
    totalPersons: persons.length,
  };
}

export async function getLiabilityReportPersonWise() {
  const persons = await LiabilityPersonModel.find({}).lean();

  return persons.map((p) => {
    const balance = Number(p.closingBalance ?? p.openingBalance ?? 0);
    return {
      personId: String(p._id),
      name: p.name,
      isActive: p.isActive,
      balance,
      totalCredits: Number(p.totalCredits ?? 0),
      totalDebits: Number(p.totalDebits ?? 0),
      side: balance >= 0 ? "receivable" : "payable",
    };
  });
}
