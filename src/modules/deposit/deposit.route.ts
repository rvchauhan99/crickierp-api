import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { anyPermissionMiddleware, permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import { validate } from "../../shared/middlewares/validate.middleware";
import {
  amendDepositController,
  createDepositController,
  exchangeActionController,
  exportDepositController,
  listDepositController,
  updateDepositController,
} from "./deposit.controller";
import { depositListPermissionMiddleware } from "./deposit.list.middleware";
import {
  amendDepositBodySchema,
  createDepositBodySchema,
  exchangeActionBodySchema,
  listDepositQuerySchema,
  updateDepositBodySchema,
} from "./deposit.validation";

const depositRouter = Router();

depositRouter.use(authMiddleware);

depositRouter.post(
  "/",
  permissionMiddleware(PERMISSIONS.DEPOSIT_BANKER),
  validate({ body: createDepositBodySchema }),
  createDepositController,
);

depositRouter.put(
  "/:id",
  permissionMiddleware(PERMISSIONS.DEPOSIT_BANKER),
  validate({ body: updateDepositBodySchema }),
  updateDepositController,
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

depositRouter.post(
  "/:id/amend",
  anyPermissionMiddleware([PERMISSIONS.DEPOSIT_FINAL_VIEW]),
  validate({ body: amendDepositBodySchema }),
  amendDepositController,
);

export { depositRouter };
