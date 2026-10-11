export type GoogleDriveClientConfig = {
  accessToken: string;
};

export function createGoogleDriveClient({ accessToken }: GoogleDriveClientConfig) {
  return {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  };
}
