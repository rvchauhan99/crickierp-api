import { Schema, model, Types } from "mongoose";

export type WithdrawalStatus = "requested" | "approved" | "rejected" | "finalized";

export interface WithdrawalDocument {
  _id: Types.ObjectId;
  playerName: string;
  bankName: string;
  utr?: string;
  amount: number;
  stage: "exchange" | "banker" | "final";
  status: WithdrawalStatus;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const withdrawalSchema = new Schema<WithdrawalDocument>(
  {
    playerName: { type: String, required: true, trim: true },
    bankName: { type: String, required: true, trim: true },
    utr: { type: String, trim: true },
    amount: { type: Number, required: true, min: 1 },
    stage: { type: String, enum: ["exchange", "banker", "final"], required: true },
    status: { type: String, enum: ["requested", "approved", "rejected", "finalized"], default: "requested" },
    createdBy: { type: Schema.Types.ObjectId, required: true, ref: "User" },
  },
  { timestamps: true },
);

export const WithdrawalModel = model<WithdrawalDocument>("Withdrawal", withdrawalSchema);
