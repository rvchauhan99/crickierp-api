import { Schema, model, Types } from "mongoose";

export type ExchangeStatus = "active" | "deactive";

export interface ExchangeDocument {
  _id: Types.ObjectId;
  name: string;
  provider: string;
  /** When set, this exchange is a sub-exchange of the referenced top-level exchange. */
  parentExchange?: Types.ObjectId;
  openingBalance: number;
  openingOperatedCurrency?: string;
  openingOperatedAmount?: number;
  openingExchangeRate?: number;
  currentBalance: number;
  bonus: number;
  status: ExchangeStatus;
  version: number;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const exchangeSchema = new Schema<ExchangeDocument>(
  {
    name: { type: String, required: true, trim: true },
    provider: { type: String, required: true, trim: true },
    parentExchange: { type: Schema.Types.ObjectId, ref: "Exchange", index: true, default: null },
    openingBalance: { type: Number, required: true, min: 0 },
    openingOperatedCurrency: { type: String, trim: true },
    openingOperatedAmount: { type: Number, min: 0 },
    openingExchangeRate: { type: Number, min: 0 },
    /** Ledger can go negative when verified deposits exceed opening + credits; do not clamp at 0. */
    currentBalance: { type: Number, required: true, default: 0 },
    bonus: { type: Number, required: true, min: 0, default: 0 },
    status: { type: String, enum: ["active", "deactive"], default: "active" },
    version: { type: Number, default: 1 },
    createdBy: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, required: true, ref: "User" },
  },
  { timestamps: true },
);

/** Unique per parent scope (null parent = top-level). */
exchangeSchema.index({ parentExchange: 1, name: 1, provider: 1 }, { unique: true });

export const ExchangeModel = model<ExchangeDocument>("Exchange", exchangeSchema);
