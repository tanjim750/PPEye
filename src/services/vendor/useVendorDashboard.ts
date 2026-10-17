import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  getVendorDashboardStats,
  VendorDashboardStats,
  VendorRecentCheckItem,
} from './vendorSubmissions.service';
import { getVendorPermissions, VendorPermissions } from './vendorRole.service';

export function useVendorDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<VendorDashboardStats>({
    totalSubmissions: 0,
    pendingCount: 0,
    safeCount: 0,
    unsafeCount: 0,
    draftCount: 0,
    todayChecks: 0,
    complianceRate: 100,
    activeDraft: null,
  });
  const [recentChecks, setRecentChecks] = useState<VendorRecentCheckItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const permissions: VendorPermissions = getVendorPermissions(user?.externalType);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const vendorProfileId = user?.vendorProfileId || 1;
      const userId = typeof user?.id === 'number' ? user.id : undefined;

      const result = await getVendorDashboardStats(
        vendorProfileId,
        userId,
        user?.externalType
      );

      setStats(result.stats);
      setRecentChecks(result.recentChecks);
    } catch (err: any) {
      console.warn('[useVendorDashboard] Failed to fetch dashboard data:', err);
      setError(err?.message || 'Failed to load dashboard metrics');
    } finally {
      setLoading(false);
    }
  }, [user?.vendorProfileId, user?.id, user?.externalType]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    recentChecks,
    permissions,
    loading,
    error,
    refresh: fetchStats,
    user,
  };
}
