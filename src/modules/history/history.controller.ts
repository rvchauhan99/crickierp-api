import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  getTransactionHistory,
  listAuditEntityValuesForLogin,
} from "../reports/reports.service";
import { transactionHistoryQuerySchema } from "../reports/reports.validation";

export async function userHistoryController(req: Request, res: Response) {
  const query = transactionHistoryQuerySchema.parse(req.query);
  const data = await getTransactionHistory(query, { scope: "login" });
  res.status(StatusCodes.OK).json({ success: true, data: data.rows, meta: data.meta });
}

export async function loginAuditEntitiesController(_req: Request, res: Response) {
  res.status(StatusCodes.OK).json({ success: true, data: listAuditEntityValuesForLogin() });
}
