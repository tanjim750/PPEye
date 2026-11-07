import NetInfo, { NetInfoState, NetInfoStateType } from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';

const OFFLINE_DEBOUNCE_MS = 1000;

const isOnline = (s: NetInfoState) => s.isConnected !== false && s.isInternetReachable !== false;

/** Human label for the blocker: distinguishes "router without internet" from fully disconnected. */
const describe = (s: NetInfoState) =>
  s.type === NetInfoStateType.wifi && s.isConnected ? 'Wi-Fi (No Internet)'
    : s.type === NetInfoStateType.cellular && s.isConnected ? 'Mobile Data (No Internet)'
    : 'Disconnected';

/** isOnline is null until the first reading; going offline is debounced, recovery is instant. */
export function useNetworkConnectivity() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [status, setStatus] = useState('Checking connection...');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback((state: NetInfoState) => {
    if (timer.current) clearTimeout(timer.current);
    if (isOnline(state)) {
      setOnline(true);
    } else {
      timer.current = setTimeout(() => {
        setStatus(describe(state));
        setOnline(false);
      }, OFFLINE_DEBOUNCE_MS);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(apply);
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [apply]);

  const retry = useCallback(async () => {
    setStatus('Checking connection...');
    const state = await NetInfo.refresh();
    if (timer.current) clearTimeout(timer.current);
    setStatus(describe(state));
    setOnline(isOnline(state));
  }, []);

  return { isOnline: online, status, retry };
}
