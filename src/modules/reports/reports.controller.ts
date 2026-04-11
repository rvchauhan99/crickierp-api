import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  expenseAnalysisRecordsQuerySchema,
  expenseAnalysisSummaryQuerySchema,
  transactionHistoryQuerySchema,
} from "./reports.validation";
import {
  getDashboardSummary,
  getExpenseAnalysisRecords,
  getExpenseAnalysisSummary,
  getTransactionHistory,
  listAuditEntityValuesForTransactions,
} from "./reports.service";

export async function dashboardSummaryController(req: Request, res: Response) {
  const raw = req.query as Record<string, unknown>;
  const data = await getDashboardSummary({
    fromDate: typeof raw.fromDate === "string" ? raw.fromDate : undefined,
    toDate: typeof raw.toDate === "string" ? raw.toDate : undefined,
  });
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function transactionHistoryController(req: Request, res: Response) {
  const query = transactionHistoryQuerySchema.parse(req.query);
  const data = await getTransactionHistory(query, { scope: "transactions" });
  res.status(StatusCodes.OK).json({ success: true, data: data.rows, meta: data.meta });
}

export async function auditEntitiesController(_req: Request, res: Response) {
  const data = await listAuditEntityValuesForTransactions();
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function expenseAnalysisSummaryController(req: Request, res: Response) {
  const query = expenseAnalysisSummaryQuerySchema.parse(req.query);
  const summary = await getExpenseAnalysisSummary(query);
  res.status(StatusCodes.OK).json({ success: true, summary });
}

export async function expenseAnalysisRecordsController(req: Request, res: Response) {
  const query = expenseAnalysisRecordsQuerySchema.parse(req.query);
  const result = await getExpenseAnalysisRecords(query);
  res.status(StatusCodes.OK).json({
    success: true,
    data: result.rows,
    meta: result.meta,
  });
}
