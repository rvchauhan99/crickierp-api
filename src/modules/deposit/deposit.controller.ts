import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  createDeposit,
  exchangeApproveDeposit,
  exchangeRejectDeposit,
  exportDepositsToBuffer,
  listDeposits,
} from "./deposit.service";
import {
  createDepositBodySchema,
  exchangeActionBodySchema,
  listDepositQuerySchema,
} from "./deposit.validation";

export async function createDepositController(req: Request, res: Response) {
  const body = createDepositBodySchema.parse(req.body);
  const data = await createDeposit(body, req.user!.userId, req.requestId);
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function listDepositController(req: Request, res: Response) {
  const query = listDepositQuerySchema.parse(req.query);
  const result = await listDeposits(query);
  res.status(StatusCodes.OK).json({ success: true, data: result.rows, meta: result.meta });
}

export async function exportDepositController(req: Request, res: Response) {
  const query = listDepositQuerySchema.parse(req.query);
  const buffer = await exportDepositsToBuffer(query);
  res.setHeader("Content-Disposition", 'attachment; filename="deposits-export.xlsx"');
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.status(StatusCodes.OK).send(buffer);
}

export async function exchangeActionController(req: Request, res: Response) {
  const body = exchangeActionBodySchema.parse(req.body);
  const id = String(req.params.id);

  if (body.action === "approve") {
    const data = await exchangeApproveDeposit(
      id,
      { playerId: body.playerId, bonusAmount: body.bonusAmount },
      req.user!.userId,
      req.requestId,
    );
    res.status(StatusCodes.OK).json({ success: true, data });
    return;
  }

  const data = await exchangeRejectDeposit(id, body.remark, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}
