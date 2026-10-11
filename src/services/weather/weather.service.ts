import { locationService } from '@/services/location';

import { mapWeatherResponse } from './weather.mapper';
import {
  OpenMeteoWeatherResponse,
  SubmissionLocation,
  SubmissionWeatherMetadata,
} from './weather.types';
import { getLocationCoordinates } from './weather.utils';

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const OPEN_METEO_CURRENT_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'precipitation',
  'rain',
  'cloud_cover',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'surface_pressure',
  'shortwave_radiation',
  'is_day',
  'weather_code',
];

export async function fetchCurrentWeather(
  latitude: number,
  longitude: number,
): Promise<OpenMeteoWeatherResponse> {
  const url = new URL(OPEN_METEO_FORECAST_URL);

  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('current', OPEN_METEO_CURRENT_FIELDS.join(','));
  url.searchParams.set('temperature_unit', 'celsius');
  url.searchParams.set('wind_speed_unit', 'kmh');
  url.searchParams.set('precipitation_unit', 'mm');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '1');

  const response = await fetch(url.toString());
  const data = (await response.json()) as OpenMeteoWeatherResponse;

  if (!response.ok || data.error) {
    throw new Error(data.reason || 'Unable to fetch current weather.');
  }

  return data;
}

export async function getSubmissionWeatherMetadata(
  location: SubmissionLocation,
): Promise<SubmissionWeatherMetadata | null> {
  try {
    const { latitude, longitude } = getLocationCoordinates(location);
    const response = await fetchCurrentWeather(latitude, longitude);

    return mapWeatherResponse(response);
  } catch (error) {
    console.warn('Weather metadata unavailable.', error);
    return null;
  }
}

export async function getCurrentSubmissionWeatherMetadata(): Promise<SubmissionWeatherMetadata | null> {
  try {
    const permission = await locationService.checkPermission();
    const location = permission.granted
      ? await locationService.getCurrentLocation()
      : await locationService.askPermissionAndGetCurrentLocation();

    return getSubmissionWeatherMetadata(location);
  } catch (error) {
    console.warn('Weather metadata unavailable.', error);
    return null;
  }
}
