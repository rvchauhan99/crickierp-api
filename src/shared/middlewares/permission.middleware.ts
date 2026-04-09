import { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError";

export function permissionMiddleware(requiredPermission: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const permissions = req.user?.permissions ?? [];
    if (!permissions.includes(requiredPermission)) {
      return next(new AppError("auth_error", "Forbidden", 403));
    }
    next();
  };
}
