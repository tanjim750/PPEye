import { useCallback, useMemo, useState } from 'react';

import { PPECaptureSide, PPEWorkerCapture } from '@/features/capture/types';

type InitialCaptureTarget = {
  side?: PPECaptureSide;
  workerNumber: number;
};

function upsertWorkerCapture(
  captures: PPEWorkerCapture[],
  sequenceNo: number,
  side: PPECaptureSide,
  uri: string,
) {
  const existingCapture = captures.find((capture) => capture.sequenceNo === sequenceNo);
  const nextSideKey = side === 'FRONT' ? 'frontUri' : 'backUri';

  if (!existingCapture) {
    return [
      ...captures,
      {
        sequenceNo,
        [nextSideKey]: uri,
        capturedAt: Date.now(),
      },
    ];
  }

  return captures.map((capture) =>
    capture.sequenceNo === sequenceNo
      ? {
          ...capture,
          [nextSideKey]: uri,
          capturedAt: capture.capturedAt ?? Date.now(),
        }
      : capture,
  );
}

function getCompletedCaptures(captures: PPEWorkerCapture[]) {
  return captures.filter((capture) => capture.frontUri && capture.backUri);
}

function getNextSideForWorker(capture?: PPEWorkerCapture): PPECaptureSide {
  if (!capture?.frontUri) {
    return 'FRONT';
  }

  if (!capture.backUri) {
    return 'BACK';
  }

  return 'FRONT';
}

function getNextWorkerNumber(captures: PPEWorkerCapture[], completedWorkerNumber: number) {
  const nextIncompleteCapture = [...captures]
    .sort((left, right) => right.sequenceNo - left.sequenceNo)
    .find(
      (capture) =>
        capture.sequenceNo !== completedWorkerNumber && (!capture.frontUri || !capture.backUri),
    );

  if (nextIncompleteCapture) {
    return nextIncompleteCapture.sequenceNo;
  }

  return Math.max(completedWorkerNumber, ...captures.map((capture) => capture.sequenceNo)) + 1;
}

function getNewWorkerNumber(captures: PPEWorkerCapture[], currentWorkerNumber: number) {
  return Math.max(currentWorkerNumber, ...captures.map((capture) => capture.sequenceNo)) + 1;
}

function getResumeCaptureTarget(
  captures: PPEWorkerCapture[],
  preferredTarget?: InitialCaptureTarget | null,
) {
  if (preferredTarget) {
    const preferredCapture = captures.find(
      (capture) => capture.sequenceNo === preferredTarget.workerNumber,
    );

    return {
      side: preferredTarget.side ?? getNextSideForWorker(preferredCapture),
      workerNumber: preferredTarget.workerNumber,
    };
  }

  const incompleteCapture = [...captures]
    .sort((left, right) => right.sequenceNo - left.sequenceNo)
    .find((capture) => !capture.frontUri || !capture.backUri);

  if (incompleteCapture) {
    return {
      side: getNextSideForWorker(incompleteCapture),
      workerNumber: incompleteCapture.sequenceNo,
    };
  }

  if (!captures.length) {
    return {
      side: 'FRONT' as const,
      workerNumber: 1,
    };
  }

  return {
    side: 'FRONT' as const,
    workerNumber: Math.max(...captures.map((capture) => capture.sequenceNo)) + 1,
  };
}

function getIncompleteOrNewWorkerTarget(
  captures: PPEWorkerCapture[],
  currentWorkerNumber: number,
) {
  const nextIncompleteCapture = [...captures]
    .sort((left, right) => right.sequenceNo - left.sequenceNo)
    .find((capture) => !capture.frontUri || !capture.backUri);

  if (nextIncompleteCapture) {
    return {
      side: getNextSideForWorker(nextIncompleteCapture),
      workerNumber: nextIncompleteCapture.sequenceNo,
    };
  }

  return {
    side: 'FRONT' as const,
    workerNumber: getNewWorkerNumber(captures, currentWorkerNumber),
  };
}

function removeWorkerCapture(captures: PPEWorkerCapture[], sequenceNo: number) {
  return captures.filter((capture) => capture.sequenceNo !== sequenceNo);
}

