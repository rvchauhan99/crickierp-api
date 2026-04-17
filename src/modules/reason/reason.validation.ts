import { z } from "zod";
import { REASON_TYPES, type ReasonType } from "../../shared/constants/reasonTypes";

const rejectionReasonTypeValues = [
  REASON_TYPES.DEPOSIT_EXCHANGE_REJECT,
  REASON_TYPES.WITHDRAWAL_BANKER_REJECT,
  REASON_TYPES.EXPENSE_AUDIT_REJECT,
  REASON_TYPES.DEPOSIT_FINAL_AMEND,
  REASON_TYPES.WITHDRAWAL_FINAL_AMEND,
] as const satisfies readonly ReasonType[];

export const listReasonOptionsQuerySchema = z.object({
  reasonType: z.enum(rejectionReasonTypeValues),
  limit: z.coerce.number().int().positive().max(200).default(200),
});
