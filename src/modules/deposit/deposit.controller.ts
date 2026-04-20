import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  amendVerifiedDeposit,
  createDeposit,
  deleteDepositWithReversal,
  exchangeApproveDeposit,
  exchangeMarkNotSettled,
  exchangeRejectDeposit,
  exportDepositsToBuffer,
  listDeposits,
  updateDepositByBanker,
} from "./deposit.service";
import {
  amendDepositBodySchema,
  createDepositBodySchema,
  exchangeActionBodySchema,
  listDepositQuerySchema,
  updateDepositBodySchema,
} from "./deposit.validation";
import { resolveRequestTimeZone } from "../../shared/utils/requestTimezone";

export async function createDepositController(req: Request, res: Response) {
  const body = createDepositBodySchema.parse(req.body);
  const data = await createDeposit(body, req.user!.userId, req.requestId);
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function updateDepositController(req: Request, res: Response) {
  const body = updateDepositBodySchema.parse(req.body);
  const id = String(req.params.id);
  const data = await updateDepositByBanker(id, body, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function listDepositController(req: Request, res: Response) {
  const query = listDepositQuerySchema.parse(req.query);
  const timeZone = resolveRequestTimeZone(req);
  const result = await listDeposits(query, { actorId: req.user!.userId, timeZone });
  res.status(StatusCodes.OK).json({ success: true, data: result.rows, meta: result.meta });
}

export async function exportDepositController(req: Request, res: Response) {
  const query = listDepositQuerySchema.parse(req.query);
  const timeZone = resolveRequestTimeZone(req);
  const buffer = await exportDepositsToBuffer(query, { timeZone });
  res.setHeader("Content-Disposition", 'attachment; filename="deposits-export.xlsx"');
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.status(StatusCodes.OK).send(buffer);
}

export async function amendDepositController(req: Request, res: Response) {
  const body = amendDepositBodySchema.parse(req.body);
  const id = String(req.params.id);
  const data = await amendVerifiedDeposit(id, body, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function deleteDepositController(req: Request, res: Response) {
  const id = String(req.params.id);
  const data = await deleteDepositWithReversal(id, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
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

  if (body.action === "mark_not_settled") {
    const data = await exchangeMarkNotSettled(id, req.user!.userId, req.requestId);
    res.status(StatusCodes.OK).json({ success: true, data });
    return;
  }

  const data = await exchangeRejectDeposit(
    id,
    { reasonId: body.reasonId, remark: body.remark },
    req.user!.userId,
    req.requestId,
  );
  res.status(StatusCodes.OK).json({ success: true, data });
}
