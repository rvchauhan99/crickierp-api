import { z } from "zod";

export const createDepositBodySchema = z.object({
  bankId: z.string().length(24),
  utr: z.string().min(4).max(120).trim(),
  amount: z.number().min(1),
});

export const updateDepositBodySchema = createDepositBodySchema;

export const listDepositQuerySchema = z.object({
  view: z.enum(["banker", "exchange", "final"]).default("banker"),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(20),
  limit: z.coerce.number().int().positive().max(500).optional(),
  sortBy: z
    .enum(["createdAt", "amount", "utr", "status", "totalAmount", "settledAt", "bankName"])
    .default("createdAt"),
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
