import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import { validate } from "../../shared/middlewares/validate.middleware";
import { createWithdrawalController, listWithdrawalController, updateWithdrawalStatusController } from "./withdrawal.controller";
import { createWithdrawalBodySchema, updateWithdrawalStatusBodySchema } from "./withdrawal.validation";

const withdrawalRouter = Router();

withdrawalRouter.use(authMiddleware);
withdrawalRouter.post("/", permissionMiddleware(PERMISSIONS.WITHDRAWAL_EXCHANGE), validate({ body: createWithdrawalBodySchema }), createWithdrawalController);
withdrawalRouter.get("/", permissionMiddleware(PERMISSIONS.WITHDRAWAL_EXCHANGE_LIST), listWithdrawalController);
withdrawalRouter.patch("/:id/status", permissionMiddleware(PERMISSIONS.WITHDRAWAL_FINAL_EDIT), validate({ body: updateWithdrawalStatusBodySchema }), updateWithdrawalStatusController);

export { withdrawalRouter };
