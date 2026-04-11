import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { createWithdrawal, listWithdrawals, updateWithdrawalStatus } from "./withdrawal.service";

export async function createWithdrawalController(req: Request, res: Response) {
  const data = await createWithdrawal(req.body, req.user!.userId, req.requestId);
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function listWithdrawalController(req: Request, res: Response) {
  const stage = String(req.query.stage ?? "exchange") as "exchange" | "banker" | "final";
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  const result = await listWithdrawals(stage, { page, limit });
  res.status(StatusCodes.OK).json({ success: true, ...result });
}

export async function updateWithdrawalStatusController(req: Request, res: Response) {
  const data = await updateWithdrawalStatus(String(req.params.id), req.body.status, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}
