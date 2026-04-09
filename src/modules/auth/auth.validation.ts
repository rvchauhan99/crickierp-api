import { z } from "zod";

export const loginBodySchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(10),
});
