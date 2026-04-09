import { z } from "zod";

export const createUserSchema = z.object({
  fullName: z.string().min(3),
  email: z.string().email(),
  username: z.string().min(3),
  password: z.string().min(6),
  role: z.enum(["admin", "sub_admin"]),
  permissions: z.array(z.string()).optional(),
});
