import { NextFunction, Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import { PERMISSIONS } from "../../shared/constants/permissions";

const KEYS = [
  PERMISSIONS.EXPENSE_ADD,
  PERMISSIONS.EXPENSE_EDIT,
  PERMISSIONS.EXPENSE_LIST,
  PERMISSIONS.EXPENSE_AUDIT,
] as const;

export function expenseTypesReadMiddleware(req: Request, _res: Response, next: NextFunction) {
  const permissions = req.user?.permissions ?? [];
  if (KEYS.some((k) => permissions.includes(k))) {
    next();
    return;
  }
  next(new AppError("auth_error", "Forbidden", 403));
}
