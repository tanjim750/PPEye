import { SubmissionLocation, WeatherCoordinates } from './weather.types';

export function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 1) {
    return true;
  }

  if (value === 0) {
    return false;
  }

  return undefined;
}

export function getLocationCoordinates(location: SubmissionLocation): WeatherCoordinates {
  if ('coords' in location) {
    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
  }

  return {
    latitude: location.latitude,
    longitude: location.longitude,
  };
}
