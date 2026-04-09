type EnvConfig = {
  nodeEnv: string;
  port: number;
  mongoUri: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  corsOrigin: string;
};

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env: EnvConfig = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  mongoUri: required("MONGO_URI", "mongodb://127.0.0.1:27017/crickierp"),
  jwtAccessSecret: required("JWT_ACCESS_SECRET", "change_me_access_secret"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET", "change_me_refresh_secret"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
};
