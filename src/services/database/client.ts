/**
 * PPEye Supabase Database Service — Client Accessor
 *
 * Exposes the typed Supabase client with optional mock injection for testing.
 * Uses lazy require for client resolution to allow running in non-React-Native test runners.
 */

let clientOverride: any = null;

export function getDbClient(): any {
  if (clientOverride) {
    return clientOverride;
  }
  // Lazy require to avoid importing React Native dependencies during Node unit tests
  return require('../supabase/client').supabase;
}

export function setDbClientOverride(client: any): void {
  clientOverride = client;
}
