import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import { validate } from "../../shared/middlewares/validate.middleware";
import { expenseListPermissionMiddleware } from "./expense.list.middleware";
import { expenseTypesReadMiddleware } from "./expenseTypes.middleware";
import {
  approveExpenseController,
  createExpenseController,
  getExpenseController,
  listExpenseController,
  listExpenseTypesController,
  rejectExpenseController,
  updateExpenseController,
} from "./expense.controller";
import {
  approveExpenseBodySchema,
  createExpenseBodySchema,
  listExpenseQuerySchema,
  rejectExpenseBodySchema,
  updateExpenseBodySchema,
} from "./expense.validation";

const expenseRouter = Router();

expenseRouter.use(authMiddleware);

expenseRouter.post(
  "/",
  permissionMiddleware(PERMISSIONS.EXPENSE_ADD),
  validate({ body: createExpenseBodySchema }),
  createExpenseController,
);

expenseRouter.patch(
  "/:id",
  permissionMiddleware(PERMISSIONS.EXPENSE_LIST),
  validate({ body: updateExpenseBodySchema }),
  updateExpenseController,
);

expenseRouter.get(
  "/",
  expenseListPermissionMiddleware,
  validate({ query: listExpenseQuerySchema }),
  listExpenseController,
);

expenseRouter.get("/expense-types", expenseTypesReadMiddleware, listExpenseTypesController);

expenseRouter.get("/:id", expenseListPermissionMiddleware, getExpenseController);

expenseRouter.post(
  "/:id/approve",
  permissionMiddleware(PERMISSIONS.EXPENSE_AUDIT),
  validate({ body: approveExpenseBodySchema }),
  approveExpenseController,
);

expenseRouter.post(
  "/:id/reject",
  permissionMiddleware(PERMISSIONS.EXPENSE_AUDIT),
  validate({ body: rejectExpenseBodySchema }),
  rejectExpenseController,
);

export { expenseRouter };
