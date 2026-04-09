import { Router } from "express";
import { loginController, refreshController } from "./auth.controller";
import { validate } from "../../shared/middlewares/validate.middleware";
import { loginBodySchema, refreshBodySchema } from "./auth.validation";

const authRouter = Router();

authRouter.post("/login", validate({ body: loginBodySchema }), loginController);
authRouter.post("/refresh", validate({ body: refreshBodySchema }), refreshController);

export { authRouter };
