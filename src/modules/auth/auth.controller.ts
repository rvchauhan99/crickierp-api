import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { loginUser, refreshAccessToken } from "./auth.service";

export async function loginController(req: Request, res: Response) {
  const { username, password } = req.body as { username: string; password: string };
  const data = await loginUser(username, password);
  res.status(StatusCodes.OK).json({ success: true, data });
}

export async function refreshController(req: Request, res: Response) {
  const { refreshToken } = req.body as { refreshToken: string };
  const data = refreshAccessToken(refreshToken);
  res.status(StatusCodes.OK).json({ success: true, data });
}
