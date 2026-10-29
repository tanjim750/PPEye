/** Demo fixtures are permanently disabled. Only login test shortcuts using dummy-users.ts remain available in DEV. */
export const isDemoMode = false;

export const isLoginTestMode = typeof __DEV__ !== 'undefined' && __DEV__;

