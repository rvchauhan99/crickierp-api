import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { getDashboardSummary, getTransactionHistory } from "./reports.service";

export async function dashboardSummaryController(req: Request, res: Response) {
  const raw = req.query as Record<string, unknown>;
  const data = await getDashboardSummary({
    fromDate: typeof raw.fromDate === "string" ? raw.fromDate : undefined,
    toDate: typeof raw.toDate === "string" ? raw.toDate : undefined,
  });
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function transactionHistoryController(req: Request, res: Response) {
  const raw = req.query as Record<string, unknown>;
  const data = await getTransactionHistory({
    fromDate: typeof raw.fromDate === "string" ? raw.fromDate : undefined,
    toDate: typeof raw.toDate === "string" ? raw.toDate : undefined,
    search: typeof raw.search === "string" ? raw.search : undefined,
    page: Number(raw.page ?? 1),
    pageSize: Number(raw.pageSize ?? 20),
  });
  res.status(StatusCodes.OK).json({ success: true, data: data.rows, meta: data.meta });
}
