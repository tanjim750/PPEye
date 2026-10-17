export type PPECaptureSide = 'FRONT' | 'BACK';

export type PPEWorkerCapture = {
  sequenceNo: number;
  frontUri?: string;
  backUri?: string;
  capturedAt?: number;
};

export type OtherCapturePhoto = {
  sequenceNo: number;
  uri: string;
};
