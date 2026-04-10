import bcrypt from "bcrypt";
import { PermissionModel } from "../../modules/permissions/permission.model";
import { UserModel } from "../../modules/users/user.model";
import { PERMISSIONS } from "../constants/permissions";

export async function bootstrapData() {
  const entries = Object.values(PERMISSIONS).map((key) => {
    const [module, action] = key.split(".");
    return {
      module,
      action,
      key,
      description: `${module} ${action}`.replace(/_/g, " "),
    };
  });
  for (const item of entries) {
    await PermissionModel.updateOne({ key: item.key }, item, { upsert: true });
  }

  const superadmin = await UserModel.findOne({ role: "superadmin" });
  if (!superadmin) {
    const passwordHash = await bcrypt.hash("SuperAdmin@123", 10);
    await UserModel.create({
      fullName: "Super Admin",
      email: "superadmin@crickierp.local",
      username: "superadmin",
      passwordHash,
      role: "superadmin",
      status: "active",
      permissions: Object.values(PERMISSIONS), // Grant all known permissions to superadmin
    });
  } else {
    superadmin.permissions = Object.values(PERMISSIONS);
    await superadmin.save();
  }
}
