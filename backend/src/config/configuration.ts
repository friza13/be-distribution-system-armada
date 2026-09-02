export default () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'v1',
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  jwt: {
    algorithm: process.env.JWT_ALGORITHM || 'HS256',
    secretOrKey: process.env.JWT_SECRET_OR_KEY,
    issuer: process.env.JWT_ISSUER || 'dms-api',
    audience: process.env.JWT_AUDIENCE || 'dms-clients',
    accessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },
  cors: {
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '').split(','),
  },
});
