import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  amendWithdrawal,
  createWithdrawal,
  deleteWithdrawalWithReversal,
  listSavedAccountsForPlayer,
  listWithdrawals,
  updateWithdrawalByExchange,
  updateWithdrawalByBanker,
  updateWithdrawalStatus,
  exportWithdrawalsToBuffer,
} from "./withdrawal.service";
import {
  approvalQueueEventsQuerySchema,
  amendWithdrawalBodySchema,
  createWithdrawalBodySchema,
  listWithdrawalQuerySchema,
  updateWithdrawalBodySchema,
  updateWithdrawalStatusBodySchema,
  withdrawalBankerPayoutBodySchema,
} from "./withdrawal.validation";
import { resolveRequestTimeZone } from "../../shared/utils/requestTimezone";
import { subscribeApprovalQueueEvents } from "../approval/approval-queue-events";

export async function createWithdrawalController(req: Request, res: Response) {
  const body = createWithdrawalBodySchema.parse(req.body);
  const data = await createWithdrawal(body, req.user!.userId, req.requestId);
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function listWithdrawalController(req: Request, res: Response) {
  const query = listWithdrawalQuerySchema.parse(req.query);
  const timeZone = resolveRequestTimeZone(req);
  const result = await listWithdrawals(query, { actorId: req.user!.userId, timeZone });
  res.status(StatusCodes.OK).json({ success: true, data: result.rows, meta: result.meta });
}

export async function updateWithdrawalExchangeController(req: Request, res: Response) {
  const body = updateWithdrawalBodySchema.parse(req.body);
  const id = String(req.params.id);
  const data = await updateWithdrawalByExchange(id, body, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function updateWithdrawalBankerController(req: Request, res: Response) {
  const body = withdrawalBankerPayoutBodySchema.parse(req.body);
  const id = String(req.params.id);
  const data = await updateWithdrawalByBanker(id, body, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function amendWithdrawalController(req: Request, res: Response) {
  const body = amendWithdrawalBodySchema.parse(req.body);
  const id = String(req.params.id);
  const data = await amendWithdrawal(id, body, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function deleteWithdrawalController(req: Request, res: Response) {
  const id = String(req.params.id);
  const data = await deleteWithdrawalWithReversal(id, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function exportWithdrawalController(req: Request, res: Response) {
  const query = listWithdrawalQuerySchema.parse(req.query);
  const timeZone = resolveRequestTimeZone(req);
  const buffer = await exportWithdrawalsToBuffer(query, { timeZone });
  res.setHeader("Content-Disposition", 'attachment; filename="withdrawals-export.xlsx"');
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.status(StatusCodes.OK).send(buffer);
}

export async function updateWithdrawalStatusController(req: Request, res: Response) {
  const body = updateWithdrawalStatusBodySchema.parse(req.body);
  const id = String(req.params.id);
  const data = await updateWithdrawalStatus(id, body, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function listSavedAccountsController(req: Request, res: Response) {
  const playerId = String(req.params.playerId);
  const data = await listSavedAccountsForPlayer(playerId);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function streamWithdrawalApprovalQueueEventsController(req: Request, res: Response) {
  const query = approvalQueueEventsQuerySchema.parse(req.query);
  subscribeApprovalQueueEvents("withdrawal", query.view, res);
}
