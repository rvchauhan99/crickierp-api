import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AuditLogModel } from "../audit/audit.model";

export async function userHistoryController(req: Request, res: Response) {
  const raw = req.query as Record<string, unknown>;
  const page = Number(raw.page ?? 1);
  const pageSize = Number(raw.pageSize ?? 20);
  const skip = (page - 1) * pageSize;
  const search = typeof raw.search === "string" ? raw.search : "";
  const filter = search
    ? {
        $or: [
          { action: { $regex: search, $options: "i" } },
          { entity: { $regex: search, $options: "i" } },
          { requestId: { $regex: search, $options: "i" } },
        ],
      }
    : {};
  const [rows, total] = await Promise.all([
    AuditLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize),
    AuditLogModel.countDocuments(filter),
  ]);
  res.status(StatusCodes.OK).json({ success: true, data: rows, meta: { page, pageSize, total } });
}
