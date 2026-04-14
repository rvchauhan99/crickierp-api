import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { validate } from "../../shared/middlewares/validate.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import {
  createLiabilityEntryController,
  createLiabilityPersonController,
  liabilityPersonLedgerController,
  liabilityPersonWiseReportController,
  liabilitySummaryReportController,
  listLiabilityEntryController,
  listLiabilityPersonController,
  updateLiabilityPersonController,
} from "./liability.controller";
import {
  createLiabilityEntryBodySchema,
  createLiabilityPersonBodySchema,
  liabilityLedgerQuerySchema,
  liabilityPersonIdParamSchema,
  listLiabilityEntryQuerySchema,
  listLiabilityPersonQuerySchema,
  updateLiabilityPersonBodySchema,
} from "./liability.validation";

const liabilityRouter = Router();

liabilityRouter.use(authMiddleware);

liabilityRouter.post(
  "/persons",
  permissionMiddleware(PERMISSIONS.LIABILITY_PERSON_ADD),
  validate({ body: createLiabilityPersonBodySchema }),
  createLiabilityPersonController,
);

liabilityRouter.patch(
  "/persons/:id",
  permissionMiddleware(PERMISSIONS.LIABILITY_PERSON_ADD),
  validate({ params: liabilityPersonIdParamSchema, body: updateLiabilityPersonBodySchema }),
  updateLiabilityPersonController,
);

liabilityRouter.get(
  "/persons",
  permissionMiddleware(PERMISSIONS.LIABILITY_PERSON_LIST),
  validate({ query: listLiabilityPersonQuerySchema }),
  listLiabilityPersonController,
);

liabilityRouter.post(
  "/entries",
  permissionMiddleware(PERMISSIONS.LIABILITY_ENTRY_ADD),
  validate({ body: createLiabilityEntryBodySchema }),
  createLiabilityEntryController,
);

liabilityRouter.get(
  "/entries",
  permissionMiddleware(PERMISSIONS.LIABILITY_ENTRY_LIST),
  validate({ query: listLiabilityEntryQuerySchema }),
  listLiabilityEntryController,
);

liabilityRouter.get(
  "/persons/:id/ledger",
  permissionMiddleware(PERMISSIONS.LIABILITY_LEDGER_VIEW),
  validate({ params: liabilityPersonIdParamSchema, query: liabilityLedgerQuerySchema }),
  liabilityPersonLedgerController,
);

liabilityRouter.get(
  "/reports/summary",
  permissionMiddleware(PERMISSIONS.LIABILITY_REPORT_VIEW),
  liabilitySummaryReportController,
);

liabilityRouter.get(
  "/reports/person-wise",
  permissionMiddleware(PERMISSIONS.LIABILITY_REPORT_VIEW),
  liabilityPersonWiseReportController,
);

export { liabilityRouter };
