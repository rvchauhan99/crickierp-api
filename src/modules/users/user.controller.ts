import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { createUser, listPermissions, listUsers } from "./user.service";

export async function createUserController(req: Request, res: Response) {
  // @ts-ignore
  const { userId, role } = req.user;
  const data = req.body;

  const result = await createUser(userId, role, {
    fullName: data.fullName,
    email: data.email,
    username: data.username,
    passwordRaw: data.password,
    role: data.role,
    permissions: data.permissions || [],
  });

  res.status(StatusCodes.CREATED).json({ success: true, data: result });
}

export async function listUsersController(req: Request, res: Response) {
  // @ts-ignore
  const { role } = req.user;
  const data = await listUsers(role);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function listPermissionsController(_req: Request, res: Response) {
  const data = await listPermissions();
  res.status(StatusCodes.OK).json({ success: true, data });
}
