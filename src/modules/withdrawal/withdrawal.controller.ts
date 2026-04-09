import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { createWithdrawal, listWithdrawals, updateWithdrawalStatus } from "./withdrawal.service";

export async function createWithdrawalController(req: Request, res: Response) {
  const data = await createWithdrawal(req.body, req.user!.userId, req.requestId);
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function listWithdrawalController(req: Request, res: Response) {
  const stage = String(req.query.stage ?? "exchange") as "exchange" | "banker" | "final";
  const data = await listWithdrawals(stage);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function updateWithdrawalStatusController(req: Request, res: Response) {
  const data = await updateWithdrawalStatus(String(req.params.id), req.body.status, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}
