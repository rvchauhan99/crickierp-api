type EnvConfig = {
  nodeEnv: string;
  port: number;
  mongoUri: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  corsOrigin: string;
  cookieSecure: boolean;
  cookieDomain?: string;

  // Optional External Services
  brevoUser?: string;
  brevoMasterKey?: string;
  brevoFrom: string;

  bucketEndpoint?: string;
  bucketName?: string;
  bucketAccessKeyId?: string;
  bucketSecretAccessKey?: string;
  bucketRegion: string;
  bucketPublicUrlBase?: string;
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
  cookieSecure: (process.env.COOKIE_SECURE ?? "false") === "true",
  cookieDomain: process.env.COOKIE_DOMAIN,
  
  // Email config (Optional)
  brevoUser: process.env.BREVO_USER,
  brevoMasterKey: process.env.BREVO_MASTER_KEY,
  brevoFrom: process.env.BREVO_FROM ?? "noreply@crickierp.local",

  // Bucket config (Optional)
  bucketEndpoint: process.env.BUCKET_ENDPOINT,
  bucketName: process.env.BUCKET_NAME,
  bucketAccessKeyId: process.env.BUCKET_ACCESS_KEY_ID,
  bucketSecretAccessKey: process.env.BUCKET_SECRET_ACCESS_KEY,
  bucketRegion: process.env.BUCKET_REGION ?? "auto",
  bucketPublicUrlBase: process.env.BUCKET_PUBLIC_URL_BASE,
};
