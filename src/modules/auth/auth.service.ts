import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { AppError } from "../../shared/errors/AppError";
import { signAccessToken } from "../../shared/utils/jwt";
import { UserModel } from "../users/user.model";

export async function loginUser(username: string, password: string) {
  const user = await UserModel.findOne({ username, status: "active" });
  if (!user) {
    throw new AppError("auth_error", "Invalid credentials", 401);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new AppError("auth_error", "Invalid credentials", 401);
  }

  const payload = {
    userId: user._id.toString(),
    role: user.role,
    permissions: user.permissions,
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: "7d" });
  user.lastLoginAt = new Date();
  await user.save();

  return {
    user: {
      id: user._id.toString(),
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      permissions: user.permissions,
    },
    accessToken,
    refreshToken,
  };
}

export function refreshAccessToken(refreshToken: string) {
  try {
    const payload = jwt.verify(refreshToken, env.jwtRefreshSecret) as {
      userId: string;
      role: string;
      permissions: string[];
    };
    return { accessToken: signAccessToken(payload) };
  } catch {
    throw new AppError("auth_error", "Invalid refresh token", 401);
  }
}
