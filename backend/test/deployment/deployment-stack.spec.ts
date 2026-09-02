import * as fs from 'fs';
import * as path from 'path';

describe('Production Deployment Stack & Environment Validation (Unit Tests)', () => {
  const rootDir = path.resolve(process.cwd());

  it('should verify production Dockerfile contains multi-stage build, USER node, and HEALTHCHECK', () => {
    const dockerfilePath = path.join(rootDir, 'Dockerfile');
    expect(fs.existsSync(dockerfilePath)).toBe(true);

    const content = fs.readFileSync(dockerfilePath, 'utf8');
    expect(content).toContain('FROM node:22-alpine AS builder');
    expect(content).toContain('FROM node:22-alpine AS runner');
    expect(content).toContain('USER node');
    expect(content).toContain('HEALTHCHECK');
    expect(content).toContain('/v1/health/liveness');
  });

  it('should verify docker-compose.prod.yml maps persistent volumes for storage and backups', () => {
    const composePath = path.join(rootDir, 'docker-compose.prod.yml');
    expect(fs.existsSync(composePath)).toBe(true);

    const content = fs.readFileSync(composePath, 'utf8');
    expect(content).toContain('storage_data_prod:/app/storage');
    expect(content).toContain('backup_data_prod:/app/backups');
    expect(content).toContain('restart: unless-stopped');
    expect(content).toContain('JWT_SECRET_OR_KEY');
  });

  it('should verify nginx.conf explicitly denies direct public access to /storage and includes security headers', () => {
    const nginxPath = path.join(rootDir, 'nginx', 'nginx.conf');
    expect(fs.existsSync(nginxPath)).toBe(true);

    const content = fs.readFileSync(nginxPath, 'utf8');
    expect(content).toContain('location /storage');
    expect(content).toContain('deny all');
    expect(content).toContain('location /v1/realtime/');
    expect(content).toContain('proxy_set_header Upgrade $http_upgrade');
    expect(content).toContain('X-Frame-Options "DENY"');
  });
});
