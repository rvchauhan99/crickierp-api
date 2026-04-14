import { z } from "zod";

const optionalTrimmed = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? undefined : String(v).trim()),
  z.string().optional(),
);

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "entryDate must be YYYY-MM-DD");

export const liabilityPersonIdParamSchema = z.object({
  id: z.string().length(24),
});

export const createLiabilityPersonBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: optionalTrimmed,
  email: optionalTrimmed,
  notes: optionalTrimmed,
  isActive: z.boolean().optional(),
  openingBalance: z.number().optional().default(0),
});

export const updateLiabilityPersonBodySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: optionalTrimmed,
  email: optionalTrimmed,
  notes: optionalTrimmed,
  isActive: z.boolean().optional(),
  openingBalance: z.number().optional(),
});

export const listLiabilityPersonQuerySchema = z.object({
  search: optionalTrimmed,
  isActive: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : String(v)),
    z.enum(["true", "false"]).optional(),
  ),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(20),
  limit: z.coerce.number().int().positive().max(500).optional(),
  sortBy: z.enum(["createdAt", "name", "openingBalance", "isActive"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createLiabilityEntryBodySchema = z.object({
  entryDate: ymd,
  entryType: z.enum(["receipt", "payment", "contra", "journal"]),
  amount: z.number().min(0.01),
  fromAccountType: z.enum(["bank", "person"]),
  fromAccountId: z.string().length(24),
  toAccountType: z.enum(["bank", "person"]),
  toAccountId: z.string().length(24),
  referenceNo: optionalTrimmed,
  remark: optionalTrimmed,
});

export const listLiabilityEntryQuerySchema = z.object({
  search: optionalTrimmed,
  entryType: z.enum(["receipt", "payment", "contra", "journal"]).optional(),
  accountType: z.enum(["bank", "person"]).optional(),
  accountId: z.string().length(24).optional(),
  entryDate_from: optionalTrimmed,
  entryDate_to: optionalTrimmed,
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(20),
  limit: z.coerce.number().int().positive().max(500).optional(),
  sortBy: z.enum(["createdAt", "entryDate", "amount", "entryType"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const liabilityLedgerQuerySchema = z.object({
  fromDate: optionalTrimmed,
  toDate: optionalTrimmed,
});
