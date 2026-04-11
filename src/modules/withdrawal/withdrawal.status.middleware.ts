import { NextFunction, Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import { PERMISSIONS } from "../../shared/constants/permissions";

/** finalize: final edit; reject: exchange or final edit */
export function withdrawalStatusPermissionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const status = req.body?.status as string | undefined;
  const permissions = req.user?.permissions ?? [];

  if (status === "finalized") {
    if (!permissions.includes(PERMISSIONS.WITHDRAWAL_FINAL_EDIT)) {
      return next(new AppError("auth_error", "Forbidden", 403));
    }
    return next();
  }

  if (status === "rejected") {
    if (
      !permissions.includes(PERMISSIONS.WITHDRAWAL_EXCHANGE_EDIT) &&
      !permissions.includes(PERMISSIONS.WITHDRAWAL_FINAL_EDIT) &&
      !permissions.includes(PERMISSIONS.WITHDRAWAL_BANKER)
    ) {
      return next(new AppError("auth_error", "Forbidden", 403));
    }
    return next();
  }

  return next(new AppError("validation_error", "Invalid status for this endpoint", 400));
}
