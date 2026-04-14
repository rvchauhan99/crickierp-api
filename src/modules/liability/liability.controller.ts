import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  createLiabilityEntryBodySchema,
  createLiabilityPersonBodySchema,
  liabilityLedgerQuerySchema,
  liabilityPersonIdParamSchema,
  listLiabilityEntryQuerySchema,
  listLiabilityPersonQuerySchema,
  updateLiabilityPersonBodySchema,
} from "./liability.validation";
import {
  createLiabilityEntry,
  createLiabilityPerson,
  getLiabilityPersonLedger,
  getLiabilityReportPersonWise,
  getLiabilityReportSummary,
  listLiabilityEntries,
  listLiabilityPersons,
  updateLiabilityPerson,
} from "./liability.service";

export async function createLiabilityPersonController(req: Request, res: Response) {
  const body = createLiabilityPersonBodySchema.parse(req.body);
  const data = await createLiabilityPerson(body, req.user!.userId, req.requestId);
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function updateLiabilityPersonController(req: Request, res: Response) {
  const body = updateLiabilityPersonBodySchema.parse(req.body);
  const { id } = liabilityPersonIdParamSchema.parse(req.params);
  const data = await updateLiabilityPerson(id, body, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function listLiabilityPersonController(req: Request, res: Response) {
  const query = listLiabilityPersonQuerySchema.parse(req.query);
  const result = await listLiabilityPersons(query);
  res.status(StatusCodes.OK).json({ success: true, data: result.rows, meta: result.meta });
}

export async function createLiabilityEntryController(req: Request, res: Response) {
  const body = createLiabilityEntryBodySchema.parse(req.body);
  const data = await createLiabilityEntry(body, req.user!.userId, req.requestId);
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function listLiabilityEntryController(req: Request, res: Response) {
  const query = listLiabilityEntryQuerySchema.parse(req.query);
  const result = await listLiabilityEntries(query);
  res.status(StatusCodes.OK).json({ success: true, data: result.rows, meta: result.meta });
}

export async function liabilityPersonLedgerController(req: Request, res: Response) {
  const { id } = liabilityPersonIdParamSchema.parse(req.params);
  const query = liabilityLedgerQuerySchema.parse(req.query);
  const data = await getLiabilityPersonLedger(id, query);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function liabilitySummaryReportController(_req: Request, res: Response) {
  const data = await getLiabilityReportSummary();
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function liabilityPersonWiseReportController(_req: Request, res: Response) {
  const data = await getLiabilityReportPersonWise();
  res.status(StatusCodes.OK).json({ success: true, data });
}
