import { Schema, model, Types } from "mongoose";

export interface PlayerDocument {
  _id: Types.ObjectId;
  exchange: Types.ObjectId;
  playerId: string;
  phone: string;
  bonusPercentage: number;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const playerSchema = new Schema<PlayerDocument>(
  {
    exchange: { type: Schema.Types.ObjectId, required: true, ref: "Exchange" },
    playerId: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    bonusPercentage: { type: Number, required: true, min: 0, max: 100, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, required: true, ref: "User" },
  },
  { timestamps: true },
);

playerSchema.index({ exchange: 1, playerId: 1 }, { unique: true });

export const PlayerModel = model<PlayerDocument>("Player", playerSchema);
