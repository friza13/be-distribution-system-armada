import { sanitizeLogData } from '../src/common/utils/log-sanitizer.util';

describe('Log Sanitizer Utility (Unit)', () => {
  it('should redact sensitive keys recursively in nested objects', () => {
    const rawData = {
      user: {
        id: '123',
        name: 'John Doe',
        password: 'SuperSecretPassword123!',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
      meta: {
        authorization: 'Bearer eyJhbGciOi...',
        refreshToken: 'refresh_token_family_abc',
        databaseUrl: 'postgresql://user:pass@localhost:5432/db',
      },
      nonSensitiveNumber: 42,
    };

    const sanitized = sanitizeLogData(rawData) as any;

    expect(sanitized.user.id).toBe('123');
    expect(sanitized.user.name).toBe('John Doe');
    expect(sanitized.user.password).toBe('[REDACTED]');
    expect(sanitized.user.token).toBe('[REDACTED]');
    expect(sanitized.meta.authorization).toBe('[REDACTED]');
    expect(sanitized.meta.refreshToken).toBe('[REDACTED]');
    expect(sanitized.meta.databaseUrl).toBe('[REDACTED]');
    expect(sanitized.nonSensitiveNumber).toBe(42);
  });

  it('should handle null, undefined, arrays, and primitive strings safely', () => {
    expect(sanitizeLogData(null)).toBeNull();
    expect(sanitizeLogData(undefined)).toBeUndefined();
    expect(sanitizeLogData('regular log string')).toBe('regular log string');
    
    const arrayData = [{ password: 'secret1' }, { publicInfo: 'safe' }];
    const sanitizedArray = sanitizeLogData(arrayData) as any[];
    expect(sanitizedArray[0].password).toBe('[REDACTED]');
    expect(sanitizedArray[1].publicInfo).toBe('safe');
  });
});
