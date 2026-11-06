import assert from 'assert';
import { clearAuthSession, setAuthUser } from '@/stores/auth.store';
import { addNotification, clearAllNotifications } from '../notification.service';
import {
  bindPushDeepLinkNavigation,
  configureAndroidPushChannels,
  configureForegroundPushHandler,
  flushPendingPushDeepLink,
  initializePushNotificationLifecycle,
  resolvePushDeepLinkRoute,
  setPushRuntimeAdapterForTesting,
  teardownPushNotificationLifecycle,
} from '../pushNotification.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runPushNotificationTests(): Promise<{
  passed: number;
  failed: number;
  total: number;
}> {
  console.log('\n--- PPEye Native OS Push Notification Pipeline Test Suite ---');
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✘ [FAIL] ${name}`);
      console.error(`    ${err?.message ?? err}`);
      failed++;
    } finally {
      teardownPushNotificationLifecycle();
      setPushRuntimeAdapterForTesting(null);
      clearAuthSession();
      await clearAllNotifications();
    }
  }

  await test('Android high-priority channel configures default MAX importance, PUBLIC lockscreen & #1E40AF', async () => {
    const channelCalls: { id: string; config: any }[] = [];

    setPushRuntimeAdapterForTesting({
      getPlatformOS: () => 'android',
      isPhysicalDevice: () => true,
      isExpoGo: () => false,
      getNotificationsModule: () => ({
        AndroidImportance: { MAX: 5 },
        AndroidNotificationVisibility: { PUBLIC: 1 },
        setNotificationChannelAsync: async (id: string, config: any) => {
          channelCalls.push({ id, config });
        },
      }),
    });

    await configureAndroidPushChannels();

    const defaultChannel = channelCalls.find((c) => c.id === 'default');
    assert.ok(defaultChannel, 'Expected default Android channel to be configured');
    assert.strictEqual(defaultChannel.config.name, 'PPEye Safety Alerts');
    assert.strictEqual(defaultChannel.config.importance, 5);
    assert.deepStrictEqual(defaultChannel.config.vibrationPattern, [0, 250, 250, 250]);
    assert.strictEqual(defaultChannel.config.lightColor, '#1E40AF');
    assert.strictEqual(defaultChannel.config.lockscreenVisibility, 1);
    assert.strictEqual(defaultChannel.config.bypassDnd, false);
    assert.strictEqual(defaultChannel.config.sound, 'default');
  });

  await test('Foreground handler shows heads-up banners and suppresses duplicate WebSocket-handled pushes', async () => {
    let registeredHandler: any = null;

    setPushRuntimeAdapterForTesting({
      getPlatformOS: () => 'android',
      getNotificationsModule: () => ({
        AndroidNotificationPriority: { MAX: 'max' },
        setNotificationHandler: (h: any) => {
          registeredHandler = h;
        },
      }),
    });

    configureForegroundPushHandler();
    assert.ok(registeredHandler, 'Expected setNotificationHandler to be invoked');

    // Fresh remote push -> displays heads-up banner & plays sound
    const freshDecision = await registeredHandler.handleNotification({
      request: {
        trigger: { type: 'push' },
        content: { data: { type: 'NEW_SUBMISSION', submissionId: 777 } },
      },
    });
    assert.strictEqual(freshDecision.shouldShowBanner, true);
    assert.strictEqual(freshDecision.shouldPlaySound, true);

    // Simulate Realtime WebSocket having already added submission 777 in-app
    setAuthUser({
      id: 1,
      name: 'Reviewer One',
      email: 'rev@ppeye.com',
      role: 'reviewer',
      category: 'INTERNAL',
    } as any);
    await addNotification({
      recipientRole: 'reviewer',
      type: 'NEW_SUBMISSION',
      title: 'New PPE Submission',
      titleBn: 'নতুন জমা',
      body: 'Site Alpha',
      bodyBn: 'সাইট আলফা',
      submissionId: 777,
    });

    const duplicateDecision = await registeredHandler.handleNotification({
      request: {
        trigger: { type: 'push' },
        content: { data: { type: 'NEW_SUBMISSION', submissionId: 777 } },
      },
    });
    assert.strictEqual(duplicateDecision.shouldShowBanner, false);
    assert.strictEqual(duplicateDecision.shouldPlaySound, false);
  });

  await test('Lifecycle registers token on login, updates on rotation, and deactivates on logout', async () => {
    let activeToken = 'ExponentPushToken[device-token-v1]';
    let rotationCallback: any = null;
    const rpcCalls: { fn: string; args: any }[] = [];
    const upsertedRows: { payload: any; opts: any }[] = [];
    const deactivatedFilters: Record<string, any>[] = [];

    const mockMemoryStore: Record<string, string> = {};

    setPushRuntimeAdapterForTesting({
      getPlatformOS: () => 'android',
      isPhysicalDevice: () => true,
      isExpoGo: () => false,
      getEasProjectId: () => '42b497db-9bad-461e-bd3a-f15dc51994e0',
      storageGet: async (k) => mockMemoryStore[k] ?? null,
      storageSet: async (k, v) => {
        if (v === null) delete mockMemoryStore[k];
        else mockMemoryStore[k] = v;
      },
      getNotificationsModule: () => ({
        AndroidImportance: { MAX: 5 },
        AndroidNotificationVisibility: { PUBLIC: 1 },
        setNotificationChannelAsync: async () => {},
        setNotificationHandler: () => {},
        getPermissionsAsync: async () => ({ status: 'granted' }),
        getExpoPushTokenAsync: async (opts: any) => {
          assert.strictEqual(opts?.projectId, '42b497db-9bad-461e-bd3a-f15dc51994e0');
          return { data: activeToken };
        },
        addPushTokenListener: (cb: () => void) => {
          rotationCallback = cb;
          return { remove: () => {} };
        },
        addNotificationReceivedListener: () => ({ remove: () => {} }),
      }),
      getSupabaseClient: () => ({
        rpc: async (fn: string, args: any) => {
          rpcCalls.push({ fn, args });
          return { data: true, error: null };
        },
        from: (table: string) => ({
          upsert: async (payload: any, opts: any) => {
            if (table === 'user_push_tokens') {
              upsertedRows.push({ payload, opts });
            }
            return { error: null };
          },
          update: (patch: any) => {
            const filterChain: Record<string, any> = { table, patch };
            const builder: any = {
              eq: (col: string, val: any) => {
                filterChain[col] = val;
                if (
                  table === 'user_push_tokens' &&
                  patch.is_active === false &&
                  filterChain.user_id &&
                  filterChain.push_token
                ) {
                  deactivatedFilters.push({ ...filterChain });
                }
                return builder;
              },
            };
            return builder;
          },
        }),
      }),
    });

    initializePushNotificationLifecycle();

    // 1. Login as Vendor user 42
    setAuthUser({
      id: 42,
      name: 'Ahnaf Vendor',
      email: 'ahnaf@vendor.com',
      role: 'vendor',
      category: 'EXTERNAL',
    } as any);
    await sleep(35);

    assert.strictEqual(upsertedRows.length, 1);
    assert.strictEqual(upsertedRows[0].payload.user_id, 42);
    assert.strictEqual(upsertedRows[0].payload.push_token, 'ExponentPushToken[device-token-v1]');
    assert.strictEqual(upsertedRows[0].payload.is_active, true);
    assert.strictEqual(upsertedRows[0].opts.onConflict, 'user_id,push_token');
    assert.ok(
      rpcCalls.some(
        (c) =>
          c.fn === 'register_user_push_token' &&
          c.args.p_user_id === 42 &&
          c.args.p_push_token === 'ExponentPushToken[device-token-v1]'
      )
    );

    // 2. Simulate OS FCM token rotation
    activeToken = 'ExponentPushToken[device-token-rotated-v2]';
    assert.ok(rotationCallback, 'Expected push token rotation listener to be attached');
    rotationCallback!();
    await sleep(35);

    assert.strictEqual(upsertedRows.length, 2);
    assert.strictEqual(
      upsertedRows[1].payload.push_token,
      'ExponentPushToken[device-token-rotated-v2]'
    );

    // 3. Logout -> unlinks & deactivates token so shared device never cross-leaks
    clearAuthSession();
    await sleep(35);

    assert.ok(
      rpcCalls.some(
        (c) =>
          c.fn === 'unregister_user_push_token' &&
          c.args.p_user_id === 42 &&
          c.args.p_push_token === 'ExponentPushToken[device-token-rotated-v2]'
      ),
      'Expected unregister_user_push_token RPC on logout'
    );
    assert.ok(
      deactivatedFilters.some(
        (f) =>
          f.user_id === 42 &&
          f.push_token === 'ExponentPushToken[device-token-rotated-v2]'
      ),
      'Expected user_push_tokens row to be marked is_active = false on logout'
    );
  });

  await test('Cold-start (killed app) & background tap deep-linking resolves Reviewer/Vendor routes without duplicates', async () => {
    const navigatedRoutes: string[] = [];
    let shellReady = false;
    let tapListener: any = null;

    const coldStartResponse = {
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      notification: {
        request: {
          identifier: 'push-notif-cold-901',
          content: {
            title: 'New PPE Submission',
            body: 'Site Uttara submitted for safety review.',
            data: {
              type: 'NEW_SUBMISSION',
              submissionId: 901,
              siteName: 'Uttara Sector 4',
            },
          },
        },
      },
    };

    setPushRuntimeAdapterForTesting({
      getPlatformOS: () => 'android',
      getNotificationsModule: () => ({
        getLastNotificationResponseAsync: async () => coldStartResponse,
        clearLastNotificationResponseAsync: async () => {},
        addNotificationResponseReceivedListener: (cb: (res: any) => void) => {
          tapListener = cb;
          return { remove: () => {} };
        },
      }),
    });

    setAuthUser({
      id: 7,
      name: 'Inspector Karim',
      email: 'karim@ppeye.com',
      role: 'reviewer',
      category: 'INTERNAL',
    } as any);

    // Bind while app is still on splash/LanguageScreen (shellReady = false)
    bindPushDeepLinkNavigation(
      (href) => navigatedRoutes.push(href),
      () => shellReady
    );
    await sleep(30);

    // Should NOT navigate prematurely before authenticated shell mounts
    assert.strictEqual(navigatedRoutes.length, 0);

    // Authenticated shell mounts -> flushes queued killed-app deep link
    shellReady = true;
    flushPendingPushDeepLink();
    assert.deepStrictEqual(navigatedRoutes, ['/review/901']);

    // Duplicate delivery of the same cold-start notification must be ignored
    tapListener?.(coldStartResponse);
    await sleep(20);
    assert.strictEqual(navigatedRoutes.length, 1);

    // Verify Vendor Safe & Unsafe route resolution + role isolation
    const vendorUser = {
      id: 55,
      name: 'Vendor Rahim',
      role: 'vendor',
      category: 'EXTERNAL',
    };
    assert.strictEqual(
      resolvePushDeepLinkRoute({ type: 'REVIEW_UNSAFE', submissionId: 505 }, vendorUser),
      '/submission-details?id=505'
    );
    assert.strictEqual(
      resolvePushDeepLinkRoute({ type: 'REVIEW_SAFE', submissionId: 506, verdict: 'safe' }, vendorUser),
      '/history?filter=all&submissionId=506'
    );
    assert.strictEqual(
      resolvePushDeepLinkRoute({ type: 'NEW_SUBMISSION', submissionId: 507 }, vendorUser),
      null,
      'External vendor must never be routed to internal /review/[id]'
    );
  });

  console.log(`\nPush Notification Suite Summary: ${passed} passed, ${failed} failed\n`);
  return { passed, failed, total: passed + failed };
}
