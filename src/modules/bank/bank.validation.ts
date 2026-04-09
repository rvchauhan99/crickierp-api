import { z } from "zod";

export const createBankBodySchema = z.object({
  holderName: z.string().min(2),
  bankName: z.string().min(2),
  accountNumber: z.string().min(6),
  ifsc: z.string().min(4),
  openingBalance: z.number().min(0),
  status: z.enum(["active", "deactive"]).default("active"),
});
