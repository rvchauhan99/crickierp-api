import { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError";

export function notFoundMiddleware(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: {
      code: "not_found",
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      requestId: req.requestId,
    },
  });
}

export function errorMiddleware(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId: req.requestId,
      },
    });
  }

  return res.status(500).json({
    success: false,
    error: {
      code: "system_error",
      message: "Something went wrong",
      requestId: req.requestId,
    },
  });
}
