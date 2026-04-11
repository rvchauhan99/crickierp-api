import { Schema, model, Types } from "mongoose";

/** requested = awaiting banker payout UTR; approved = banker completed; rejected; finalized = closed */
export type WithdrawalStatus = "requested" | "approved" | "rejected" | "finalized";

export interface WithdrawalDocument {
  _id: Types.ObjectId;
  /** Set on new rows; legacy rows may omit until backfill */
  player?: Types.ObjectId;
  /** Denormalized for list/export */
  playerName: string;
  /** Beneficiary account (where withdrawal is paid). */
  accountNumber?: string;
  accountHolderName?: string;
  bankName: string;
  ifsc?: string;
  /** Exchange withdrawal amount */
  amount: number;
  reverseBonus?: number;
  /** amount - reverseBonus (stored for audit) */
  payableAmount?: number;
  /** Company bank used for payout (set by banker) */
  payoutBankId?: Types.ObjectId;
  payoutBankName?: string;
  utr?: string;
  /** Denormalized text from Reason master (+ optional remark). */
  rejectReason?: string;
  rejectReasonId?: Types.ObjectId;
  status: WithdrawalStatus;
  /** @deprecated Legacy queue field; list uses `view` query instead */
  stage?: "exchange" | "banker" | "final";
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const withdrawalSchema = new Schema<WithdrawalDocument>(
  {
    player: { type: Schema.Types.ObjectId, ref: "Player" },
    playerName: { type: String, required: true, trim: true },
    accountNumber: { type: String, trim: true, default: "" },
    accountHolderName: { type: String, trim: true, default: "" },
    bankName: { type: String, required: true, trim: true },
    ifsc: { type: String, trim: true, default: "" },
    amount: { type: Number, required: true, min: 1 },
    reverseBonus: { type: Number, min: 0, default: 0 },
    payableAmount: { type: Number, min: 0 },
    payoutBankId: { type: Schema.Types.ObjectId, ref: "Bank" },
    payoutBankName: { type: String, trim: true, default: "" },
    utr: { type: String, trim: true },
    rejectReason: { type: String, trim: true },
    rejectReasonId: { type: Schema.Types.ObjectId, ref: "Reason" },
    status: {
      type: String,
      enum: ["requested", "approved", "rejected", "finalized"],
      default: "requested",
    },
    stage: { type: String, enum: ["exchange", "banker", "final"] },
    createdBy: { type: Schema.Types.ObjectId, required: true, ref: "User" },
  },
  { timestamps: true },
);

export const WithdrawalModel = model<WithdrawalDocument>("Withdrawal", withdrawalSchema);
