import { useCallback, useMemo, useRef, useState } from 'react';

import { OtherCapturePhoto } from '@/features/capture/types';

function getNextPhotoNumber(photos: OtherCapturePhoto[]) {
  if (!photos.length) {
    return 1;
  }

  return Math.max(...photos.map((photo) => photo.sequenceNo)) + 1;
}

export function useContinuousOthersCapture(initialPhotos: OtherCapturePhoto[] = []) {
  const [photos, setPhotos] = useState<OtherCapturePhoto[]>(() =>
    initialPhotos.map((photo) => ({ ...photo })),
  );
  const [currentPhotoNumber, setCurrentPhotoNumber] = useState(() =>
    getNextPhotoNumber(initialPhotos),
  );
  const [selectedPhotoNumber, setSelectedPhotoNumber] = useState<number | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const isCapturingRef = useRef(false);

  const selectedPhoto = useMemo(
    () => photos.find((photo) => photo.sequenceNo === selectedPhotoNumber),
    [photos, selectedPhotoNumber],
  );

  const capturePhoto = useCallback(
    async (takePhoto: () => Promise<string | undefined>) => {
      if (isCapturing || isCapturingRef.current) {
        return;
      }

      isCapturingRef.current = true;
      setIsCapturing(true);

      try {
        const photoUri = await takePhoto();

        if (!photoUri) {
          return;
        }

        const nextPhoto = {
          sequenceNo: currentPhotoNumber,
          uri: photoUri,
        };

        setPhotos((currentPhotos) => [...currentPhotos, nextPhoto]);
        setCurrentPhotoNumber((currentNumber) => currentNumber + 1);
      } finally {
        isCapturingRef.current = false;
        setIsCapturing(false);
      }
    },
    [currentPhotoNumber, isCapturing],
  );

  const retakeSelectedPhoto = useCallback(() => {
    if (!selectedPhotoNumber) {
      return;
    }

    setPhotos((currentPhotos) =>
      currentPhotos.filter((photo) => photo.sequenceNo !== selectedPhotoNumber),
    );
    setCurrentPhotoNumber(selectedPhotoNumber);
    setSelectedPhotoNumber(null);
  }, [selectedPhotoNumber]);

  const removeSelectedPhoto = useCallback(() => {
    if (!selectedPhotoNumber) {
      return;
    }

    setPhotos((currentPhotos) => {
      const nextPhotos = currentPhotos.filter((photo) => photo.sequenceNo !== selectedPhotoNumber);
      const nextSelectedPhoto = nextPhotos[nextPhotos.length - 1];

      setSelectedPhotoNumber(nextSelectedPhoto?.sequenceNo ?? null);
      setCurrentPhotoNumber(getNextPhotoNumber(nextPhotos));

      return nextPhotos;
    });
  }, [selectedPhotoNumber]);

  return {
    capturePhoto,
    currentPhotoNumber,
    isCapturing,
    photos,
    removeSelectedPhoto,
    retakeSelectedPhoto,
    selectedPhoto,
    selectedPhotoNumber,
    selectPhoto: setSelectedPhotoNumber,
  };
}
