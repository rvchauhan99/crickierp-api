import bcrypt from "bcrypt";
import { PermissionModel } from "../../modules/permissions/permission.model";
import { UserModel } from "../../modules/users/user.model";
import { DEFAULT_ADMIN_PERMISSIONS, PERMISSIONS } from "../constants/permissions";

export async function bootstrapData() {
  await PermissionModel.updateOne(
    { key: PERMISSIONS.EXCHANGE_ADD },
    { module: "exchange", action: "add", key: PERMISSIONS.EXCHANGE_ADD, description: "Create exchange" },
    { upsert: true },
  );
  await PermissionModel.updateOne(
    { key: PERMISSIONS.EXCHANGE_LIST },
    { module: "exchange", action: "list", key: PERMISSIONS.EXCHANGE_LIST, description: "List exchanges" },
    { upsert: true },
  );
  await PermissionModel.updateOne(
    { key: PERMISSIONS.EXCHANGE_EDIT },
    { module: "exchange", action: "edit", key: PERMISSIONS.EXCHANGE_EDIT, description: "Edit exchange" },
    { upsert: true },
  );

  const admin = await UserModel.findOne({ username: "admin" });
  if (!admin) {
    const passwordHash = await bcrypt.hash("Admin@123", 10);
    await UserModel.create({
      fullName: "System Admin",
      email: "admin@crickierp.local",
      username: "admin",
      passwordHash,
      role: "admin",
      status: "active",
      permissions: DEFAULT_ADMIN_PERMISSIONS,
    });
  }
}
