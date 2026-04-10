import { Router } from "express";
import { 
  createUserController, 
  listPermissionsController, 
  listUsersController,
  exportUsersController,
  updateUserController,
  deleteUserController,
  resetUserPasswordController
} from "./user.controller";
import { validate } from "../../shared/middlewares/validate.middleware";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { createUserSchema, updateUserSchema, resetUserPasswordSchema } from "./user.validation";

const userRouter = Router();

userRouter.post("/", authMiddleware, validate({ body: createUserSchema }), createUserController);
userRouter.get("/", authMiddleware, listUsersController);
userRouter.get("/export", authMiddleware, exportUsersController);
userRouter.get("/permissions", authMiddleware, listPermissionsController);
userRouter.put("/:id", authMiddleware, validate({ body: updateUserSchema }), updateUserController);
userRouter.delete("/:id", authMiddleware, deleteUserController);
userRouter.post("/:id/reset-password", authMiddleware, validate({ body: resetUserPasswordSchema }), resetUserPasswordController);

export { userRouter };
