import { NextFunction, Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import { PERMISSIONS } from "../../shared/constants/permissions";

/** List expenses if user has expense.list or expense.audit (audit queue uses same API with filters). */
export function expenseListPermissionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const permissions = req.user?.permissions ?? [];
  if (permissions.includes(PERMISSIONS.EXPENSE_LIST) || permissions.includes(PERMISSIONS.EXPENSE_AUDIT)) {
    next();
    return;
  }
  next(new AppError("auth_error", "Forbidden", 403));
}
