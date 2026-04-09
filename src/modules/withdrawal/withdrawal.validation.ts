import { z } from "zod";

export const createWithdrawalBodySchema = z.object({
  playerName: z.string().min(2),
  bankName: z.string().min(2),
  utr: z.string().optional(),
  amount: z.number().min(1),
  stage: z.enum(["exchange", "banker", "final"]),
});

export const updateWithdrawalStatusBodySchema = z.object({
  status: z.enum(["requested", "approved", "rejected", "finalized"]),
});
