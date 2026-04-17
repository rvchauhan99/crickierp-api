import { z } from "zod";

const optionalDateTime = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    const trimmed = String(value).trim();
    return trimmed === "" ? undefined : trimmed;
  },
  z.string().datetime({ offset: true }).optional(),
);

export const createDepositBodySchema = z.object({
  bankId: z.string().length(24),
  utr: z.string().min(4).max(120).trim(),
  amount: z.number().min(1),
  entryAt: optionalDateTime,
});

export const updateDepositBodySchema = createDepositBodySchema;

export const listDepositQuerySchema = z.object({
  view: z.enum(["banker", "exchange", "final"]).default("banker"),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(20),
  limit: z.coerce.number().int().positive().max(500).optional(),
  sortBy: z
    .enum(["entryAt", "createdAt", "amount", "utr", "status", "totalAmount", "settledAt", "bankName"])
    .default("entryAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  utr: z.string().optional(),
  utr_op: z.string().optional(),
  bankName: z.string().optional(),
  bankName_op: z.string().optional(),
  bankId: z.string().optional(),
  status: z.string().optional(),
  amount: z.string().optional(),
  amount_to: z.string().optional(),
  amount_op: z.string().optional(),
  totalAmount: z.string().optional(),
  totalAmount_to: z.string().optional(),
  totalAmount_op: z.string().optional(),
  player: z.string().optional(),
  createdBy: z.string().optional(),
  createdAt_from: z.string().optional(),
  createdAt_to: z.string().optional(),
  createdAt_op: z.string().optional(),
  /** Filter: deposits that have at least one amendment (`yes`) or none (`no`). */
  hasAmendment: z.enum(["yes", "no"]).optional(),
});

export const exchangeActionBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    playerId: z.string().length(24),
    bonusAmount: z.number().min(0),
  }),
  z.object({
    action: z.literal("reject"),
    reasonId: z.string().length(24),
    remark: z.string().max(2000).trim().optional(),
  }),
]);

/** Post-settlement amendment for verified deposits (bank + UTR + amount + player + bonus). */
export const amendDepositBodySchema = z.object({
  bankId: z.string().length(24),
  utr: z.string().min(4).max(120).trim(),
  amount: z.number().min(1),
  playerId: z.string().length(24),
  bonusAmount: z.number().min(0),
  entryAt: optionalDateTime,
  reasonId: z.string().length(24),
  remark: z.string().max(2000).trim().optional(),
});
