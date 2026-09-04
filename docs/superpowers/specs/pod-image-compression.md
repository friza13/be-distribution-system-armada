# POD Photo Client-Side Compression & Backend Conditional Normalization Specification

**Document Version:** 1.0.0 (Canonical Specification)  
**Milestone:** Phase 18 Hardened Milestone  
**Date:** 2026-09-04  
**Status:** **APPROVED & SPECIFIED**  
**Repository Architecture:** **POLYREPO / STANDALONE BACKEND**

---

## 1. Problem Statement & Goals

### 1.1 Problem Statement
Modern smartphone cameras generate raw photos ranging from 12 MP to 48 MP with file sizes between 3 MB and 15+ MB. In logistics distribution operations, drivers upload Proof of Delivery (POD) photos across variable cellular network conditions (3G, HSPA, weak 4G). Uploading raw camera files causes:
1. Significant uplink latency (15–60s) and frequent HTTP request timeouts.
2. Unnecessary battery and mobile data plan consumption for drivers.
3. Rapid disk space exhaustion on staging/production VPS storage (30 GB SSD).

### 1.2 Goals
- Establish Driver Mobile client-side optimization as the **PRIMARY bandwidth optimization** strategy to minimize bytes before transmission over the network.
- Establish Backend image validation and conditional normalization as the **SECURITY BOUNDARY and INTEGRITY GUARANTEE**.
- Enforce strict server-side invariants against client bypass (magic-byte validation, 25 MP application pixel policy, input byte caps).
- Prevent unnecessary double-lossy compression: compliant client images are validated and stored without re-encoding.
- Separate photo processing from digital customer signature processing (preserving alpha transparency).
- Guarantee that smaller images are **NEVER upscaled** (`withoutEnlargement: true`).
- Strip unnecessary EXIF/GPS/device metadata after correcting orientation to protect driver and recipient privacy.
- Guarantee atomic compensation: if database `FileRecord` creation fails, physical files are immediately deleted to prevent orphaned storage leaks.

### 1.3 Non-Goals
- **Original Raw Camera Photo Retention is OUT OF SCOPE:** Neither the raw 15 MB camera photo nor a secondary archival copy is retained. Only the optimized/normalized evidence is stored.
- **Asynchronous Message Queues are OUT OF SCOPE:** No BullMQ or Redis queue workers are introduced; processing runs in a bounded synchronous pipeline.
- **Client App Implementation in this Repo is OUT OF SCOPE:** Mobile optimization is executed in the separate Flutter Driver Mobile repository.

---

## 2. User Experience & Architecture Flow

```text
Driver Camera Capture (Raw 3–15+ MB)
           ↓
[Driver Mobile App (Flutter) — Separate Repository]
 ├── Proportional local downscale (max dimension <= 1600px)
 ├── JPEG compression (quality ~75–80%)
 └── Preferred target range: ~200–500 KB (Content-dependent, not guaranteed)
           ↓
[Network Upload via POST /v1/files/upload]
           ↓
[Backend API (NestJS) — This Repository]
 ├── 1. Authenticate & Authorize (Bearer JWT + RBAC)
 ├── 2. Input Byte Limit Check (Photo <= 5 MB, Signature <= 500 KB)
 ├── 3. Magic Bytes Inspection (JPEG: FF D8 FF, PNG: 89 50 4E 47, WebP: 52 49 46 46)
 ├── 4. Sharp Safe Inspection with 25 MP Cap (limitInputPixels = 25,000,000)
 ├── 5. Conditional Normalization Decision:
 │      ├── Compliant JPEG & <=1600px & clean metadata? -> Store directly
 │      └── Needs downscale, rotation, or canonicalization? -> Normalize via Sharp
 ├── 6. Concurrency Limiter (Bounded active Sharp executions)
 ├── 7. SHA-256 Checksum generation of final stored bytes
 └── 8. Atomic DB persistence with compensating file deletion on failure
           ↓
[Private POD Storage (storage/private/pod/YYYY/MM/<uuid>.jpg)]
           ↓
[PostgreSQL FileRecord Metadata]
```

---

## 3. Detailed Technical Invariants

### 3.1 Separation of Input Byte Limits vs Dimension Limits
- **Input Byte Cap:** Maximum 5 MB for photos, 500 KB for signatures. Protects network socket and multipart memory allocation.
- **Dimension Cap:** Maximum width $\le 1600\text{px}$, height $\le 1600\text{px}$. Normalization is triggered by image dimensions, not arbitrarily by file size.

### 3.2 Non-Upscaling Invariant
- The backend must **NEVER upscale** any image smaller than target dimensions.
- If an input photo is $800 \times 600$, its dimensions remain $800 \times 600$.

### 3.3 Application Security Pixel Cap (25 MP)
- To prevent decompression bomb attacks (tiny files with huge decompressed pixel dimensions), the application enforces `limitInputPixels = 25,000,000`.
- Images exceeding 25 MP are rejected during decoding before excessive memory allocation occurs.

### 3.4 Separate Pipelines: Photo vs Signature

| Pipeline Aspect | POD Photo (`normalizePodPhoto`) | Customer Signature (`normalizeSignature`) |
|:---|:---|:---|
| Accepted Input MIME | `image/jpeg`, `image/png`, `image/webp` | `image/png`, `image/webp` |
| Canonical Output MIME | **`image/jpeg`** | **`image/png`** |
| Alpha Channel | Opaque RGB | **Strictly Preserved (Transparent background)** |
| Dimension Bounds | Proportional downscale to max 1600px | Max 800x600, no aggressive downscaling |
| Encoding Quality | JPEG 80 (mozjpeg enabled) | PNG compression level 9 (lossless line fidelity) |

### 3.5 EXIF & Privacy Metadata Policy
- Camera images may contain EXIF metadata including GPS coordinates, camera/device information, timestamps, and orientation flags.
- The pipeline applies sensor orientation via `.rotate()` so images are stored upright, then strips all unnecessary EXIF, IPTC, and XMP metadata to protect user privacy.

### 3.6 Hash & Integrity Semantics
- `FileRecord.checksumSha256` represents the SHA-256 hash of the exact bytes physically stored in private storage.
- It does not represent the raw camera file from the driver's phone.

### 3.7 Historical File Compatibility
- Pre-existing files in `storage/private/pod/` are not modified or recompressed.
- The download endpoint `GET /v1/files/:id/download` seamlessly streams both historical and new canonical files.
