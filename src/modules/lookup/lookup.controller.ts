import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { lookupQuerySchema } from "./lookup.validation";
import {
  getPlayerBonusProfileLookup,
  listBankLookupOptions,
  listExchangeLookupOptions,
  listExpenseTypeLookupOptions,
  listPlayerLookupOptions,
} from "./lookup.service";

export async function listBankLookupController(req: Request, res: Response) {
  const query = lookupQuerySchema.parse(req.query);
  const data = await listBankLookupOptions(query);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function listExpenseTypeLookupController(req: Request, res: Response) {
  const query = lookupQuerySchema.parse(req.query);
  const data = await listExpenseTypeLookupOptions(query);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function listPlayerLookupController(req: Request, res: Response) {
  const query = lookupQuerySchema.parse(req.query);
  const data = await listPlayerLookupOptions(query);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function listExchangeLookupController(req: Request, res: Response) {
  const query = lookupQuerySchema.parse(req.query);
  const data = await listExchangeLookupOptions(query);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function getPlayerBonusProfileLookupController(req: Request, res: Response) {
  const playerId = String(req.params.id || "").trim();
  const data = await getPlayerBonusProfileLookup(playerId);
  res.status(StatusCodes.OK).json({ success: true, data });
}

