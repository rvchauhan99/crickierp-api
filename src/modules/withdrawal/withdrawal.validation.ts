import { z } from "zod";

const optionalDateTime = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    const trimmed = String(value).trim();
    return trimmed === "" ? undefined : trimmed;
  },
  z.string().datetime({ offset: true }).optional(),
);

export const createWithdrawalBodySchema = z.object({
  playerId: z.string().length(24),
  accountNumber: z.string().min(1).max(40).trim(),
  accountHolderName: z.string().min(1).max(120).trim(),
  bankName: z.string().min(1).max(120).trim(),
  ifsc: z.string().min(4).max(20).trim(),
  amount: z.number().min(1),
  reverseBonus: z.number().min(0).optional().default(0),
  requestedAt: optionalDateTime,
});

export const withdrawalBankerPayoutBodySchema = z.object({
  bankId: z.string().length(24),
  utr: z.string().min(4).max(120).trim(),
});

export const updateWithdrawalBodySchema = z.object({
  accountNumber: z.string().min(1).max(40).trim(),
  accountHolderName: z.string().min(1).max(120).trim(),
  bankName: z.string().min(1).max(120).trim(),
  ifsc: z.string().min(4).max(20).trim(),
  amount: z.number().min(1),
  reverseBonus: z.number().min(0).optional().default(0),
});

export const listWithdrawalQuerySchema = z.object({
  view: z.enum(["exchange", "banker", "final"]).default("exchange"),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(20),
  limit: z.coerce.number().int().positive().max(500).optional(),
  sortBy: z
    .enum(["requestedAt", "createdAt", "amount", "payableAmount", "status", "playerName", "bankName", "utr"])
    .default("requestedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  status: z.string().optional(),
  playerName: z.string().optional(),
  playerName_op: z.string().optional(),
  utr: z.string().optional(),
  utr_op: z.string().optional(),
  bankName: z.string().optional(),
  bankName_op: z.string().optional(),
  amount: z.string().optional(),
  amount_to: z.string().optional(),
  amount_op: z.string().optional(),
  payableAmount: z.string().optional(),
  payableAmount_to: z.string().optional(),
  payableAmount_op: z.string().optional(),
  createdAt_from: z.string().optional(),
  createdAt_to: z.string().optional(),
  createdAt_op: z.string().optional(),
  hasAmendment: z.enum(["yes", "no"]).optional(),
});

export const updateWithdrawalStatusBodySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("rejected"),
    reasonId: z.string().length(24),
    remark: z.string().max(2000).trim().optional(),
  }),
  z.object({
    status: z.literal("finalized"),
  }),
]);

export const amendWithdrawalBodySchema = z.object({
  amount: z.number().min(1),
  reverseBonus: z.number().min(0),
  payoutBankId: z.string().length(24),
  utr: z.string().min(4).max(120).trim(),
  requestedAt: optionalDateTime,
  reasonId: z.string().length(24),
  remark: z.string().max(2000).trim().optional(),
});
