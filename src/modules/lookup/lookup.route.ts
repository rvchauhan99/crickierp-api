import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import {
  getPlayerBonusProfileLookupController,
  listBankLookupController,
  listExchangeLookupController,
  listExpenseTypeLookupController,
  listPlayerLookupController,
} from "./lookup.controller";
import { lookupPermissionMiddleware } from "./lookupPermission.middleware";

const lookupRouter = Router();

lookupRouter.use(authMiddleware);

lookupRouter.get("/banks", lookupPermissionMiddleware("banks"), listBankLookupController);
lookupRouter.get(
  "/expense-types",
  lookupPermissionMiddleware("expenseTypes"),
  listExpenseTypeLookupController,
);
lookupRouter.get("/players", lookupPermissionMiddleware("players"), listPlayerLookupController);
lookupRouter.get(
  "/players/:id/bonus-profile",
  lookupPermissionMiddleware("players"),
  getPlayerBonusProfileLookupController,
);
lookupRouter.get("/exchanges", lookupPermissionMiddleware("exchanges"), listExchangeLookupController);

export { lookupRouter };

