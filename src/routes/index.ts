import { Router } from "express";
import { authRouter } from "../modules/auth/auth.route";
import { exchangeRouter } from "../modules/exchange/exchange.route";

const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.status(200).json({ success: true, data: { status: "ok" } });
});
apiRouter.use("/auth", authRouter);
apiRouter.use("/exchange", exchangeRouter);

export { apiRouter };
