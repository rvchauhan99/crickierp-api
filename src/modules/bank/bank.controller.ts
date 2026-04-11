import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { createBank, exportBanksToBuffer, listBanks } from "./bank.service";
import { listBankQuerySchema } from "./bank.validation";

export async function createBankController(req: Request, res: Response) {
  const data = await createBank(req.body, req.user!.userId, req.requestId);
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function listBankController(req: Request, res: Response) {
  const query = listBankQuerySchema.parse(req.query);
  const result = await listBanks(query);
  res.status(StatusCodes.OK).json({ success: true, data: result.rows, meta: result.meta });
}

export async function exportBankController(req: Request, res: Response) {
  const query = listBankQuerySchema.parse(req.query);
  const buffer = await exportBanksToBuffer(query);
  res.setHeader("Content-Disposition", 'attachment; filename="banks-export.xlsx"');
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.status(StatusCodes.OK).send(buffer);
}
