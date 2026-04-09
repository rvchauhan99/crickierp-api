import { Schema, model, Types } from "mongoose";

export type DepositStatus = "pending" | "verified" | "finalized" | "rejected";

export interface DepositDocument {
  _id: Types.ObjectId;
  bankName: string;
  utr: string;
  amount: number;
  stage: "banker" | "exchange" | "final";
  status: DepositStatus;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const depositSchema = new Schema<DepositDocument>(
  {
    bankName: { type: String, required: true, trim: true },
    utr: { type: String, required: true, trim: true, unique: true },
    amount: { type: Number, required: true, min: 1 },
    stage: { type: String, enum: ["banker", "exchange", "final"], required: true },
    status: { type: String, enum: ["pending", "verified", "finalized", "rejected"], default: "pending" },
    createdBy: { type: Schema.Types.ObjectId, required: true, ref: "User" },
  },
  { timestamps: true },
);

export const DepositModel = model<DepositDocument>("Deposit", depositSchema);