export function useContinuousPPECapture(
  initialCaptures: PPEWorkerCapture[] = [],
  initialCaptureTarget?: InitialCaptureTarget | null,
) {
  const [captures, setCaptures] = useState<PPEWorkerCapture[]>(() =>
    initialCaptures.map((capture) => ({ ...capture })),
  );
  const [initialTarget] = useState(() =>
    getResumeCaptureTarget(initialCaptures, initialCaptureTarget),
  );
  const [currentWorkerNumber, setCurrentWorkerNumber] = useState(initialTarget.workerNumber);
  const [currentSide, setCurrentSide] = useState<PPECaptureSide>(initialTarget.side);
  const [selectedPreviewSide, setSelectedPreviewSide] = useState<PPECaptureSide>('FRONT');
  const [isCapturing, setIsCapturing] = useState(false);
  const [isBackPhotoRequired, setIsBackPhotoRequired] = useState(false);
  const [completedCaptureState, setCompletedCaptureState] = useState<PPEWorkerCapture[] | null>(
    null,
  );

  const currentWorkerCapture = captures.find(
    (capture) => capture.sequenceNo === currentWorkerNumber,
  );

  const previewWorkerCapture = currentWorkerCapture;

  const completedCaptures = useMemo(() => getCompletedCaptures(captures), [captures]);

  const selectableWorkers = useMemo(() => {
    const workerNumbers = new Set([
      currentWorkerNumber,
      ...captures.map((capture) => capture.sequenceNo),
    ]);

    return Array.from(workerNumbers)
      .sort((left, right) => left - right)
      .map((sequenceNo) => {
        const capture = captures.find((item) => item.sequenceNo === sequenceNo);

        return {
          capture,
          isComplete: Boolean(capture?.frontUri && capture.backUri),
          isCurrent: sequenceNo === currentWorkerNumber,
          sequenceNo,
        };
      });
  }, [captures, currentWorkerNumber]);

  const capturePhoto = useCallback(
    async (takePhoto: () => Promise<string | undefined>) => {
      if (isCapturing) {
        return;
      }

      setIsCapturing(true);
      setCompletedCaptureState(null);
      setIsBackPhotoRequired(false);

      try {
        const photoUri = await takePhoto();

        if (!photoUri) {
          return;
        }

        const capturedSide = currentSide;
        const capturedWorkerNumber = currentWorkerNumber;
        const nextCaptures = upsertWorkerCapture(
          captures,
          capturedWorkerNumber,
          capturedSide,
          photoUri,
        );

        setCaptures(nextCaptures);

        if (capturedSide === 'FRONT') {
          setSelectedPreviewSide('FRONT');
          setCurrentSide('BACK');
          return;
        }

        const nextWorkerNumber = getNextWorkerNumber(nextCaptures, capturedWorkerNumber);
        const nextWorkerCapture = nextCaptures.find(
          (capture) => capture.sequenceNo === nextWorkerNumber,
        );

        setCurrentWorkerNumber(nextWorkerNumber);
        setCurrentSide(getNextSideForWorker(nextWorkerCapture));
        setSelectedPreviewSide('FRONT');
      } finally {
        setIsCapturing(false);
      }
    },
    [captures, currentSide, currentWorkerNumber, isCapturing],
  );

  const retakeSelectedWorker = useCallback(() => {
    if (!currentWorkerCapture) {
      return;
    }

    setCaptures((currentCaptures) => removeWorkerCapture(currentCaptures, currentWorkerNumber));
    setCurrentSide('FRONT');
    setSelectedPreviewSide('FRONT');
    setCompletedCaptureState(null);
    setIsBackPhotoRequired(false);
  }, [currentWorkerCapture, currentWorkerNumber]);

  const selectPreviewSide = useCallback(
    (side: PPECaptureSide) => {
      setSelectedPreviewSide(side);
    },
    [],
  );

  const keepSelectedWorkerPhoto = useCallback(() => {
    const nextTarget = getIncompleteOrNewWorkerTarget(captures, currentWorkerNumber);

    setCurrentWorkerNumber(nextTarget.workerNumber);
    setCurrentSide(nextTarget.side);
    setSelectedPreviewSide('FRONT');
    setCompletedCaptureState(null);
    setIsBackPhotoRequired(false);
  }, [captures, currentWorkerNumber]);

  const selectWorker = useCallback(
    (sequenceNo: number) => {
      const selectedCapture = captures.find((capture) => capture.sequenceNo === sequenceNo);
      const nextSide = getNextSideForWorker(selectedCapture);

      setCurrentWorkerNumber(sequenceNo);
      setCurrentSide(nextSide);
      setSelectedPreviewSide('FRONT');
      setCompletedCaptureState(null);
      setIsBackPhotoRequired(false);
    },
    [captures],
  );

  const completeCapture = useCallback(() => {
    const completed = getCompletedCaptures(captures);

    if (currentWorkerCapture?.frontUri && !currentWorkerCapture.backUri) {
      setIsBackPhotoRequired(true);
      return null;
    }

    setCompletedCaptureState(completed);
    console.log('Continuous PPE capture complete', completed);
    return completed;
  }, [captures, currentWorkerCapture]);

  const takeBackPhoto = useCallback(() => {
    setCurrentSide('BACK');
    setSelectedPreviewSide('BACK');
    setIsBackPhotoRequired(false);
    setCompletedCaptureState(null);
  }, []);

  const removeCurrentWorker = useCallback(() => {
    const completed = getCompletedCaptures(
      captures.filter((capture) => capture.sequenceNo !== currentWorkerNumber),
    );

    setCaptures(completed);
    setCurrentSide('FRONT');
    setSelectedPreviewSide('FRONT');
    setCurrentWorkerNumber(completed.length + 1);
    setIsBackPhotoRequired(false);
    setCompletedCaptureState(completed);
    console.log('Continuous PPE capture complete', completed);
  }, [captures, currentWorkerNumber]);

  return {
    captures,
    completedCaptureState,
    completedCaptures,
    completeCapture,
    currentSide,
    currentWorkerCapture,
    currentWorkerNumber,
    isBackPhotoRequired,
    isCapturing,
    keepSelectedWorkerPhoto,
    previewWorkerCapture,
    removeCurrentWorker,
    retakeSelectedWorker,
    selectWorker,
    selectPreviewSide,
    selectedPreviewSide,
    selectableWorkers,
    capturePhoto,
    takeBackPhoto,
  };
}
