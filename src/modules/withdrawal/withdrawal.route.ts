import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { requireSuperadminMiddleware } from "../../shared/middlewares/superadmin.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import { validate } from "../../shared/middlewares/validate.middleware";
import {
  amendWithdrawalController,
  createWithdrawalController,
  deleteWithdrawalController,
  listSavedAccountsController,
  listWithdrawalController,
  updateWithdrawalExchangeController,
  updateWithdrawalBankerController,
  updateWithdrawalStatusController,
  exportWithdrawalController,
} from "./withdrawal.controller";
import { withdrawalListPermissionMiddleware } from "./withdrawal.list.middleware";
import { withdrawalStatusPermissionMiddleware } from "./withdrawal.status.middleware";
import {
  amendWithdrawalBodySchema,
  createWithdrawalBodySchema,
  listWithdrawalQuerySchema,
  updateWithdrawalBodySchema,
  updateWithdrawalStatusBodySchema,
  withdrawalBankerPayoutBodySchema,
} from "./withdrawal.validation";

const withdrawalRouter = Router();

withdrawalRouter.use(authMiddleware);

withdrawalRouter.post(
  "/",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_EXCHANGE),
  validate({ body: createWithdrawalBodySchema }),
  createWithdrawalController,
);

withdrawalRouter.get(
  "/player/:playerId/saved-accounts",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_EXCHANGE),
  listSavedAccountsController,
);

withdrawalRouter.patch(
  "/:id",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_EXCHANGE),
  validate({ body: updateWithdrawalBodySchema }),
  updateWithdrawalExchangeController,
);

withdrawalRouter.patch(
  "/:id/banker-payout",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_BANKER),
  validate({ body: withdrawalBankerPayoutBodySchema }),
  updateWithdrawalBankerController,
);

withdrawalRouter.post(
  "/:id/amend",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_FINAL_VIEW),
  validate({ body: amendWithdrawalBodySchema }),
  amendWithdrawalController,
);

withdrawalRouter.patch(
  "/:id/status",
  withdrawalStatusPermissionMiddleware,
  validate({ body: updateWithdrawalStatusBodySchema }),
  updateWithdrawalStatusController,
);

withdrawalRouter.get(
  "/export",
  withdrawalListPermissionMiddleware,
  validate({ query: listWithdrawalQuerySchema }),
  exportWithdrawalController,
);

withdrawalRouter.get(
  "/",
  withdrawalListPermissionMiddleware,
  validate({ query: listWithdrawalQuerySchema }),
  listWithdrawalController,
);

withdrawalRouter.delete("/:id", requireSuperadminMiddleware, deleteWithdrawalController);

export { withdrawalRouter };
