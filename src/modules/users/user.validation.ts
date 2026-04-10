import { z } from "zod";

export const createUserSchema = z.object({
  fullName: z.string().min(3),
  email: z.string().email(),
  username: z.string().min(3),
  password: z.string().min(6),
  role: z.enum(["admin", "sub_admin"]),
  permissions: z.array(z.string()).optional(),
});

export const updateUserSchema = z.object({
  fullName: z.string().min(3).optional(),
  email: z.string().email().optional(),
  username: z.string().min(3).optional(),
  role: z.enum(["admin", "sub_admin"]).optional(),
  status: z.string().optional(),
  permissions: z.array(z.string()).optional(),
});

export const resetUserPasswordSchema = z.object({
  new_password: z.string().min(6),
});
