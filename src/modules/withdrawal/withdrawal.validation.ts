import { z } from "zod";

export const createWithdrawalBodySchema = z.object({
  playerId: z.string().length(24),
  accountNumber: z.string().min(1).max(40).trim(),
  accountHolderName: z.string().min(1).max(120).trim(),
  bankName: z.string().min(1).max(120).trim(),
  ifsc: z.string().min(4).max(20).trim(),
  amount: z.number().min(1),
  reverseBonus: z.number().min(0).optional().default(0),
});

export const withdrawalBankerPayoutBodySchema = z.object({
  bankId: z.string().length(24),
  utr: z.string().min(4).max(120).trim(),
});

export const listWithdrawalQuerySchema = z.object({
  view: z.enum(["exchange", "banker", "final"]).default("exchange"),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(20),
  limit: z.coerce.number().int().positive().max(500).optional(),
  sortBy: z
    .enum(["createdAt", "amount", "payableAmount", "status", "playerName", "bankName", "utr"])
    .default("createdAt"),
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
  createdAt_from: z.string().optional(),
  createdAt_to: z.string().optional(),
  createdAt_op: z.string().optional(),
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
