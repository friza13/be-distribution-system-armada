# POD Photo Client-Side Compression & Backend Normalization Implementation Plan

**Document Version:** 1.0.0 (Implementation Plan)  
**Milestone:** Phase 18 Hardened Implementation  
**Date:** 2026-09-04  
**Status:** **IMPLEMENTED & VERIFIED**  
**Repository Model:** **POLYREPO / STANDALONE BACKEND**

---

## 1. Implementation Components & Files Changed

| Component | File Path | Status | Purpose |
|:---|:---|:---:|:---|
| **Dependency** | `package.json`, `package-lock.json` | Modified | Pinned `sharp@^0.35.4` (Built-in TypeScript types verified via Context7) |
| **Normalizer Service** | `src/modules/pod/services/image-normalizer.service.ts` | **Added** | Encapsulates Sharp pipeline: 25 MP cap, non-upscaling resize, EXIF rotation & stripping, concurrency limiter |
| **Storage Service** | `src/modules/pod/services/file-storage.service.ts` | Modified | Integrates conditional normalization and compensating file deletion on DB error |
| **POD Controller** | `src/modules/pod/pod.controller.ts` | Modified | Distinguishes photo vs signature category from request payload |
| **POD Module** | `src/modules/pod/pod.module.ts` | Modified | Registers and exports `ImageNormalizerService` |
| **Unit Tests** | `test/pod/image-normalizer.spec.ts` | **Added** | 10 unit test cases covering photos, signatures, downscaling, non-upscaling, corrupt images, 25 MP cap, and concurrency |
| **E2E Integration Tests** | `test/deliveries/pod-upload.e2e-spec.ts` | Modified | Verified end-to-end upload with normalization and download authorization |

---

## 2. Technical Implementation Architecture

### 2.1 ImageNormalizerService Core Details
- **Constructor:** Configures Sharp internal cache for 2 GB RAM environment:
  ```typescript
  sharp.cache({ memory: 50, files: 20, items: 100 });
  ```
- **Concurrency Limiter:** Uses an in-memory queue allowing a maximum of **2 active Sharp operations** concurrently, with a 10-second timeout queue safeguard.
- **Safety Policy:** Sharp instances are created with:
  ```typescript
  sharp(inputBuffer, {
    limitInputPixels: 25000000, // 25 MP Application Policy
    failOn: 'warning',          // Abort on corrupted/truncated buffers
  })
  ```
- **Conditional Decision:** Evaluates dimensions, format, orientation tag, and metadata. Compliant JPEGs skip re-encoding; oversized images downscale proportionally using `withoutEnlargement: true`.

### 2.2 Atomic Consistency & Compensating Deletion
In `FileStorageService.saveFileRecord`:
```typescript
const saved = await this.localStorageAdapter.saveFile(bufferToSave, originalName, finalMime);

try {
  const fileRecord = await this.prisma.fileRecord.create({
    data: {
      objectKey: saved.objectKey,
      mediaType: finalMime,
      sizeBytes: saved.sizeBytes,
      checksumSha256: saved.checksumSha256,
      uploadedBy: uploaderUserId,
    },
  });
  return fileRecord;
} catch (dbError) {
  // Compensating transaction: remove physical file if database record creation fails
  await this.localStorageAdapter.deleteFile(saved.objectKey).catch(() => {});
  throw dbError;
}
```

---

## 3. Visual Quality & Concurrency Acceptance

### 3.1 Visual Quality Acceptance
- Tested with real valid image fixtures.
- Output JPEG quality 80 preserves shipping box labels, tracking numbers, and package condition without visible artifact distortion.

### 3.2 Concurrency Test Result
- Verified in `test/pod/image-normalizer.spec.ts` (Test 10): 4 simultaneous multi-dimensional images normalized concurrently without memory spikes, deadlocks, or process crashes.

---

## 4. Verification Commands

```bash
# 1. Run Image Normalizer unit tests
npm run test -- test/pod/image-normalizer.spec.ts

# 2. Run POD upload E2E integration tests
npm run test:e2e -- test/deliveries/pod-upload.e2e-spec.ts

# 3. Run full regression test suites
npm run test
npm run test:e2e -- --maxWorkers=4
npm run build
bash scripts/api-smoke-test.sh
```
