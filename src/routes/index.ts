import { Router } from "express";
import { authRouter } from "../modules/auth/auth.route";
import { bankRouter } from "../modules/bank/bank.route";
import { depositRouter } from "../modules/deposit/deposit.route";
import { exchangeRouter } from "../modules/exchange/exchange.route";
import { historyRouter } from "../modules/history/history.route";
import { reportsRouter } from "../modules/reports/reports.route";
import { userRouter } from "../modules/users/user.route";
import { withdrawalRouter } from "../modules/withdrawal/withdrawal.route";

const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.status(200).json({ success: true, data: { status: "ok" } });
});
apiRouter.use("/auth", authRouter);
apiRouter.use("/exchange", exchangeRouter);
apiRouter.use("/bank", bankRouter);
apiRouter.use("/deposit", depositRouter);
apiRouter.use("/withdrawal", withdrawalRouter);
apiRouter.use("/users", userRouter);
apiRouter.use("/reports", reportsRouter);
apiRouter.use("/history", historyRouter);

export { apiRouter };
