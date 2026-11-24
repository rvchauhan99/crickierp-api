import { Schema, model, Types } from "mongoose";

export type LiabilityAccountType = "bank" | "person" | "expense" | "deposit" | "withdrawal";
export type LiabilityEntryType = "receipt" | "payment" | "contra" | "journal";
export type LiabilityEntrySourceType = "expense" | "deposit" | "withdrawal";

/** Snapshot of a bank↔bank transfer at amend time. */
export type BankTransferAmendmentSnapshot = {
  fromBankId?: string;
  toBankId?: string;
  amount?: number;
  operatedCurrency?: string;
  operatedAmount?: number;
  exchangeRate?: number;
  entryDate?: string;
  referenceNo?: string;
  remark?: string;
};

export type BankTransferAmendmentEntry = {
  at: Date;
  by: Types.ObjectId;
  reason: string;
  old: BankTransferAmendmentSnapshot;
  new: BankTransferAmendmentSnapshot;
};

export interface LiabilityEntryDocument {
  _id: Types.ObjectId;
  entryDate: Date;
  entryType: LiabilityEntryType;
  amount: number;
  operatedCurrency?: string;
  operatedAmount?: number;
  exchangeRate?: number;
  fromAccountType: LiabilityAccountType;
  fromAccountId: Types.ObjectId;
  toAccountType: LiabilityAccountType;
  toAccountId: Types.ObjectId;
  sourceType?: LiabilityEntrySourceType;
  sourceExpenseId?: Types.ObjectId;
  sourceDepositId?: Types.ObjectId;
  sourceWithdrawalId?: Types.ObjectId;
  referenceNo?: string;
  remark?: string;
  createdBy: Types.ObjectId;
  amendmentCount?: number;
  lastAmendedAt?: Date;
  lastAmendedBy?: Types.ObjectId;
  amendmentHistory?: BankTransferAmendmentEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const bankTransferAmendmentSnapshotSchema = new Schema<BankTransferAmendmentSnapshot>(
  {
    fromBankId: { type: String, trim: true },
    toBankId: { type: String, trim: true },
    amount: { type: Number },
    operatedCurrency: { type: String, trim: true },
    operatedAmount: { type: Number },
    exchangeRate: { type: Number },
    entryDate: { type: String, trim: true },
    referenceNo: { type: String, trim: true },
    remark: { type: String, trim: true },
  },
  { _id: false },
);

const bankTransferAmendmentEntrySchema = new Schema<BankTransferAmendmentEntry>(
  {
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    reason: { type: String, required: true, trim: true },
    old: { type: bankTransferAmendmentSnapshotSchema, required: true },
    new: { type: bankTransferAmendmentSnapshotSchema, required: true },
  },
  { _id: false },
);

const liabilityEntrySchema = new Schema<LiabilityEntryDocument>(
  {
    entryDate: { type: Date, required: true },
    entryType: {
      type: String,
      enum: ["receipt", "payment", "contra", "journal"],
      required: true,
      default: "journal",
    },
    amount: { type: Number, required: true, min: 0.01 },
    operatedCurrency: { type: String, trim: true },
    operatedAmount: { type: Number, min: 0 },
    exchangeRate: { type: Number, min: 0 },
    fromAccountType: { type: String, enum: ["bank", "person", "expense", "deposit", "withdrawal"], required: true },
    fromAccountId: { type: Schema.Types.ObjectId, required: true },
    toAccountType: { type: String, enum: ["bank", "person", "expense", "deposit", "withdrawal"], required: true },
    toAccountId: { type: Schema.Types.ObjectId, required: true },
    sourceType: { type: String, enum: ["expense", "deposit", "withdrawal"] },
    sourceExpenseId: { type: Schema.Types.ObjectId, ref: "Expense" },
    sourceDepositId: { type: Schema.Types.ObjectId, ref: "Deposit" },
    sourceWithdrawalId: { type: Schema.Types.ObjectId, ref: "Withdrawal" },
    referenceNo: { type: String, trim: true, default: "" },
    remark: { type: String, trim: true, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amendmentCount: { type: Number, default: 0, min: 0 },
    lastAmendedAt: { type: Date },
    lastAmendedBy: { type: Schema.Types.ObjectId, ref: "User" },
    amendmentHistory: { type: [bankTransferAmendmentEntrySchema], default: [] },
  },
  { timestamps: true },
);

liabilityEntrySchema.index({ entryDate: -1, createdAt: -1 });
liabilityEntrySchema.index({ fromAccountType: 1, fromAccountId: 1, entryDate: -1 });
liabilityEntrySchema.index({ toAccountType: 1, toAccountId: 1, entryDate: -1 });
liabilityEntrySchema.index({ entryType: 1, createdAt: -1 });

export const LiabilityEntryModel = model<LiabilityEntryDocument>("LiabilityEntry", liabilityEntrySchema);
