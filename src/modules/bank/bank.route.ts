import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import { validate } from "../../shared/middlewares/validate.middleware";
import { createBankController, exportBankController, listBankController } from "./bank.controller";
import { createBankBodySchema, listBankQuerySchema } from "./bank.validation";

const bankRouter = Router();

bankRouter.use(authMiddleware);
bankRouter.post("/", permissionMiddleware(PERMISSIONS.BANK_ADD), validate({ body: createBankBodySchema }), createBankController);
bankRouter.get(
  "/export",
  permissionMiddleware(PERMISSIONS.BANK_LIST),
  validate({ query: listBankQuerySchema }),
  exportBankController,
);
bankRouter.get(
  "/",
  permissionMiddleware(PERMISSIONS.BANK_LIST),
  validate({ query: listBankQuerySchema }),
  listBankController,
);

export { bankRouter };
