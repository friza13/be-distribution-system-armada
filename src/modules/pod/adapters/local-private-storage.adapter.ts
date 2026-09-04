import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { FileStorageAdapter, SavedFileResult } from '../interfaces/file-storage.interface';

@Injectable()
export class LocalPrivateStorageAdapter implements FileStorageAdapter {
  private readonly logger = new Logger(LocalPrivateStorageAdapter.name);
  private readonly baseStorageDir: string;

  constructor() {
    this.baseStorageDir = path.resolve(process.cwd(), 'storage', 'private', 'pod');
    if (!fs.existsSync(this.baseStorageDir)) {
      fs.mkdirSync(this.baseStorageDir, { recursive: true });
    }
  }

  async saveFile(buffer: Buffer, originalFilename: string, mimeType: string): Promise<SavedFileResult> {
    const ext = this.getExtensionFromMime(mimeType) || path.extname(originalFilename) || '.bin';
    const now = new Date();
    const year = now.getUTCFullYear().toString();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');

    const targetDir = path.join(this.baseStorageDir, year, month);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const fileUuid = uuidv4();
    const filename = `${fileUuid}${ext}`;
    const fullPath = path.join(targetDir, filename);
    const objectKey = `pod/${year}/${month}/${filename}`;

    await fs.promises.writeFile(fullPath, buffer);

    const checksumSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    return {
      objectKey,
      sizeBytes: buffer.length,
      checksumSha256,
    };
  }

  async getFileBuffer(objectKey: string): Promise<Buffer> {
    const fullPath = path.join(this.baseStorageDir, '..', objectKey);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: `File with key ${objectKey} not found in storage`,
      });
    }
    return fs.promises.readFile(fullPath);
  }

  async deleteFile(objectKey: string): Promise<boolean> {
    const fullPath = path.join(this.baseStorageDir, '..', objectKey);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
      return true;
    }
    return false;
  }

  private getExtensionFromMime(mime: string): string {
    switch (mime.toLowerCase()) {
      case 'image/jpeg':
      case 'image/jpg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      default:
        return '';
    }
  }
}
