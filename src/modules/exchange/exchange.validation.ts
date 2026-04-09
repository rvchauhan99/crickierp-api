import { z } from "zod";

export const createExchangeBodySchema = z.object({
  name: z.string().min(2).max(120),
  provider: z.string().min(2).max(120),
  openingBalance: z.number().min(0),
  bonus: z.number().min(0).default(0),
  status: z.enum(["active", "deactive"]).default("active"),
});

export const updateExchangeBodySchema = z.object({
  name: z.string().min(2).max(120).optional(),
  provider: z.string().min(2).max(120).optional(),
  openingBalance: z.number().min(0).optional(),
  bonus: z.number().min(0).optional(),
  status: z.enum(["active", "deactive"]).optional(),
  version: z.number().int().positive(),
});

export const listExchangeQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(["createdAt", "name", "provider"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const exchangeIdParamSchema = z.object({
  id: z.string().min(24).max(24),
});
