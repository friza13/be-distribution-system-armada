import 'reflect-metadata';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://dms_user:dms_secret_password_123!@localhost:5432/distribution_db';
process.env.JWT_SECRET_OR_KEY =
  process.env.JWT_SECRET_OR_KEY ||
  'test_secret_with_minimum_32_characters_length_here';
