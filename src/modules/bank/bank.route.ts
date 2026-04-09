import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import { validate } from "../../shared/middlewares/validate.middleware";
import { createBankController, listBankController } from "./bank.controller";
import { createBankBodySchema } from "./bank.validation";

const bankRouter = Router();

bankRouter.use(authMiddleware);
bankRouter.post("/", permissionMiddleware(PERMISSIONS.BANK_ADD), validate({ body: createBankBodySchema }), createBankController);
bankRouter.get("/", permissionMiddleware(PERMISSIONS.BANK_LIST), listBankController);

export { bankRouter };
