import { NextFunction, Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import { PERMISSIONS } from "../../shared/constants/permissions";

/**
 * Allows GET /withdrawal when the user has the permission matching `view` query.
 */
export function withdrawalListPermissionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const view = String(req.query.view ?? "exchange");
  const map: Record<string, string> = {
    exchange: PERMISSIONS.WITHDRAWAL_EXCHANGE_LIST,
    banker: PERMISSIONS.WITHDRAWAL_BANKER_LIST,
    final: PERMISSIONS.WITHDRAWAL_FINAL_VIEW,
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
