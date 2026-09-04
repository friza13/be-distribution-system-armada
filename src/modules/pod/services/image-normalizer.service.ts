import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Metadata } from 'sharp';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp');

export interface NormalizedResult {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  width?: number;
  height?: number;
  isNormalized: boolean;
  sizeBytes: number;
}

@Injectable()
export class ImageNormalizerService {
  private readonly logger = new Logger(ImageNormalizerService.name);

  // Application-level security policy: 25 MP decoded pixel cap (Anti-Decompression Bomb)
  public static readonly MAX_DECODED_PIXELS = 25_000_000;

  // Maximum dimension policy for POD photos
  public static readonly MAX_PHOTO_DIMENSION = 1600;

  // Target encoding quality
  public static readonly JPEG_QUALITY = 80;

  // Bounded concurrency limiter (Initial proposal: 2 concurrent Sharp executions)
  private readonly maxConcurrency = 2;
  private currentActive = 0;
  private readonly queue: Array<() => void> = [];

  constructor() {
    // Configure Sharp global cache limits for Staging VPS (2 GB RAM / 2 vCPU)
    if (typeof sharp.cache === 'function') {
      sharp.cache({ memory: 50, files: 20, items: 100 });
    }
  }

  private async acquireConcurrencySlot(): Promise<() => void> {
    if (this.currentActive < this.maxConcurrency) {
      this.currentActive++;
      return () => this.releaseConcurrencySlot();
    }

    return new Promise<() => void>((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        const idx = this.queue.indexOf(resume);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        reject(
          new UnprocessableEntityException({
            code: 'IMAGE_PROCESSING_TIMEOUT',
            message: 'Image processing queue timeout exceeded under high load',
          }),
        );
      }, 10000);

      const resume = () => {
        clearTimeout(timeoutTimer);
        resolve(() => this.releaseConcurrencySlot());
      };

      this.queue.push(resume);
    });
  }

  private releaseConcurrencySlot(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        next();
        return;
      }
    }
    this.currentActive = Math.max(0, this.currentActive - 1);
  }

  /**
   * Pipeline for POD Photographs:
   * Accepts: JPEG, PNG, WebP
   * Canonical Output: JPEG
   * Policies: Max 1600px, withoutEnlargement: true, auto-orient, strip metadata
   */
  async normalizePodPhoto(inputBuffer: Buffer, declaredMime: string): Promise<NormalizedResult> {
    const release = await this.acquireConcurrencySlot();

    try {
      // 1. Safe Sharp instance with application security policy limitInputPixels = 25 MP
      const pipeline = sharp(inputBuffer, {
        limitInputPixels: ImageNormalizerService.MAX_DECODED_PIXELS,
        failOn: 'warning',
      });

      // 2. Inspect image metadata safely
      let metadata: Metadata;
      try {
        metadata = await pipeline.metadata();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to parse image metadata or corrupt image buffer: ${msg}`);
        throw new UnprocessableEntityException({
          code: 'INVALID_IMAGE_DATA',
          message: 'The submitted image could not be decoded or contains corrupted pixel data',
        });
      }

      if (!metadata.width || !metadata.height) {
        throw new UnprocessableEntityException({
          code: 'INVALID_IMAGE_DIMENSIONS',
          message: 'Image has invalid or missing width/height dimensions',
        });
      }

      const totalPixels = metadata.width * metadata.height;
      if (totalPixels > ImageNormalizerService.MAX_DECODED_PIXELS) {
        throw new UnprocessableEntityException({
          code: 'PIXEL_LIMIT_EXCEEDED',
          message: `Decoded image pixels (${totalPixels}) exceeds maximum application security limit of ${ImageNormalizerService.MAX_DECODED_PIXELS}`,
        });
      }

      // 3. Evaluate conditional normalization
      const isJpeg = metadata.format === 'jpeg' || declaredMime === 'image/jpeg';
      const withinDimensions =
        metadata.width <= ImageNormalizerService.MAX_PHOTO_DIMENSION &&
        metadata.height <= ImageNormalizerService.MAX_PHOTO_DIMENSION;
      const needsOrientation = !!metadata.orientation && metadata.orientation > 1;
      const hasUnwantedMetadata = !!(metadata.exif || metadata.iptc || metadata.xmp);

      // If already optimal JPEG, within bounds, correct orientation and stripped of metadata:
      if (isJpeg && withinDimensions && !needsOrientation && !hasUnwantedMetadata) {
        this.logger.debug('POD Photo already complies with canonical policy, skipping re-encoding');
        return {
          buffer: inputBuffer,
          mimeType: 'image/jpeg',
          extension: '.jpg',
          width: metadata.width,
          height: metadata.height,
          isNormalized: false,
          sizeBytes: inputBuffer.length,
        };
      }

      // 4. Normalize through Sharp: Auto-orient, proportional downscale (never upscale), strip metadata, encode to JPEG
      const transformer = sharp(inputBuffer, {
        limitInputPixels: ImageNormalizerService.MAX_DECODED_PIXELS,
        failOn: 'warning',
      })
        .rotate() // Auto-orient based on EXIF and remove orientation tag
        .resize({
          width: ImageNormalizerService.MAX_PHOTO_DIMENSION,
          height: ImageNormalizerService.MAX_PHOTO_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true, // Non-upscale invariant: smaller images are never enlarged
        })
        .jpeg({
          quality: ImageNormalizerService.JPEG_QUALITY,
          mozjpeg: true,
        });

      const normalizedBuffer = await transformer.toBuffer();
      const outputMetadata = await sharp(normalizedBuffer).metadata();

      this.logger.debug(
        `POD Photo normalized: ${metadata.width}x${metadata.height} (${inputBuffer.length} B) -> ` +
          `${outputMetadata.width}x${outputMetadata.height} (${normalizedBuffer.length} B)`,
      );

      return {
        buffer: normalizedBuffer,
        mimeType: 'image/jpeg',
        extension: '.jpg',
        width: outputMetadata.width,
        height: outputMetadata.height,
        isNormalized: true,
        sizeBytes: normalizedBuffer.length,
      };
    } finally {
      release();
    }
  }

  /**
   * Pipeline for Customer Digital Signatures:
   * Accepts: PNG, WebP
   * Canonical Output: PNG
   * Policies: Preserve alpha transparency & line fidelity, strip metadata, no aggressive downscaling
   */
  async normalizeSignature(inputBuffer: Buffer, declaredMime: string): Promise<NormalizedResult> {
    const release = await this.acquireConcurrencySlot();

    try {
      const pipeline = sharp(inputBuffer, {
        limitInputPixels: ImageNormalizerService.MAX_DECODED_PIXELS,
        failOn: 'warning',
      });

      let metadata: Metadata;
      try {
        metadata = await pipeline.metadata();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to decode signature image buffer: ${msg}`);
        throw new UnprocessableEntityException({
          code: 'INVALID_SIGNATURE_DATA',
          message: 'The submitted signature image could not be decoded or contains corrupted data',
        });
      }

      const totalPixels = (metadata.width || 0) * (metadata.height || 0);
      if (totalPixels > ImageNormalizerService.MAX_DECODED_PIXELS) {
        throw new UnprocessableEntityException({
          code: 'PIXEL_LIMIT_EXCEEDED',
          message: 'Signature decoded pixels exceed maximum allowed limit',
        });
      }

      // Canonical signature output: PNG with preserved alpha channel
      const transformer = sharp(inputBuffer, {
        limitInputPixels: ImageNormalizerService.MAX_DECODED_PIXELS,
        failOn: 'warning',
      })
        .resize({
          width: 800,
          height: 600,
          fit: 'inside',
          withoutEnlargement: true, // Non-upscaling guarantee
        })
        .png({
          compressionLevel: 9,
          effort: 7,
        });

      const normalizedBuffer = await transformer.toBuffer();
      const outputMetadata = await sharp(normalizedBuffer).metadata();

      return {
        buffer: normalizedBuffer,
        mimeType: 'image/png',
        extension: '.png',
        width: outputMetadata.width,
        height: outputMetadata.height,
        isNormalized: true,
        sizeBytes: normalizedBuffer.length,
      };
    } finally {
      release();
    }
  }
}
