import {
  OpenMeteoWeatherResponse,
  SubmissionWeatherMetadata,
  WeatherConditionLabel,
} from './weather.types';
import { toOptionalBoolean, toOptionalNumber } from './weather.utils';

export function getWeatherConditionLabel(code?: number): WeatherConditionLabel {
  if (code === undefined) {
    return 'unknown';
  }

  if (code === 0) {
    return 'clear';
  }

  if (code === 1 || code === 2) {
    return 'partly_cloudy';
  }

  if (code === 3) {
    return 'overcast';
  }

  if (code === 45 || code === 48) {
    return 'fog';
  }

  if (code === 51 || code === 53 || code === 55 || code === 56 || code === 57) {
    return 'drizzle';
  }

  if (code === 61 || code === 63 || code === 80 || code === 81) {
    return 'rain';
  }

  if (code === 65 || code === 66 || code === 67 || code === 82) {
    return 'heavy_rain';
  }

  if (code === 95 || code === 96 || code === 99) {
    return 'thunderstorm';
  }

  if (code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86) {
    return 'snow';
  }

  return 'unknown';
}

export function mapWeatherResponse(response: OpenMeteoWeatherResponse): SubmissionWeatherMetadata {
  const current = response.current ?? {};
  const conditionCode = toOptionalNumber(current.weather_code);

  return {
    apparentTemperatureC: toOptionalNumber(current.apparent_temperature),
    cloudCoverPct: toOptionalNumber(current.cloud_cover),
    condition: getWeatherConditionLabel(conditionCode),
    conditionCode,
    fetchedAt: new Date().toISOString(),
    isDay: toOptionalBoolean(current.is_day),
    precipitationMm: toOptionalNumber(current.precipitation),
    provider: 'open-meteo',
    rainMm: toOptionalNumber(current.rain),
    relativeHumidityPct: toOptionalNumber(current.relative_humidity_2m),
    shortwaveRadiationWm2: toOptionalNumber(current.shortwave_radiation),
    surfacePressureHpa: toOptionalNumber(current.surface_pressure),
    temperatureC: toOptionalNumber(current.temperature_2m),
    windDirectionDeg: toOptionalNumber(current.wind_direction_10m),
    windGustKmh: toOptionalNumber(current.wind_gusts_10m),
    windSpeedKmh: toOptionalNumber(current.wind_speed_10m),
  };
}
