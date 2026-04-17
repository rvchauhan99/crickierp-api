import { Schema, model, Types } from "mongoose";

/** pending = awaiting exchange; verified = approved and settled on bank; rejected = exchange rejected; finalized = legacy */
export type DepositStatus = "pending" | "verified" | "rejected" | "finalized";

/** Snapshot of deposit fields stored on each amendment entry (plain ids for JSON stability). */
export interface DepositAmendmentSnapshot {
  bankId?: string;
  bankName?: string;
  utr?: string;
  amount?: number;
  playerId?: string;
  bonusAmount?: number;
  totalAmount?: number;
}

export interface DepositAmendmentEntry {
  at: Date;
  by: Types.ObjectId;
  reason: string;
  old: DepositAmendmentSnapshot;
  new: DepositAmendmentSnapshot;
}

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
  /** Master Reason row for rejection (optional for legacy). */
  rejectReasonId?: Types.ObjectId;
  exchangeActionBy?: Types.ObjectId;
  exchangeActionAt?: Date;
  bankBalanceAfter?: number;
  settledAt?: Date;
  /** Number of successful post-settlement amendments. */
  amendmentCount?: number;
  lastAmendedAt?: Date;
  lastAmendedBy?: Types.ObjectId;
  amendmentHistory?: DepositAmendmentEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const amendmentSnapshotSchema = new Schema<DepositAmendmentSnapshot>(
  {
    bankId: { type: String, trim: true },
    bankName: { type: String, trim: true },
    utr: { type: String, trim: true },
    amount: { type: Number },
    playerId: { type: String, trim: true },
    bonusAmount: { type: Number },
    totalAmount: { type: Number },
  },
  { _id: false },
);

const amendmentEntrySchema = new Schema<DepositAmendmentEntry>(
  {
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    reason: { type: String, required: true, trim: true },
    old: { type: amendmentSnapshotSchema, required: true },
    new: { type: amendmentSnapshotSchema, required: true },
  },
  { _id: false },
);

const depositSchema = new Schema<DepositDocument>(
  {
    bankId: { type: Schema.Types.ObjectId, ref: "Bank" },
    bankName: { type: String, trim: true, default: "" },
    utr: { type: String, required: true, trim: true },
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
    rejectReasonId: { type: Schema.Types.ObjectId, ref: "Reason" },
    exchangeActionBy: { type: Schema.Types.ObjectId, ref: "User" },
    exchangeActionAt: { type: Date },
    bankBalanceAfter: { type: Number, min: 0 },
    settledAt: { type: Date },
    amendmentCount: { type: Number, min: 0, default: 0 },
    lastAmendedAt: { type: Date },
    lastAmendedBy: { type: Schema.Types.ObjectId, ref: "User" },
    amendmentHistory: { type: [amendmentEntrySchema], default: [] },
  },
  { timestamps: true },
);

/** Uniqueness only for non-rejected deposits so a UTR may repeat on rejected rows. */
depositSchema.index(
  { utr: 1 },
  { unique: true, partialFilterExpression: { status: { $ne: "rejected" } } },
);

export const DepositModel = model<DepositDocument>("Deposit", depositSchema);
