import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { apiRouter } from "./routes";
import { requestIdMiddleware } from "./shared/middlewares/requestId.middleware";
import { httpLoggerMiddleware } from "./shared/middlewares/httpLogger.middleware";
import { errorMiddleware, notFoundMiddleware } from "./shared/middlewares/error.middleware";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigin,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use(httpLoggerMiddleware);
  app.use(morgan("dev"));

  app.use("/api/v1", apiRouter);
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
