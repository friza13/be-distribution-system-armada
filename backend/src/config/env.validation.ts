import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'staging')
    .default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('v1'),
  DATABASE_URL: Joi.string().required(),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  JWT_ALGORITHM: Joi.string().valid('HS256', 'RS256', 'EdDSA').default('HS256'),
  JWT_SECRET_OR_KEY: Joi.string().min(32).required(),
  JWT_ISSUER: Joi.string().default('dms-api'),
  JWT_AUDIENCE: Joi.string().default('dms-clients'),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000,http://localhost:5173'),
});
