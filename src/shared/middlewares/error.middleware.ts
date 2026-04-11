import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/AppError";
import { formatZodErrorMessage } from "../utils/zodErrorMessage";

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

  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: "validation_error",
        message: formatZodErrorMessage(error),
        details: error.flatten(),
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
