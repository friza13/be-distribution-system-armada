const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'authorization',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'key',
  'privatekey',
  'cookie',
  'databaseurl',
  'postgres_password',
  'jwt_secret_or_key',
]);

export function sanitizeLogData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item));
  }

  if (typeof data === 'object') {
    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        sanitizedObj[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitizedObj[key] = sanitizeLogData(value);
      } else {
        sanitizedObj[key] = value;
      }
    }
    return sanitizedObj;
  }

  return data;
}
