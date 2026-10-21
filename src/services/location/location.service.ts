import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

export type LocationPermissionResult = Location.LocationPermissionResponse;
export type CurrentLocationResult = Location.LocationObject;

export class LocationServicesDisabledError extends Error {
  constructor() {
    super('Location services are disabled on this device.');
    this.name = 'LocationServicesDisabledError';
  }
}

export class LocationService {
  async checkPermission(): Promise<LocationPermissionResult> {
    return Location.getForegroundPermissionsAsync();
  }

  async askPermission(): Promise<LocationPermissionResult> {
    return Location.requestForegroundPermissionsAsync();
  }

  async hasPermission(): Promise<boolean> {
    const permission = await this.checkPermission();
    return permission.granted;
  }

  async checkServicesEnabled(): Promise<boolean> {
    return Location.hasServicesEnabledAsync();
  }

  async askToTurnOnLocationServices(): Promise<boolean> {
    if (await this.checkServicesEnabled()) {
      return true;
    }

    if (Platform.OS === 'android') {
      try {
        await Location.enableNetworkProviderAsync();
      } catch {
        await Linking.openSettings();
      }
    } else {
      await Linking.openSettings();
    }

    return this.checkServicesEnabled();
  }

  async getCurrentLocation(
    options: Location.LocationOptions = {
      accuracy: Location.Accuracy.Balanced,
      mayShowUserSettingsDialog: true,
    },
  ): Promise<CurrentLocationResult> {
    const permission = await this.checkPermission();

    if (!permission.granted) {
      throw new Error('Location permission is required to check current location.');
    }

    const isLocationEnabled = await Location.hasServicesEnabledAsync();

    if (!isLocationEnabled) {
      throw new LocationServicesDisabledError();
    }

    // 1. Fast check: try last known position first (instant, prevents timeout indoors)
    try {
      const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge: 10 * 60 * 1000, // 10 minutes
      });
      if (
        lastKnown &&
        lastKnown.coords &&
        typeof lastKnown.coords.latitude === 'number' &&
        !isNaN(lastKnown.coords.latitude)
      ) {
        return lastKnown;
      }
    } catch {
      // Continue to fresh GPS position
    }

    // 2. Fetch fresh position with Balanced / specified accuracy
    try {
      return await Location.getCurrentPositionAsync(options);
    } catch (primaryErr) {
      // 3. Fallback: try with Lowest accuracy (cell/WiFi network, robust indoors)
      try {
        return await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Lowest,
        });
      } catch {
        // 4. Last resort: any cached position of any age
        try {
          const anyLastKnown = await Location.getLastKnownPositionAsync();
          if (
            anyLastKnown &&
            anyLastKnown.coords &&
            typeof anyLastKnown.coords.latitude === 'number'
          ) {
            return anyLastKnown;
          }
        } catch {}

        throw primaryErr;
      }
    }
  }

  async askPermissionAndGetCurrentLocation(
    options?: Location.LocationOptions,
  ): Promise<CurrentLocationResult> {
    const permission = await this.askPermission();

    if (!permission.granted) {
      throw new Error('Location permission was denied.');
    }

    return this.getCurrentLocation(options);
  }
}

export const locationService = new LocationService();
