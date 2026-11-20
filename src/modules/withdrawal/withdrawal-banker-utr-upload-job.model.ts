import { Schema, model, type Types } from "mongoose";

export type WithdrawalBankerUtrUploadJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface WithdrawalBankerUtrUploadJobInputRow {
  withdrawalId: string;
  utr: string;
  payoutBankId: string;
}

export interface WithdrawalBankerUtrUploadJobErrorItem {
  withdrawalId: string;
  error: string;
}

export interface WithdrawalBankerUtrUploadJobProgress {
  totalRows: number;
  processedRows: number;
  successRows: number;
  failedRows: number;
  skippedRows: number;
}

export interface WithdrawalBankerUtrUploadJobDocument {
  _id: Types.ObjectId;
  status: WithdrawalBankerUtrUploadJobStatus;
  createdBy: Types.ObjectId;
  rows: WithdrawalBankerUtrUploadJobInputRow[];
  startedAt?: Date;
  finishedAt?: Date;
  failureReason?: string;
  progress: WithdrawalBankerUtrUploadJobProgress;
  errorSample: WithdrawalBankerUtrUploadJobErrorItem[];
  errorRows: WithdrawalBankerUtrUploadJobErrorItem[];
  lock?: {
    lockedBy: string;
    lockedAt: Date;
    heartbeatAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const rowSchema = new Schema<WithdrawalBankerUtrUploadJobInputRow>(
  {
    withdrawalId: { type: String, required: true, trim: true },
    utr: { type: String, required: true, trim: true },
    payoutBankId: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const progressSchema = new Schema<WithdrawalBankerUtrUploadJobProgress>(
  {
    totalRows: { type: Number, default: 0, min: 0 },
    processedRows: { type: Number, default: 0, min: 0 },
    successRows: { type: Number, default: 0, min: 0 },
    failedRows: { type: Number, default: 0, min: 0 },
    skippedRows: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const errorItemSchema = new Schema<WithdrawalBankerUtrUploadJobErrorItem>(
  {
    withdrawalId: { type: String, required: true, trim: true },
    error: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const lockSchema = new Schema(
  {
    lockedBy: { type: String, required: true },
    lockedAt: { type: Date, required: true },
    heartbeatAt: { type: Date, required: true },
  },
  { _id: false },
);

const withdrawalBankerUtrUploadJobSchema = new Schema<WithdrawalBankerUtrUploadJobDocument>(
  {
    status: {
      type: String,
      enum: ["queued", "processing", "completed", "failed", "cancelled"],
      required: true,
      default: "queued",
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, required: true, ref: "User", index: true },
    rows: { type: [rowSchema], required: true, default: [] },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    failureReason: { type: String },
    progress: { type: progressSchema, default: () => ({}) },
    errorSample: { type: [errorItemSchema], default: [] },
    errorRows: { type: [errorItemSchema], default: [] },
    lock: { type: lockSchema, required: false },
  },
  { timestamps: true },
);

withdrawalBankerUtrUploadJobSchema.index({ status: 1, createdAt: 1 });
withdrawalBankerUtrUploadJobSchema.index({ "lock.heartbeatAt": 1 });

export const WithdrawalBankerUtrUploadJobModel = model<WithdrawalBankerUtrUploadJobDocument>(
  "WithdrawalBankerUtrUploadJob",
  withdrawalBankerUtrUploadJobSchema,
);
