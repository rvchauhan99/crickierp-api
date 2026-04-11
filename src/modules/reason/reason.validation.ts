import { z } from "zod";
import { REASON_TYPES, type RejectionReasonType } from "../../shared/constants/reasonTypes";

const rejectionReasonTypeValues = [
  REASON_TYPES.DEPOSIT_EXCHANGE_REJECT,
  REASON_TYPES.WITHDRAWAL_BANKER_REJECT,
  REASON_TYPES.EXPENSE_AUDIT_REJECT,
] as const satisfies readonly RejectionReasonType[];

export const listReasonOptionsQuerySchema = z.object({
  reasonType: z.enum(rejectionReasonTypeValues),
  limit: z.coerce.number().int().positive().max(200).default(200),
});
