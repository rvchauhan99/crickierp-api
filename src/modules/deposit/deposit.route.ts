import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import { validate } from "../../shared/middlewares/validate.middleware";
import {
  createDepositController,
  exchangeActionController,
  exportDepositController,
  listDepositController,
} from "./deposit.controller";
import { depositListPermissionMiddleware } from "./deposit.list.middleware";
import {
  createDepositBodySchema,
  exchangeActionBodySchema,
  listDepositQuerySchema,
} from "./deposit.validation";

const depositRouter = Router();

depositRouter.use(authMiddleware);

depositRouter.post(
  "/",
  permissionMiddleware(PERMISSIONS.DEPOSIT_BANKER),
  validate({ body: createDepositBodySchema }),
  createDepositController,
);

depositRouter.get(
  "/export",
  depositListPermissionMiddleware,
  validate({ query: listDepositQuerySchema }),
  exportDepositController,
);

depositRouter.get(
  "/",
  depositListPermissionMiddleware,
  validate({ query: listDepositQuerySchema }),
  listDepositController,
);

depositRouter.post(
  "/:id/exchange-action",
  permissionMiddleware(PERMISSIONS.DEPOSIT_EXCHANGE),
  validate({ body: exchangeActionBodySchema }),
  exchangeActionController,
);

export { depositRouter };
