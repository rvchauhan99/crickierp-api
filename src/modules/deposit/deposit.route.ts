import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import { validate } from "../../shared/middlewares/validate.middleware";
import { createDepositController, listDepositController, updateDepositStatusController } from "./deposit.controller";
import { createDepositBodySchema, updateDepositStatusBodySchema } from "./deposit.validation";

const depositRouter = Router();

depositRouter.use(authMiddleware);
depositRouter.post("/", permissionMiddleware(PERMISSIONS.DEPOSIT_BANKER), validate({ body: createDepositBodySchema }), createDepositController);
depositRouter.get("/", permissionMiddleware(PERMISSIONS.DEPOSIT_BANKER_LIST), listDepositController);
depositRouter.patch("/:id/status", permissionMiddleware(PERMISSIONS.DEPOSIT_FINAL_EDIT), validate({ body: updateDepositStatusBodySchema }), updateDepositStatusController);

export { depositRouter };
