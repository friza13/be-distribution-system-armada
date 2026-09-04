import { ImageNormalizerService } from '../../src/modules/pod/services/image-normalizer.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp');

describe('ImageNormalizerService (Unit Tests)', () => {
  let service: ImageNormalizerService;

  beforeAll(() => {
    service = new ImageNormalizerService();
  });

  describe('POD Photo Pipeline (normalizePodPhoto)', () => {
    it('1. should accept and process valid JPEG image', async () => {
      const buffer = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await service.normalizePodPhoto(buffer, 'image/jpeg');

      expect(result.mimeType).toBe('image/jpeg');
      expect(result.extension).toBe('.jpg');
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it('2. should downscale large image (>1600px) proportionally to max 1600px', async () => {
      // 2400 x 1200 (aspect ratio 2:1)
      const largeBuffer = await sharp({
        create: {
          width: 2400,
          height: 1200,
          channels: 3,
          background: { r: 0, g: 255, b: 0 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await service.normalizePodPhoto(largeBuffer, 'image/jpeg');

      expect(result.isNormalized).toBe(true);
      expect(result.width).toBe(1600);
      expect(result.height).toBe(800); // 2:1 ratio preserved
    });

    it('3. should NEVER upscale small image (<1600px) maintaining withoutEnlargement invariant', async () => {
      const smallBuffer = await sharp({
        create: {
          width: 400,
          height: 300,
          channels: 3,
          background: { r: 0, g: 0, b: 255 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await service.normalizePodPhoto(smallBuffer, 'image/jpeg');

      expect(result.width).toBe(400);
      expect(result.height).toBe(300);
    });

    it('4. should canonicalize PNG photo to JPEG output', async () => {
      const pngBuffer = await sharp({
        create: {
          width: 640,
          height: 480,
          channels: 4,
          background: { r: 100, g: 100, b: 100, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const result = await service.normalizePodPhoto(pngBuffer, 'image/png');

      expect(result.isNormalized).toBe(true);
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.extension).toBe('.jpg');
    });

    it('5. should canonicalize WebP photo to JPEG output', async () => {
      const webpBuffer = await sharp({
        create: {
          width: 500,
          height: 500,
          channels: 3,
          background: { r: 50, g: 50, b: 50 },
        },
      })
        .webp()
        .toBuffer();

      const result = await service.normalizePodPhoto(webpBuffer, 'image/webp');

      expect(result.isNormalized).toBe(true);
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.extension).toBe('.jpg');
    });

    it('6. should reject corrupt or invalid buffer safely without crashing', async () => {
      const corruptBuffer = Buffer.from('this is not a valid image payload at all');

      await expect(service.normalizePodPhoto(corruptBuffer, 'image/jpeg')).rejects.toThrow(
        'The submitted image could not be decoded or contains corrupted pixel data',
      );
    });

    it('7. should enforce 25 MP application security pixel cap', async () => {
      // Create a mocked buffer with dimension exceeding 25 MP (e.g. 6000 x 5000 = 30 MP)
      // Note: sharp constructor limitInputPixels enforces policy
      const hugeBuffer = await sharp({
        create: {
          width: 6000,
          height: 5000,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .jpeg()
        .toBuffer();

      await expect(service.normalizePodPhoto(hugeBuffer, 'image/jpeg')).rejects.toThrow();
    });
  });

  describe('Customer Signature Pipeline (normalizeSignature)', () => {
    it('8. should preserve PNG format and alpha transparency for digital signature', async () => {
      const transparentSigBuffer = await sharp({
        create: {
          width: 400,
          height: 200,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }, // Transparent canvas
        },
      })
        .png()
        .toBuffer();

      const result = await service.normalizeSignature(transparentSigBuffer, 'image/png');

      expect(result.mimeType).toBe('image/png');
      expect(result.extension).toBe('.png');

      const meta = await sharp(result.buffer).metadata();
      expect(meta.hasAlpha).toBe(true);
      expect(result.width).toBe(400);
      expect(result.height).toBe(200);
    });

    it('9. should never upscale small signature image', async () => {
      const smallSig = await sharp({
        create: {
          width: 300,
          height: 150,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .png()
        .toBuffer();

      const result = await service.normalizeSignature(smallSig, 'image/png');

      expect(result.width).toBe(300);
      expect(result.height).toBe(150);
    });
  });

  describe('Bounded Concurrency Limiter', () => {
    it('10. should process multiple concurrent normalization requests safely without hanging', async () => {
      const createImg = (w: number, h: number) =>
        sharp({
          create: { width: w, height: h, channels: 3, background: { r: 10, g: 20, b: 30 } },
        })
          .jpeg()
          .toBuffer();

      const [img1, img2, img3, img4] = await Promise.all([
        createImg(800, 600),
        createImg(1000, 800),
        createImg(1200, 900),
        createImg(600, 400),
      ]);

      const results = await Promise.all([
        service.normalizePodPhoto(img1, 'image/jpeg'),
        service.normalizePodPhoto(img2, 'image/jpeg'),
        service.normalizePodPhoto(img3, 'image/jpeg'),
        service.normalizePodPhoto(img4, 'image/jpeg'),
      ]);

      expect(results.length).toBe(4);
      results.forEach((res) => {
        expect(res.buffer.length).toBeGreaterThan(0);
        expect(res.mimeType).toBe('image/jpeg');
      });
    });
  });
});
