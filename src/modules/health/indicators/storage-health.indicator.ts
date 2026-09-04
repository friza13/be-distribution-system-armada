import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class StorageHealthIndicator extends HealthIndicator {
  private readonly storageDir: string;

  constructor() {
    super();
    this.storageDir = path.resolve(process.cwd(), 'storage', 'private', 'pod');
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }

      // Check writable access by writing a temporary probe file
      const probeFile = path.join(this.storageDir, '.health-probe');
      await fs.promises.writeFile(probeFile, 'health-ok');
      await fs.promises.unlink(probeFile);

      return this.getStatus(key, true, { path: this.storageDir });
    } catch (err: unknown) {
      const result = this.getStatus(key, false, {
        path: this.storageDir,
        message: err instanceof Error ? err.message : String(err),
      });
      throw new HealthCheckError('Storage health check failed', result);
    }
  }
}
