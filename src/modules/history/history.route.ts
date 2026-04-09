import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import { userHistoryController } from "./history.controller";

const historyRouter = Router();

historyRouter.use(authMiddleware);
historyRouter.get("/", permissionMiddleware(PERMISSIONS.USER_HISTORY_VIEW), userHistoryController);

export { historyRouter };
