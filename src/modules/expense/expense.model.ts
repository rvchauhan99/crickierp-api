import { Schema, model, Types } from "mongoose";

export type ExpenseStatus = "pending_audit" | "approved" | "rejected";

export interface ExpenseDocument {
  _id: Types.ObjectId;
  expenseTypeId: Types.ObjectId;
  amount: number;
  expenseDate: Date;
  description?: string;
  bankId?: Types.ObjectId;
  /** Denormalized for lists */
  bankName: string;
  status: ExpenseStatus;
  rejectReason?: string;
  /** Master Reason reference for rejection. */
  rejectReasonId?: Types.ObjectId;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  bankBalanceAfter?: number;
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const expenseSchema = new Schema<ExpenseDocument>(
  {
    expenseTypeId: { type: Schema.Types.ObjectId, ref: "ExpenseType", required: true },
    amount: { type: Number, required: true, min: 0.01 },
    expenseDate: { type: Date, required: true },
    description: { type: String, trim: true, default: "" },
    bankId: { type: Schema.Types.ObjectId, ref: "Bank" },
    bankName: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["pending_audit", "approved", "rejected"],
      default: "pending_audit",
    },
    rejectReason: { type: String, trim: true },
    rejectReasonId: { type: Schema.Types.ObjectId, ref: "Reason" },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    bankBalanceAfter: { type: Number, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

expenseSchema.index({ status: 1, createdAt: -1 });
expenseSchema.index({ expenseTypeId: 1 });
expenseSchema.index({ bankId: 1 });
expenseSchema.index({ expenseDate: 1 });

export const ExpenseModel = model<ExpenseDocument>("Expense", expenseSchema);
