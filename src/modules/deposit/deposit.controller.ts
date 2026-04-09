import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { createDeposit, listDeposits, updateDepositStatus } from "./deposit.service";

export async function createDepositController(req: Request, res: Response) {
  const data = await createDeposit(req.body, req.user!.userId, req.requestId);
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function listDepositController(req: Request, res: Response) {
  const stage = String(req.query.stage ?? "banker") as "banker" | "exchange" | "final";
  const data = await listDeposits(stage);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function updateDepositStatusController(req: Request, res: Response) {
  const data = await updateDepositStatus(String(req.params.id), req.body.status, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}
