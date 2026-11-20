import { Types } from "mongoose";
import xlsx from "xlsx";
import { AppError } from "../../shared/errors/AppError";
import { escapeRegex as escapeUtrRegex, normalizeUtr } from "../../shared/utils/utr";
import { logger } from "../../shared/logger";
import { enqueueExchangeRecompute } from "../../shared/queue/queue";
import { invalidateCacheDomains } from "../../shared/cache/domainCache";
import { createAuditLog } from "../audit/audit.service";
import { DepositModel } from "../deposit/deposit.model";
import {
  buildBankResolutionCache,
  loadBanksForImportIdentifiers,
} from "../deposit/deposit-import-resolve";
import { isLiabilityModuleEnabled } from "../settings/settings.service";
import { emitApprovalQueueEvent } from "../approval/approval-queue-events";
import { WithdrawalModel } from "./withdrawal.model";
import { updateWithdrawalByBanker } from "./withdrawal.service";

export const BANKER_UTR_UPLOAD_PRIORITY_HEADERS = [
  "Withdrawal ID",
  "Player ID",
  "Account Holder",
  "Account Number",
  "IFSC",
  "Amount",
  "Payable Amount",
  "Status",
  "UTR",
  "Payout Bank",
] as const;

export type BankerUtrUploadValidRow = {
  withdrawalId: string;
  utr: string;
  payoutBankId: string;
  row: number;
};

export type BankerUtrUploadSkippedRow = {
  row: number;
  withdrawalId: string;
  status: string;
  reason: string;
};

export type BankerUtrUploadInvalidRow = {
  row: number;
  withdrawalId: string;
  utr: string;
  payoutBank: string;
  errors: string[];
};

export type BankerUtrUploadValidationResult = {
  summary: { total: number; valid: number; skipped: number; invalid: number };
  validRows: BankerUtrUploadValidRow[];
  skippedRows: BankerUtrUploadSkippedRow[];
  invalidRows: BankerUtrUploadInvalidRow[];
};

function normalizeHeaderKey(raw: string): string {
  return String(raw).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickCell(row: Record<string, unknown>, ...aliases: string[]): string {
  const wanted = new Set(aliases.map((a) => normalizeHeaderKey(a)));
  for (const [key, val] of Object.entries(row)) {
    if (!wanted.has(normalizeHeaderKey(key))) continue;
    if (val != null && String(val).trim() !== "") return String(val).trim();
  }
  return "";
}

function readSheetRows(
  buffer: Buffer,
  originalName: string,
): Record<string, unknown>[] {
  const lower = originalName.toLowerCase();
  if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
    throw new AppError("validation_error", "Unsupported file type. Use .csv, .xlsx, or .xls", 400);
  }
  const wb = xlsx.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new AppError("validation_error", "File is empty or has no sheets", 400);
  }
  return xlsx.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
    defval: "",
    raw: false,
  });
}

export function bankerUtrUploadSampleHeaders(): string[] {
  const headers: string[] = [...BANKER_UTR_UPLOAD_PRIORITY_HEADERS];
  if (isLiabilityModuleEnabled()) {
    headers.push("Payout settlement", "Payout liable person");
  }
  headers.push("Created By", "Approved By", "Transaction At");
  return headers;
}

export function buildBankerUtrUploadSampleXlsx(): Buffer {
  const headers = bankerUtrUploadSampleHeaders();
  const sample: Record<string, string> = {};
  for (const h of headers) sample[h] = "";
  sample["Withdrawal ID"] = "000000000000000000000000";
  sample["Player ID"] = "PLAYER01";
  sample["Account Holder"] = "John Doe";
  sample["Account Number"] = "1234567890";
  sample["IFSC"] = "HDFC0001234";
  sample["Amount"] = "1000";
  sample["Payable Amount"] = "1000";
  sample["Status"] = "requested";
  sample["UTR"] = "UTR1234567890";
  sample["Payout Bank"] = "991122334455";
  const worksheet = xlsx.utils.json_to_sheet([sample], { header: headers });
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "UTR Upload");
  return xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function buildBankerUtrUploadSampleCsv(): string {
  const headers = bankerUtrUploadSampleHeaders();
  const values = headers.map((h) => {
    if (h === "Withdrawal ID") return "000000000000000000000000";
    if (h === "Player ID") return "PLAYER01";
    if (h === "Account Holder") return "John Doe";
    if (h === "Account Number") return "1234567890";
    if (h === "IFSC") return "HDFC0001234";
    if (h === "Amount") return "1000";
    if (h === "Payable Amount") return "1000";
    if (h === "Status") return "requested";
    if (h === "UTR") return "UTR1234567890";
    if (h === "Payout Bank") return "991122334455";
    return "";
  });
  return `${headers.join(",")}\n${values.join(",")}\n`;
}

