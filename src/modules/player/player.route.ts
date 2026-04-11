import { Router } from "express";
import multer from "multer";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { permissionMiddleware } from "../../shared/middlewares/permission.middleware";
import { validate } from "../../shared/middlewares/validate.middleware";
import { PERMISSIONS } from "../../shared/constants/permissions";
import {
  createPlayerController,
  exportPlayerController,
  importPlayerController,
  listPlayerController,
  samplePlayerCsvController,
} from "./player.controller";
import { createPlayerBodySchema } from "./player.validation";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    if (!ok) {
      cb(new Error("Only .csv, .xlsx, .xls files are allowed"));
      return;
    }
    cb(null, true);
  },
});

const playerRouter = Router();

playerRouter.use(authMiddleware);

playerRouter.get(
  "/sample",
  permissionMiddleware(PERMISSIONS.PLAYER_ADD),
  samplePlayerCsvController,
);
playerRouter.post(
  "/import",
  permissionMiddleware(PERMISSIONS.PLAYER_ADD),
  (req, res, next) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        res.status(400).json({ success: false, message });
        return;
      }
      next();
    });
  },
  importPlayerController,
);
playerRouter.post(
  "/",
  permissionMiddleware(PERMISSIONS.PLAYER_ADD),
  validate({ body: createPlayerBodySchema }),
  createPlayerController,
);
playerRouter.get(
  "/export",
  permissionMiddleware(PERMISSIONS.PLAYER_LIST),
  exportPlayerController,
);
playerRouter.get("/", permissionMiddleware(PERMISSIONS.PLAYER_LIST), listPlayerController);

export { playerRouter };
