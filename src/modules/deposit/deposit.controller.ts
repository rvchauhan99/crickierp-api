import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  amendVerifiedDeposit,
  buildDepositImportErrorCsv,
  buildDepositImportSampleCsv,
  commitDepositImportRows,
  createDeposit,
  deleteDepositWithReversal,
  exchangeApproveDeposit,
  exchangeMarkNotSettled,
  exchangeRejectDeposit,
  exportDepositsToBuffer,
  listDeposits,
  updateDepositByBanker,
  validateDepositImportRows,
} from "./deposit.service";
import {
  createDepositImportJob,
  getDepositImportJobErrorCsv,
  getDepositImportJobStatus,
} from "./deposit-import-job.service";
import {
  approvalQueueEventsQuerySchema,
  amendDepositBodySchema,
  commitDepositImportBodySchema,
  createDepositImportJobBodySchema,
  createDepositBodySchema,
  exchangeActionBodySchema,
  listDepositQuerySchema,
  updateDepositBodySchema,
} from "./deposit.validation";
import { resolveRequestTimeZone } from "../../shared/utils/requestTimezone";
import { subscribeApprovalQueueEvents } from "../approval/approval-queue-events";
import { subscribeDepositImportEvents } from "./deposit-import-events";

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

export async function streamDepositApprovalQueueEventsController(req: Request, res: Response) {
  const query = approvalQueueEventsQuerySchema.parse(req.query);
  subscribeApprovalQueueEvents("deposit", query.view, res);
}

export async function sampleDepositCsvController(_req: Request, res: Response) {
  const buffer = buildDepositImportSampleCsv();
  res.setHeader("Content-Disposition", 'attachment; filename="deposit-import-sample.csv"');
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.status(StatusCodes.OK).send(buffer);
}

export async function validateDepositImportController(req: Request, res: Response) {
  const file = req.file;
  if (!file?.buffer) {
    res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "File is required (field name: file)" });
    return;
  }
  const result = await validateDepositImportRows(file.buffer, file.originalname);
  res.status(StatusCodes.OK).json({ success: true, data: result });
}

export async function commitDepositImportController(req: Request, res: Response) {
  const body = commitDepositImportBodySchema.parse(req.body);
  const result = await commitDepositImportRows(body.rows, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data: result });
}

export async function createDepositImportJobController(req: Request, res: Response) {
  const body = createDepositImportJobBodySchema.parse(req.body);
  const result = await createDepositImportJob({
    rows: body.rows,
    actorId: req.user!.userId,
    requestId: req.requestId,
  });
  res.status(StatusCodes.ACCEPTED).json({ success: true, data: result });
}

export async function getDepositImportJobController(req: Request, res: Response) {
  const jobId = String(req.params.jobId);
  const result = await getDepositImportJobStatus(jobId, req.user!.userId);
  res.status(StatusCodes.OK).json({ success: true, data: result });
}

export async function streamDepositImportJobEventsController(req: Request, res: Response) {
  const jobId = String(req.params.jobId);
  await getDepositImportJobStatus(jobId, req.user!.userId);
  subscribeDepositImportEvents(jobId, res);
}

export async function downloadDepositImportJobErrorCsvController(req: Request, res: Response) {
  const jobId = String(req.params.jobId);
  const { fileName, buffer } = await getDepositImportJobErrorCsv(jobId, req.user!.userId);
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.status(StatusCodes.OK).send(buffer);
}

export async function downloadDepositImportErrorCsvController(req: Request, res: Response) {
  const { invalidRows } = req.body;
  if (!Array.isArray(invalidRows) || invalidRows.length === 0) {
    res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "No invalid rows provided" });
    return;
  }
  const buffer = buildDepositImportErrorCsv(invalidRows);
  res.setHeader("Content-Disposition", 'attachment; filename="deposit-import-errors.csv"');
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.status(StatusCodes.OK).send(buffer);
}
