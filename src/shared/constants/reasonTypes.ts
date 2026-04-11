/** Values stored on Reason documents (`reasonType`) for rejection flows. */
export const REASON_TYPES = {
  DEPOSIT_EXCHANGE_REJECT: "deposit_exchange_reject",
  WITHDRAWAL_BANKER_REJECT: "withdrawal_banker_reject",
  EXPENSE_AUDIT_REJECT: "expense_audit_reject",
} as const;

export type RejectionReasonType = (typeof REASON_TYPES)[keyof typeof REASON_TYPES];
