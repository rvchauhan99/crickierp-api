import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  createExchange,
  getExchangeById,
  listExchanges,
  updateExchange,
} from "./exchange.service";

export async function createExchangeController(req: Request, res: Response) {
  const actorId = req.user!.userId;
  const data = await createExchange(req.body, actorId, req.requestId);
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function listExchangeController(req: Request, res: Response) {
  const raw = req.query as Record<string, unknown>;
  const query = {
    search: typeof raw.search === "string" ? raw.search : undefined,
    page: Number(raw.page ?? 1),
    pageSize: Number(raw.pageSize ?? 20),
    sortBy:
      raw.sortBy === "name" || raw.sortBy === "provider" || raw.sortBy === "createdAt"
        ? raw.sortBy
        : "createdAt",
    sortOrder: raw.sortOrder === "asc" ? "asc" : "desc",
  } as const;
  const data = await listExchanges(query);
  res.status(StatusCodes.OK).json({ success: true, data: data.rows, meta: data.meta });
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
