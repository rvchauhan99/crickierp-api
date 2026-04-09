import bcrypt from "bcrypt";
import { AppError } from "../../shared/errors/AppError";
import { UserModel, UserRole } from "./user.model";
import { DEFAULT_ADMIN_PERMISSIONS } from "../../shared/constants/permissions";
import { PermissionModel } from "../permissions/permission.model";

export async function createUser(
  creatorId: string,
  creatorRole: string,
  data: {
    fullName: string;
    email: string;
    username: string;
    passwordRaw: string;
    role: UserRole;
    permissions: string[];
  }
) {
  // Role checks
  if (creatorRole === "sub_admin") {
    throw new AppError("auth_error", "Sub admins cannot create users", 403);
  }

  if (creatorRole === "admin" && data.role !== "sub_admin") {
    throw new AppError("auth_error", "Admins can only create sub_admins", 403);
  }

  // superadmin can create admin or sub_admin
  if (creatorRole === "superadmin" && data.role === "superadmin") {
    throw new AppError("auth_error", "Cannot create additional superadmins via API", 403);
  }

  const existingUser = await UserModel.findOne({
    $or: [{ username: data.username }, { email: data.email.toLowerCase() }],
  });

  if (existingUser) {
    throw new AppError("bad_request", "Username or email already exists", 400);
  }

  const passwordHash = await bcrypt.hash(data.passwordRaw, 10);

  // Default permissions for admin
  let permissions = data.permissions;
  if (data.role === "admin") {
    permissions = DEFAULT_ADMIN_PERMISSIONS;
  }

  const user = await UserModel.create({
    fullName: data.fullName,
    email: data.email.toLowerCase(),
    username: data.username,
    passwordHash,
    role: data.role,
    status: "active",
    permissions,
    createdBy: creatorId,
  });

  return {
    id: user._id.toString(),
    username: user.username,
    role: user.role,
  };
}

export async function listUsers(creatorRole: string) {
  if (creatorRole === "sub_admin") {
    throw new AppError("auth_error", "Sub admins cannot list users", 403);
  }
  const rows = await UserModel.find({}, { passwordHash: 0, resetPasswordOtp: 0, resetPasswordExpires: 0 }).sort({
    createdAt: -1,
  });
  return rows;
}

export async function listPermissions() {
  const rows = await PermissionModel.find({}).sort({ module: 1, action: 1 });
  return rows;
}
