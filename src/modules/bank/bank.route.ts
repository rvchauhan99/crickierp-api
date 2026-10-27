import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import { validate } from "../../shared/middlewares/validate.middleware";
import { requireSuperadminMiddleware } from "../../shared/middlewares/superadmin.middleware";
import {
  bankLedgerController,
  bankSummaryController,
  createBankController,
  createBankSettlementController,
  createBankTransferController,
  exportBankController,
  exportBankLedgerController,
  getBankComputedClosingController,
  listBankController,
  listBankSettlementsController,
  listBankTransferController,
} from "./bank.controller";
import {
  bankIdParamSchema,
  bankLedgerQuerySchema,
  bankSummaryQuerySchema,
  createBankBodySchema,
  createBankSettlementBodySchema,
  createBankTransferBodySchema,
  listBankQuerySchema,
  listBankTransferQuerySchema,
} from "./bank.validation";

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
  "/summary",
  permissionMiddleware(PERMISSIONS.BANK_STATEMENT),
  validate({ query: bankSummaryQuerySchema }),
  bankSummaryController,
);
/** Bank↔bank transfers — register before /:id routes */
bankRouter.post(
  "/transfers",
  permissionMiddleware(PERMISSIONS.BANK_TRANSFER),
  validate({ body: createBankTransferBodySchema }),
  createBankTransferController,
);
bankRouter.get(
  "/transfers",
  permissionMiddleware(PERMISSIONS.BANK_TRANSFER),
  validate({ query: listBankTransferQuerySchema }),
  listBankTransferController,
);
bankRouter.get(
  "/:id/settlements",
  permissionMiddleware(PERMISSIONS.BANK_STATEMENT),
  validate({ params: bankIdParamSchema }),
  listBankSettlementsController,
);
bankRouter.get(
  "/:id/computed-closing",
  permissionMiddleware(PERMISSIONS.BANK_STATEMENT),
  validate({ params: bankIdParamSchema }),
  getBankComputedClosingController,
);
bankRouter.post(
  "/:id/settlements",
  requireSuperadminMiddleware,
  validate({ params: bankIdParamSchema, body: createBankSettlementBodySchema }),
  createBankSettlementController,
);
bankRouter.get(
  "/:id/ledger/export",
  permissionMiddleware(PERMISSIONS.BANK_STATEMENT),
  validate({ params: bankIdParamSchema, query: bankLedgerQuerySchema }),
  exportBankLedgerController,
);
bankRouter.get(
  "/:id/ledger",
  permissionMiddleware(PERMISSIONS.BANK_STATEMENT),
  validate({ params: bankIdParamSchema, query: bankLedgerQuerySchema }),
  bankLedgerController,
);
bankRouter.get(
  "/",
  permissionMiddleware(PERMISSIONS.BANK_LIST),
  validate({ query: listBankQuerySchema }),
  listBankController,
);

export { bankRouter };
