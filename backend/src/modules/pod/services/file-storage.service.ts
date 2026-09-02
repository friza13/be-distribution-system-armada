import {
  Injectable,
  BadRequestException,
  UnprocessableEntityException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LocalPrivateStorageAdapter } from '../adapters/local-private-storage.adapter';

@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly localStorageAdapter: LocalPrivateStorageAdapter,
  ) {}

  validateMagicBytesAndType(buffer: Buffer, mimeType: string): void {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_FILE_BUFFER',
        message: 'File buffer cannot be empty',
      });
    }

    const mime = mimeType.toLowerCase();

    // Check JPEG: FF D8 FF
    if (mime === 'image/jpeg' || mime === 'image/jpg') {
      if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        throw new UnprocessableEntityException({
          code: 'INVALID_FILE_MAGIC_BYTES',
          message: 'File magic bytes do not match declared JPEG format',
        });
      }
      return;
    }

    // Check PNG: 89 50 4E 47
    if (mime === 'image/png') {
      if (
        buffer.length < 4 ||
        buffer[0] !== 0x89 ||
        buffer[1] !== 0x50 ||
        buffer[2] !== 0x4e ||
        buffer[3] !== 0x47
      ) {
        throw new UnprocessableEntityException({
          code: 'INVALID_FILE_MAGIC_BYTES',
          message: 'File magic bytes do not match declared PNG format',
        });
      }
      return;
    }

    // Check WebP: 52 49 46 46 (RIFF)
    if (mime === 'image/webp') {
      if (
        buffer.length < 4 ||
        buffer[0] !== 0x52 ||
        buffer[1] !== 0x49 ||
        buffer[2] !== 0x46 ||
        buffer[3] !== 0x46
      ) {
        throw new UnprocessableEntityException({
          code: 'INVALID_FILE_MAGIC_BYTES',
          message: 'File magic bytes do not match declared WebP format',
        });
      }
      return;
    }

    throw new UnprocessableEntityException({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: `Media type ${mimeType} is not supported for POD uploads. Allowed: image/jpeg, image/png, image/webp`,
    });
  }

  async saveFileRecord(
    fileBuffer: Buffer,
    originalName: string,
    mimeType: string,
    uploaderUserId: string,
    fileCategory: 'photo' | 'signature' = 'photo',
  ) {
    // 1. Validate magic bytes
    this.validateMagicBytesAndType(fileBuffer, mimeType);

    // 2. Validate Size Cap
    const maxSize = fileCategory === 'signature' ? 500 * 1024 : 5 * 1024 * 1024;
    if (fileBuffer.length > maxSize) {
      throw new UnprocessableEntityException({
        code: 'FILE_SIZE_EXCEEDED',
        message: `File size ${fileBuffer.length} bytes exceeds allowed cap of ${maxSize} bytes`,
      });
    }

    // 3. Save file via Storage Adapter
    const saved = await this.localStorageAdapter.saveFile(fileBuffer, originalName, mimeType);

    // 4. Save FileRecord to DB
    const fileRecord = await this.prisma.fileRecord.create({
      data: {
        objectKey: saved.objectKey,
        mediaType: mimeType,
        sizeBytes: saved.sizeBytes,
        checksumSha256: saved.checksumSha256,
        uploadedBy: uploaderUserId,
      },
    });

    return fileRecord;
  }

  async getAuthorizedFileBuffer(fileId: string, actorUserId: string, actorRole: string) {
    const fileRecord = await this.prisma.fileRecord.findUnique({
      where: { id: fileId },
      include: {
        photoPods: { include: { deliveryStop: { include: { delivery: true } } } },
        signaturePods: { include: { deliveryStop: { include: { delivery: true } } } },
      },
    });

    if (!fileRecord) {
      throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'File not found' });
    }

    // Object Ownership Check for Drivers
    if (actorRole === 'DRIVER') {
      const driver = await this.prisma.driver.findUnique({ where: { userId: actorUserId } });
      const driverId = driver?.id;

      const photoAccess = fileRecord.photoPods.some((p) => p.deliveryStop.delivery.driverId === driverId);
      const sigAccess = fileRecord.signaturePods.some((p) => p.deliveryStop.delivery.driverId === driverId);
      const isUploader = fileRecord.uploadedBy === actorUserId;

      if (!isUploader && !photoAccess && !sigAccess) {
        throw new ForbiddenException({
          code: 'RESOURCE_FORBIDDEN',
          message: 'You are not authorized to download this POD file',
        });
      }
    }

    const buffer = await this.localStorageAdapter.getFileBuffer(fileRecord.objectKey);
    return {
      buffer,
      mediaType: fileRecord.mediaType,
      filename: fileRecord.objectKey.split('/').pop() || 'pod.jpg',
    };
  }
}
