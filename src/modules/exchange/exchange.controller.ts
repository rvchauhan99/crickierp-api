import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  createExchange,
  exportExchangesToBuffer,
  getExchangeById,
  listExchanges,
  updateExchange,
} from "./exchange.service";
import { listExchangeQuerySchema } from "./exchange.validation";

export async function createExchangeController(req: Request, res: Response) {
  const actorId = req.user!.userId;
  const data = await createExchange(req.body, actorId, req.requestId);
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function listExchangeController(req: Request, res: Response) {
  const query = listExchangeQuerySchema.parse(req.query);
  const data = await listExchanges(query);
  res.status(StatusCodes.OK).json({ success: true, data: data.rows, meta: data.meta });
}

export async function exportExchangeController(req: Request, res: Response) {
  const query = listExchangeQuerySchema.parse(req.query);
  const buffer = await exportExchangesToBuffer(query);
  res.setHeader("Content-Disposition", 'attachment; filename="exchanges-export.xlsx"');
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.status(StatusCodes.OK).send(buffer);
}

export async function getExchangeController(req: Request, res: Response) {
  const data = await getExchangeById(String(req.params.id));
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function updateExchangeController(req: Request, res: Response) {
  const actorId = req.user!.userId;
  const data = await updateExchange(String(req.params.id), req.body, actorId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}
