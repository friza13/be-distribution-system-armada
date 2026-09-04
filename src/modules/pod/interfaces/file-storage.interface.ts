export interface SavedFileResult {
  objectKey: string;
  sizeBytes: number;
  checksumSha256: string;
}

export interface FileStorageAdapter {
  saveFile(buffer: Buffer, originalFilename: string, mimeType: string): Promise<SavedFileResult>;
  getFileBuffer(objectKey: string): Promise<Buffer>;
  deleteFile(objectKey: string): Promise<boolean>;
}
