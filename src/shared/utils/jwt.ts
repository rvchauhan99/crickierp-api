import jwt, { JwtPayload } from "jsonwebtoken";
import { env } from "../../config/env";

export type AuthTokenPayload = JwtPayload & {
  userId: string;
  role: string;
  permissions: string[];
};

export function signAccessToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: "1h" });
}

export function verifyAccessToken(token: string): AuthTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AuthTokenPayload;
}
