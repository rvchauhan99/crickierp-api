import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import { dashboardSummaryController, transactionHistoryController } from "./reports.controller";

const reportsRouter = Router();

reportsRouter.use(authMiddleware);
reportsRouter.get("/dashboard-summary", permissionMiddleware(PERMISSIONS.DASHBOARD_VIEW), dashboardSummaryController);
reportsRouter.get(
  "/transaction-history",
  permissionMiddleware(PERMISSIONS.REPORTS_TRANSACTION_HISTORY),
  transactionHistoryController,
);

export { reportsRouter };
