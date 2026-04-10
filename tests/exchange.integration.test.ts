import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../src/app";
import { bootstrapData } from "../src/shared/db/bootstrap";

describe("Exchange API integration", () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let accessToken = "";

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await bootstrapData();

    const loginRes = await request(app).post("/api/v1/auth/login").send({
      username: "superadmin",
      password: "SuperAdmin@123",
    });
    accessToken = loginRes.body.data.accessToken;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it("creates exchange successfully", async () => {
    const res = await request(app)
      .post("/api/v1/exchange")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "E2E",
        provider: "Provider A",
        openingBalance: 300,
        bonus: 0,
        status: "active",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("E2E");
  });

  it("rejects duplicate exchange", async () => {
    const res = await request(app)
      .post("/api/v1/exchange")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "E2E",
        provider: "Provider A",
        openingBalance: 200,
        bonus: 0,
        status: "active",
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("business_rule_error");
  });

  it("lists exchanges with pagination", async () => {
    const res = await request(app)
      .get("/api/v1/exchange?page=1&pageSize=10&search=E2E")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.page).toBe(1);
  });

  it("returns unauthorized without token", async () => {
    const res = await request(app).get("/api/v1/exchange");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("auth_error");
  });

  it("returns validation error for bad payload", async () => {
    const res = await request(app)
      .post("/api/v1/exchange")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "",
        provider: "p",
        openingBalance: -1,
        bonus: -2,
        status: "active",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });
});
