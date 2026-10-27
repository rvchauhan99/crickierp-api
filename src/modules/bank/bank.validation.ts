import { z } from "zod";
import { moneyFxInputSchema, openingMoneyFxInputSchema } from "../../shared/validation/moneyFx.validation";
import { dashboardSummaryQuerySchema } from "../reports/reports.validation";

/** Same filters as dashboard summary — used by GET /bank/summary. */
export const bankSummaryQuerySchema = dashboardSummaryQuerySchema;

export const createBankBodySchema = z.object({
  holderName: z.string().min(2),
  bankName: z.string().min(2),
  accountNumber: z.string().min(6),
  ifsc: z.string().min(4),
  openingBalance: z.number().min(0),
  status: z.enum(["active", "deactive"]).default("active"),
}).merge(openingMoneyFxInputSchema);

export const listBankQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(20),
  limit: z.coerce.number().int().positive().max(500).optional(),
  sortBy: z
    .enum(["createdAt", "holderName", "bankName", "accountNumber", "ifsc", "openingBalance", "status"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  holderName: z.string().optional(),
  holderName_op: z.string().optional(),
  bankName: z.string().optional(),
  bankName_op: z.string().optional(),
  accountNumber: z.string().optional(),
  accountNumber_op: z.string().optional(),
  ifsc: z.string().optional(),
  ifsc_op: z.string().optional(),
  status: z.string().optional(),
  createdBy: z.string().optional(),
  createdAt_from: z.string().optional(),
  createdAt_to: z.string().optional(),
  createdAt_op: z.string().optional(),
  openingBalance: z.string().optional(),
  openingBalance_to: z.string().optional(),
  openingBalance_op: z.string().optional(),
});

export const bankLedgerQuerySchema = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  entryType: z
    .enum(["all", "deposit", "withdrawal", "expense", "liability", "transfer", "settlement"])
    .default("all"),
});

const optionalTrimmed = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? undefined : String(v).trim()),
  z.string().optional(),
);

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "entryDate must be YYYY-MM-DD");

/** Bank → Bank internal transfer only (no person accounts). */
export const createBankTransferBodySchema = z
  .object({
    fromBankId: z.string().length(24),
    toBankId: z.string().length(24),
    amount: z.number().min(0.01),
    entryDate: ymd,
    referenceNo: optionalTrimmed,
    remark: optionalTrimmed,
  })
  .merge(moneyFxInputSchema)
  .superRefine((data, ctx) => {
    if (data.fromBankId === data.toBankId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "From bank and To bank must be different",
        path: ["toBankId"],
      });
    }
  });

export const listBankTransferQuerySchema = z.object({
  search: optionalTrimmed,
  bankId: z.string().length(24).optional(),
  entryDate_from: optionalTrimmed,
  entryDate_to: optionalTrimmed,
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(20),
  limit: z.coerce.number().int().positive().max(500).optional(),
  sortBy: z.enum(["createdAt", "entryDate", "amount"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createBankSettlementBodySchema = z.object({
  effectiveAt: z.coerce.date(),
  masterReportedBalance: z.coerce.number().finite().nonnegative(),
  reason: z.string().trim().min(3).max(4000),
});

export const bankIdParamSchema = z.object({
  id: z.string().length(24),
});
