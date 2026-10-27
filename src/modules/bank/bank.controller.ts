import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  createBank,
  createBankSettlement,
  createBankTransfer,
  exportBankLedgerToBuffer,
  exportBanksToBuffer,
  getBankComputedClosingBalance,
  getBankLedger,
  getBankSummary,
  listBankSettlements,
  listBankTransfers,
  listBanks,
} from "./bank.service";
import {
  bankIdParamSchema,
  bankLedgerQuerySchema,
  bankSummaryQuerySchema,
  createBankSettlementBodySchema,
  createBankTransferBodySchema,
  listBankQuerySchema,
  listBankTransferQuerySchema,
} from "./bank.validation";
import { resolveRequestTimeZone } from "../../shared/utils/requestTimezone";
import { resolveBusinessYmdForActor } from "../../shared/utils/businessEntryDateTime";

export async function createBankController(req: Request, res: Response) {
  const data = await createBank(req.body, req.user!.userId, req.requestId);
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function listBankController(req: Request, res: Response) {
  const query = listBankQuerySchema.parse(req.query);
  const timeZone = resolveRequestTimeZone(req);
  const result = await listBanks(query, { timeZone });
  res.status(StatusCodes.OK).json({ success: true, data: result.rows, meta: result.meta });
}

export async function bankSummaryController(req: Request, res: Response) {
  const query = bankSummaryQuerySchema.parse(req.query);
  const timeZone = resolveRequestTimeZone(req);
  const data = await getBankSummary(query, { timeZone });
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function exportBankController(req: Request, res: Response) {
  const query = listBankQuerySchema.parse(req.query);
  const timeZone = resolveRequestTimeZone(req);
  const buffer = await exportBanksToBuffer(query, { timeZone });
  res.setHeader("Content-Disposition", 'attachment; filename="banks-export.xlsx"');
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.status(StatusCodes.OK).send(buffer);
}

export async function bankLedgerController(req: Request, res: Response) {
  const { id } = bankIdParamSchema.parse(req.params);
  const query = bankLedgerQuerySchema.parse(req.query);
  const timeZone = resolveRequestTimeZone(req);
  const data = await getBankLedger(id, query, { timeZone });
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function exportBankLedgerController(req: Request, res: Response) {
  const { id } = bankIdParamSchema.parse(req.params);
  const query = bankLedgerQuerySchema.parse(req.query);
  const timeZone = resolveRequestTimeZone(req);
  const buffer = await exportBankLedgerToBuffer(id, query, { timeZone });
  res.setHeader("Content-Disposition", `attachment; filename="bank-statement-${id}.xlsx"`);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.status(StatusCodes.OK).send(buffer);
}

export async function listBankSettlementsController(req: Request, res: Response) {
  const { id } = bankIdParamSchema.parse(req.params);
  const data = await listBankSettlements(id);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function getBankComputedClosingController(req: Request, res: Response) {
  const { id } = bankIdParamSchema.parse(req.params);
  const data = await getBankComputedClosingBalance(id);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function createBankSettlementController(req: Request, res: Response) {
  const { id } = bankIdParamSchema.parse(req.params);
  const body = createBankSettlementBodySchema.parse(req.body);
  const data = await createBankSettlement(
    id,
    {
      effectiveAt: body.effectiveAt,
      masterReportedBalance: body.masterReportedBalance,
      reason: body.reason,
    },
    req.user!.userId,
    req.requestId,
  );
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function createBankTransferController(req: Request, res: Response) {
  const parsed = createBankTransferBodySchema.parse(req.body);
  const data = await createBankTransfer(
    {
      ...parsed,
      entryDate: resolveBusinessYmdForActor(parsed.entryDate, req.user!.role),
    },
    req.user!.userId,
    req.requestId,
  );
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function listBankTransferController(req: Request, res: Response) {
  const query = listBankTransferQuerySchema.parse(req.query);
  const timeZone = resolveRequestTimeZone(req);
  const result = await listBankTransfers(query, { timeZone });
  res.status(StatusCodes.OK).json({ success: true, data: result.rows, meta: result.meta });
}
