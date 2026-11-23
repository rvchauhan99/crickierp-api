import { Router } from "express";
import multer from "multer";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { requireSuperadminMiddleware } from "../../shared/middlewares/superadmin.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import { validate } from "../../shared/middlewares/validate.middleware";
import {
  amendWithdrawalController,
  bulkBankerApproveController,
  createBankerUtrUploadJobController,
  createBulkBankerApproveJobController,
  createWithdrawalController,
  createWithdrawalImportJobController,
  deleteWithdrawalController,
  downloadBankerUtrUploadJobErrorCsvController,
  downloadWithdrawalImportJobErrorCsvController,
  getBankerUtrUploadJobController,
  getBulkBankerApproveJobController,
  getWithdrawalImportJobController,
  listSavedAccountsController,
  listWithdrawalController,
  lookupBeneficiaryAccountsController,
  sampleBankerUtrUploadController,
  sampleWithdrawalCsvController,
  streamBankerUtrUploadJobEventsController,
  streamWithdrawalApprovalQueueEventsController,
  streamBulkBankerApproveJobEventsController,
  streamWithdrawalImportJobEventsController,
  updateWithdrawalExchangeController,
  updateWithdrawalBankerController,
  updateWithdrawalStatusController,
  exportWithdrawalController,
  validateBankerUtrUploadController,
  validateWithdrawalImportController,
  validateWithdrawalPlayerAccountController,
} from "./withdrawal.controller";
import { withdrawalListPermissionMiddleware } from "./withdrawal.list.middleware";
import { withdrawalStatusPermissionMiddleware } from "./withdrawal.status.middleware";
import {
  approvalQueueEventsQuerySchema,
  amendWithdrawalBodySchema,
  bulkBankerApproveBodySchema,
  createBankerUtrUploadJobBodySchema,
  createBulkBankerApproveJobBodySchema,
  createWithdrawalBodySchema,
  createWithdrawalImportJobBodySchema,
  exportWithdrawalQuerySchema,
  listWithdrawalQuerySchema,
  updateWithdrawalBodySchema,
  updateWithdrawalStatusBodySchema,
  lookupBeneficiaryAccountsQuerySchema,
  validateWithdrawalPlayerAccountBodySchema,
  withdrawalBankerPayoutBodySchema,
} from "./withdrawal.validation";

const withdrawalRouter = Router();

withdrawalRouter.use(authMiddleware);

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

withdrawalRouter.get(
  "/import/sample",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_EXCHANGE),
  sampleWithdrawalCsvController,
);

withdrawalRouter.post(
  "/import/validate",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_EXCHANGE),
  upload.single("file"),
  validateWithdrawalImportController,
);

withdrawalRouter.post(
  "/import/jobs",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_EXCHANGE),
  validate({ body: createWithdrawalImportJobBodySchema }),
  createWithdrawalImportJobController,
);

withdrawalRouter.get(
  "/import/jobs/:jobId",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_EXCHANGE),
  getWithdrawalImportJobController,
);

withdrawalRouter.get(
  "/import/jobs/:jobId/events",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_EXCHANGE),
  streamWithdrawalImportJobEventsController,
);

withdrawalRouter.get(
  "/import/jobs/:jobId/errors.csv",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_EXCHANGE),
  downloadWithdrawalImportJobErrorCsvController,
);

withdrawalRouter.post(
  "/bulk-banker-approve",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_BANKER),
  validate({ body: bulkBankerApproveBodySchema }),
  bulkBankerApproveController,
);

withdrawalRouter.post(
  "/bulk-banker-approve/jobs",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_BANKER),
  validate({ body: createBulkBankerApproveJobBodySchema }),
  createBulkBankerApproveJobController,
);

withdrawalRouter.get(
  "/bulk-banker-approve/jobs/:jobId",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_BANKER),
  getBulkBankerApproveJobController,
);

withdrawalRouter.get(
  "/bulk-banker-approve/jobs/:jobId/events",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_BANKER),
  streamBulkBankerApproveJobEventsController,
);

withdrawalRouter.get(
  "/banker-utr-upload/sample",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_BANKER),
  sampleBankerUtrUploadController,
);

withdrawalRouter.post(
  "/banker-utr-upload/validate",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_BANKER),
  upload.single("file"),
  validateBankerUtrUploadController,
);

withdrawalRouter.post(
  "/banker-utr-upload/jobs",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_BANKER),
  validate({ body: createBankerUtrUploadJobBodySchema }),
  createBankerUtrUploadJobController,
);

withdrawalRouter.get(
  "/banker-utr-upload/jobs/:jobId",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_BANKER),
  getBankerUtrUploadJobController,
);

withdrawalRouter.get(
  "/banker-utr-upload/jobs/:jobId/events",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_BANKER),
  streamBankerUtrUploadJobEventsController,
);

withdrawalRouter.get(
  "/banker-utr-upload/jobs/:jobId/errors.csv",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_BANKER),
  downloadBankerUtrUploadJobErrorCsvController,
);

withdrawalRouter.post(
  "/",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_EXCHANGE),
  validate({ body: createWithdrawalBodySchema }),
  createWithdrawalController,
);

withdrawalRouter.post(
  "/validate-player-account",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_EXCHANGE),
  validate({ body: validateWithdrawalPlayerAccountBodySchema }),
  validateWithdrawalPlayerAccountController,
);

withdrawalRouter.get(
  "/beneficiary-accounts/lookup",
  permissionMiddleware(PERMISSIONS.WITHDRAWAL_EXCHANGE),
  validate({ query: lookupBeneficiaryAccountsQuerySchema }),
  lookupBeneficiaryAccountsController,
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
  "/approval-queue/events",
  withdrawalListPermissionMiddleware,
  validate({ query: approvalQueueEventsQuerySchema }),
  streamWithdrawalApprovalQueueEventsController,
);

withdrawalRouter.get(
  "/export",
  withdrawalListPermissionMiddleware,
  validate({ query: exportWithdrawalQuerySchema }),
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
