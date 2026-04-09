import { z } from "zod";

export const createDepositBodySchema = z.object({
  bankName: z.string().min(2),
  utr: z.string().min(4),
  amount: z.number().min(1),
  stage: z.enum(["banker", "exchange", "final"]),
});

export const updateDepositStatusBodySchema = z.object({
  status: z.enum(["pending", "verified", "finalized", "rejected"]),
});