async function utrTakenElsewhere(utr: string, excludeWithdrawalId: Types.ObjectId): Promise<boolean> {
  const normalized = normalizeUtr(utr);
  const [depositConflict, withdrawalConflict] = await Promise.all([
    DepositModel.findOne({
      utr: { $regex: `^${escapeUtrRegex(normalized)}$`, $options: "i" },
      status: { $ne: "rejected" },
    })
      .select({ _id: 1 })
      .lean(),
    WithdrawalModel.findOne({
      utr: { $regex: `^${escapeUtrRegex(normalized)}$`, $options: "i" },
      status: { $ne: "rejected" },
      _id: { $ne: excludeWithdrawalId },
    })
      .select({ _id: 1 })
      .lean(),
  ]);
  return Boolean(depositConflict || withdrawalConflict);
}

export async function validateBankerUtrUploadFile(
  buffer: Buffer,
  originalName: string,
): Promise<BankerUtrUploadValidationResult> {
  const rows = readSheetRows(buffer, originalName);
  if (rows.length === 0) {
    throw new AppError("validation_error", "File has no data rows", 400);
  }
  if (rows.length > 10_000) {
    throw new AppError("validation_error", "Maximum 10000 rows allowed per upload", 400);
  }

  const parsed = rows.map((row, index) => {
    const excelRow = index + 2;
    return {
      excelRow,
      withdrawalId: pickCell(row, "Withdrawal ID", "withdrawalId", "id", "_id"),
      utrRaw: pickCell(row, "UTR", "utr", "Payout UTR"),
      payoutBank: pickCell(row, "Payout Bank", "payoutBank", "Bank Account", "payoutBankAccount"),
    };
  });

  const uniqueIds = [
    ...new Set(parsed.map((p) => p.withdrawalId).filter((id) => Types.ObjectId.isValid(id))),
  ];
  const docs = await WithdrawalModel.find({ _id: { $in: uniqueIds.map((id) => new Types.ObjectId(id)) } })
    .select({ _id: 1, status: 1, utr: 1 })
    .lean();
  const docById = new Map(docs.map((d) => [String(d._id), d]));

  const bankKeys = [
    ...new Set(parsed.map((p) => p.payoutBank.trim().toLowerCase()).filter(Boolean)),
  ];
  const bankMaps = await loadBanksForImportIdentifiers(bankKeys);
  const bankCache = buildBankResolutionCache(bankKeys, bankMaps);

  const validRows: BankerUtrUploadValidRow[] = [];
  const skippedRows: BankerUtrUploadSkippedRow[] = [];
  const invalidRows: BankerUtrUploadInvalidRow[] = [];
  const seenIds = new Set<string>();
  const seenUtrs = new Map<string, number>();

  for (const p of parsed) {
    const errors: string[] = [];
    const withdrawalId = p.withdrawalId.trim();
    if (!withdrawalId) {
      errors.push("Withdrawal ID is required");
    } else if (!Types.ObjectId.isValid(withdrawalId)) {
      errors.push("Withdrawal ID is invalid");
    } else if (seenIds.has(withdrawalId)) {
      errors.push("Duplicate Withdrawal ID in file");
    }

    const doc = withdrawalId && Types.ObjectId.isValid(withdrawalId) ? docById.get(withdrawalId) : undefined;
    if (withdrawalId && Types.ObjectId.isValid(withdrawalId) && !doc) {
      errors.push("Withdrawal not found");
    }

    if (doc && (doc.status === "approved" || doc.status === "rejected" || doc.status === "finalized")) {
      skippedRows.push({
        row: p.excelRow,
        withdrawalId,
        status: String(doc.status),
        reason: "Already actioned — skipped",
      });
      continue;
    }

    if (doc && doc.status !== "requested") {
      errors.push(`Unsupported status "${doc.status}" for UTR upload`);
    }

    const utrTrim = p.utrRaw.trim() ? normalizeUtr(p.utrRaw) : "";
    if (!utrTrim || utrTrim.length < 4) {
      errors.push("UTR is required (min 4 characters)");
    } else {
      const prior = seenUtrs.get(utrTrim.toLowerCase());
      if (prior != null) {
        errors.push(`Duplicate UTR in file (also on row ${prior})`);
      } else {
        seenUtrs.set(utrTrim.toLowerCase(), p.excelRow);
      }
    }

    const bankKey = p.payoutBank.trim().toLowerCase();
    let payoutBankId = "";
    if (!bankKey) {
      errors.push("Payout Bank is required");
    } else {
      const bankResult = bankCache.get(bankKey);
      if (!bankResult || bankResult.status === "not_found") {
        errors.push(`Payout bank "${p.payoutBank}" not found (tried account number and holder name)`);
      } else if (bankResult.status === "ambiguous") {
        errors.push(`Multiple banks found for "${p.payoutBank}". Use account number instead.`);
      } else if (bankResult.status === "inactive") {
        errors.push(`Payout bank "${bankResult.displayName}" is not active`);
      } else {
        payoutBankId = bankResult.id;
      }
    }

    if (errors.length === 0 && doc && utrTrim) {
      const taken = await utrTakenElsewhere(utrTrim, doc._id);
      if (taken) {
        errors.push("UTR already exists in another transaction");
      }
    }

    if (errors.length > 0) {
      invalidRows.push({
        row: p.excelRow,
        withdrawalId,
        utr: p.utrRaw,
        payoutBank: p.payoutBank,
        errors,
      });
      continue;
    }

    seenIds.add(withdrawalId);
    validRows.push({
      withdrawalId,
      utr: utrTrim,
      payoutBankId,
      row: p.excelRow,
    });
  }

  return {
    summary: {
      total: rows.length,
      valid: validRows.length,
      skipped: skippedRows.length,
      invalid: invalidRows.length,
    },
    validRows,
    skippedRows,
    invalidRows,
  };
}

