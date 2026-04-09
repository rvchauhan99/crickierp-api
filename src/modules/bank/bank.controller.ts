import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { createBank, listBanks } from "./bank.service";

export async function createBankController(req: Request, res: Response) {
  const data = await createBank(req.body, req.user!.userId, req.requestId);
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function listBankController(_req: Request, res: Response) {
  const data = await listBanks();
  res.status(StatusCodes.OK).json({ success: true, data });
}
