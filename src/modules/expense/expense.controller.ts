import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  approveExpense,
  createExpense,
  getExpenseById,
  listActiveExpenseTypes,
  listExpenses,
  rejectExpense,
  updateExpense,
} from "./expense.service";
import {
  approveExpenseBodySchema,
  createExpenseBodySchema,
  listExpenseQuerySchema,
  rejectExpenseBodySchema,
  updateExpenseBodySchema,
} from "./expense.validation";

export async function createExpenseController(req: Request, res: Response) {
  const body = createExpenseBodySchema.parse(req.body);
  const data = await createExpense(body, req.user!.userId, req.requestId);
  res.status(StatusCodes.CREATED).json({ success: true, data });
}

export async function updateExpenseController(req: Request, res: Response) {
  const body = updateExpenseBodySchema.parse(req.body);
  const id = String(req.params.id);
  const data = await updateExpense(id, body, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function listExpenseTypesController(_req: Request, res: Response) {
  const data = await listActiveExpenseTypes();
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function listExpenseController(req: Request, res: Response) {
  const query = listExpenseQuerySchema.parse(req.query);
  const result = await listExpenses(query);
  res.status(StatusCodes.OK).json({ success: true, data: result.rows, meta: result.meta });
}

export async function getExpenseController(req: Request, res: Response) {
  const data = await getExpenseById(String(req.params.id));
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function approveExpenseController(req: Request, res: Response) {
  const body = approveExpenseBodySchema.parse(req.body);
  const data = await approveExpense(String(req.params.id), body, req.user!.userId, req.requestId);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function rejectExpenseController(req: Request, res: Response) {
  const body = rejectExpenseBodySchema.parse(req.body);
  const data = await rejectExpense(
    String(req.params.id),
    { reasonId: body.reasonId, remark: body.remark },
    req.user!.userId,
    req.requestId,
  );
  res.status(StatusCodes.OK).json({ success: true, data });
}