export type BankerUtrUploadCommitProgress = {
  totalRows: number;
  processedRows: number;
  successRows: number;
  failedRows: number;
  skippedRows: number;
};

export type BankerUtrUploadCommitResult = {
  approved: number;
  skipped: number;
  failed: Array<{ withdrawalId: string; error: string }>;
};

function commitErrorMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof Error) return err.message;
  return "Approve failed";
}

export async function commitBankerUtrUploadRows(
  rows: Array<{ withdrawalId: string; utr: string; payoutBankId: string }>,
  actorId: string,
  requestId?: string,
  options?: {
    onProgress?: (progress: BankerUtrUploadCommitProgress) => Promise<void> | void;
  },
): Promise<BankerUtrUploadCommitResult> {
  const uniqueById = new Map<string, { withdrawalId: string; utr: string; payoutBankId: string }>();
  for (const row of rows) {
    if (!Types.ObjectId.isValid(row.withdrawalId)) continue;
    uniqueById.set(row.withdrawalId, row);
  }
  const list = [...uniqueById.values()];
  if (list.length === 0) {
    throw new AppError("validation_error", "At least one valid row is required", 400);
  }

  const bulkContext = {
    exchangeIds: new Set<string>(),
    personSettlementSeen: false,
  };
  const failed: BankerUtrUploadCommitResult["failed"] = [];
  let approved = 0;
  let skipped = 0;
  let processedRows = 0;

  for (const row of list) {
    try {
      const doc = await WithdrawalModel.findById(row.withdrawalId).select("status").lean();
      if (!doc) {
        failed.push({ withdrawalId: row.withdrawalId, error: "Withdrawal not found" });
      } else if (doc.status === "approved" || doc.status === "rejected" || doc.status === "finalized") {
        skipped += 1;
      } else if (doc.status !== "requested") {
        failed.push({
          withdrawalId: row.withdrawalId,
          error: `Unsupported status "${doc.status}"`,
        });
      } else {
        await updateWithdrawalByBanker(
          row.withdrawalId,
          {
            payoutSettlementType: "bank",
            utr: row.utr,
            bankId: row.payoutBankId,
          },
          actorId,
          requestId,
          { deferSideEffects: true, bulkContext },
        );
        approved += 1;
      }
    } catch (err) {
      failed.push({ withdrawalId: row.withdrawalId, error: commitErrorMessage(err) });
    } finally {
      processedRows += 1;
      if (options?.onProgress) {
        await options.onProgress({
          totalRows: list.length,
          processedRows,
          successRows: approved,
          failedRows: failed.length,
          skippedRows: skipped,
        });
      }
    }
  }

  if (approved > 0) {
    emitApprovalQueueEvent("withdrawal", "exchange");
    for (const exchangeId of bulkContext.exchangeIds) {
      try {
        await enqueueExchangeRecompute(exchangeId);
      } catch (err) {
        logger.error({ err, exchangeId, requestId }, "Banker UTR upload recompute failed");
      }
    }
    try {
      await invalidateCacheDomains(["withdrawal", "exchange", "player"]);
    } catch (err) {
      logger.error({ err, requestId }, "Banker UTR upload cache invalidation failed");
    }

    setImmediate(() => {
      void createAuditLog({
        actorId,
        action: "withdrawal.banker_utr_upload",
        entity: "withdrawal",
        entityId: "bulk",
        newValue: { approved, skipped, failed: failed.length, total: list.length },
        requestId,
      }).catch((err) => {
        logger.warn({ err }, "banker utr upload audit failed");
      });
    });
  }

  return { approved, skipped, failed };
}
