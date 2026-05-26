import { Router } from "express";
import multer from "multer";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { anyPermissionMiddleware, permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { requireSuperadminMiddleware } from "../../shared/middlewares/superadmin.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import { validate } from "../../shared/middlewares/validate.middleware";
import {
  amendDepositController,
  commitDepositImportController,
  createDepositController,
  deleteDepositController,
  exchangeActionController,
  exportDepositController,
  listDepositController,
  sampleDepositCsvController,
  streamDepositApprovalQueueEventsController,
  updateDepositController,
  validateDepositImportController,
} from "./deposit.controller";
import { depositListPermissionMiddleware } from "./deposit.list.middleware";
import {
  approvalQueueEventsQuerySchema,
  amendDepositBodySchema,
  commitDepositImportBodySchema,
  createDepositBodySchema,
  exchangeActionBodySchema,
  listDepositQuerySchema,
  updateDepositBodySchema,
} from "./deposit.validation";

const depositRouter = Router();

depositRouter.use(authMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    if (!ok) {
      cb(new Error("Only .csv, .xlsx, .xls files are allowed"));
      return;
    }
    cb(null, true);
  },
});

depositRouter.get(
  "/import/sample",
  permissionMiddleware(PERMISSIONS.DEPOSIT_BANKER),
  sampleDepositCsvController,
);

depositRouter.post(
  "/import/validate",
  permissionMiddleware(PERMISSIONS.DEPOSIT_BANKER),
  upload.single("file"),
  validateDepositImportController,
);

depositRouter.post(
  "/import/commit",
  permissionMiddleware(PERMISSIONS.DEPOSIT_BANKER),
  validate({ body: commitDepositImportBodySchema }),
  commitDepositImportController,
);

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
  "/approval-queue/events",
  depositListPermissionMiddleware,
  validate({ query: approvalQueueEventsQuerySchema }),
  streamDepositApprovalQueueEventsController,
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

depositRouter.delete("/:id", requireSuperadminMiddleware, deleteDepositController);

export { depositRouter };
