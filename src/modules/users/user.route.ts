import { Router } from "express";
import { createUserController, listPermissionsController, listUsersController } from "./user.controller";
import { validate } from "../../shared/middlewares/validate.middleware";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { createUserSchema } from "./user.validation";

const userRouter = Router();

userRouter.post("/", authMiddleware, validate({ body: createUserSchema }), createUserController);
userRouter.get("/", authMiddleware, listUsersController);
userRouter.get("/permissions", authMiddleware, listPermissionsController);

export { userRouter };
