import { NextFunction, Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import { PERMISSIONS } from "../../shared/constants/permissions";

/**
 * Allows GET /deposit when the user has the permission matching `view` query.
 */
export function depositListPermissionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const view = String(req.query.view ?? "banker");
  const map: Record<string, string> = {
    banker: PERMISSIONS.DEPOSIT_BANKER_LIST,
    exchange: PERMISSIONS.DEPOSIT_EXCHANGE,
    final: PERMISSIONS.DEPOSIT_FINAL_VIEW,
  };
  const required = map[view];
  if (!required) {
    return next(new AppError("validation_error", "Invalid view", 400));
  }
  const permissions = req.user?.permissions ?? [];
  if (!permissions.includes(required)) {
    return next(new AppError("auth_error", "Forbidden", 403));
  }
  next();
}
