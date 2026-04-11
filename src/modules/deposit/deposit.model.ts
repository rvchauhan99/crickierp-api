import { Schema, model, Types } from "mongoose";

/** pending = awaiting exchange; verified = approved and settled on bank; rejected = exchange rejected; finalized = legacy */
export type DepositStatus = "pending" | "verified" | "rejected" | "finalized";

export interface DepositDocument {
  _id: Types.ObjectId;
  bankId?: Types.ObjectId;
  /** Denormalized display label (legacy rows may only have this). */
  bankName: string;
  utr: string;
  amount: number;
  status: DepositStatus;
  createdBy: Types.ObjectId;
  player?: Types.ObjectId;
  bonusAmount?: number;
  totalAmount?: number;
  rejectReason?: string;
  exchangeActionBy?: Types.ObjectId;
  exchangeActionAt?: Date;
  bankBalanceAfter?: number;
  settledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const depositSchema = new Schema<DepositDocument>(
  {
    bankId: { type: Schema.Types.ObjectId, ref: "Bank" },
    bankName: { type: String, trim: true, default: "" },
    utr: { type: String, required: true, trim: true, unique: true },
    amount: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ["pending", "verified", "rejected", "finalized"],
      default: "pending",
    },
    createdBy: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    player: { type: Schema.Types.ObjectId, ref: "Player" },
    bonusAmount: { type: Number, min: 0 },
    totalAmount: { type: Number, min: 0 },
    rejectReason: { type: String, trim: true },
    exchangeActionBy: { type: Schema.Types.ObjectId, ref: "User" },
    exchangeActionAt: { type: Date },
    bankBalanceAfter: { type: Number, min: 0 },
    settledAt: { type: Date },
  },
  { timestamps: true },
);

export const DepositModel = model<DepositDocument>("Deposit", depositSchema);
