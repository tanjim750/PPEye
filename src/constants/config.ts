const rawFolderOrClientId = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_FOLDER_ID;
const isClientId = rawFolderOrClientId?.includes(".apps.googleusercontent.com");

export type StorageMode = "server" | "direct";

export const config = {
  googleClientId:
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ??
    (isClientId ? rawFolderOrClientId : undefined),
  googleDriveFolderId:
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_TARGET_FOLDER_ID ??
    (!isClientId ? rawFolderOrClientId : undefined),
  googleDriveFolderName:
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_FOLDER_NAME ?? "PPEye_submit",
  supabaseAnonKey:
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_KEY,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  storageMode:
    (process.env.EXPO_PUBLIC_STORAGE_MODE as StorageMode) || "server",
};
