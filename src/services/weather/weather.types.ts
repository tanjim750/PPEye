import { CurrentLocationResult } from '@/services/location';

export type WeatherProvider = 'open-meteo';

export type WeatherConditionLabel =
  | 'clear'
  | 'partly_cloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'heavy_rain'
  | 'thunderstorm'
  | 'snow'
  | 'unknown';

export type SubmissionWeatherMetadata = {
  conditionCode?: number;
  condition?: WeatherConditionLabel;

  temperatureC?: number;
  apparentTemperatureC?: number;
  relativeHumidityPct?: number;

  precipitationMm?: number;
  rainMm?: number;

  cloudCoverPct?: number;

  windSpeedKmh?: number;
  windGustKmh?: number;
  windDirectionDeg?: number;

  surfacePressureHpa?: number;

  shortwaveRadiationWm2?: number;

  isDay?: boolean;

  provider: WeatherProvider;
  fetchedAt: string;
};

export type WeatherCoordinates = {
  latitude: number;
  longitude: number;
};

export type SubmissionLocation = CurrentLocationResult | WeatherCoordinates;

export type OpenMeteoCurrentWeather = {
  apparent_temperature?: unknown;
  cloud_cover?: unknown;
  interval?: unknown;
  is_day?: unknown;
  precipitation?: unknown;
  rain?: unknown;
  relative_humidity_2m?: unknown;
  shortwave_radiation?: unknown;
  surface_pressure?: unknown;
  temperature_2m?: unknown;
  time?: unknown;
  weather_code?: unknown;
  wind_direction_10m?: unknown;
  wind_gusts_10m?: unknown;
  wind_speed_10m?: unknown;
};

export type OpenMeteoWeatherResponse = {
  current?: OpenMeteoCurrentWeather;
  error?: boolean;
  reason?: string;
};
