export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: Record<string, unknown> | Array<unknown> | string | null;
}

export class ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorDetail | null;
  timestamp: string;
  requestId: string;

  constructor(
    success: boolean,
    data: T | null,
    error: ApiErrorDetail | null,
    requestId: string,
  ) {
    this.success = success;
    this.data = data;
    this.error = error;
    this.timestamp = new Date().toISOString();
    this.requestId = requestId;
  }

  static success<T>(data: T, requestId: string): ApiResponse<T> {
    return new ApiResponse<T>(true, data, null, requestId);
  }

  static error(error: ApiErrorDetail, requestId: string): ApiResponse<null> {
    return new ApiResponse<null>(false, null, error, requestId);
  }
}
