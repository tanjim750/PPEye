# PPEye Page Checklist

Phase C tracker. `todo` means the visual pass and device verification have not both been signed off. Routes, actions, and states stay strictly as implemented and documented in `BUSINESS_FLOW.md`; this list does not authorize new navigation, database changes, or behavior.

## Shared Screens & Components (Phase C Scope)

| Page / Component / State | Route or Component File | Role | Status | Notes |
|---|---|---:|---|---|
| Launch / Root Resolution | `app/index.tsx`, `app/_layout.tsx` | Both | completed (Phase C) | Dark navy shell (`#081326`), blue radial top glow, `SplashScreen.preventAutoHideAsync()` to prevent white flash, direct role-based resolution to prevent wrong-screen flash |
| Language Onboarding | `app/(onboarding)/language.tsx`, `LanguageScreen.tsx` | Both | completed (Phase C) | Dark navy glass radio cards, safe line-heights (`getLineHeight(..., 'bn')`) for Bengali vowels/conjuncts, responsive max-width |
| Sign In (Login) | `app/(auth)/login.tsx`, `LoginScreen.tsx` | Both | completed (Phase C) | Dark navy glass shell, electric blue active inputs, UI-thread Reanimated error shake, dev demo login kept behind `isLoginTestMode` |
| Forgot Password | `app/(auth)/forgot-password.tsx`, `ForgotPasswordScreen.tsx` | Both | completed (Phase C) | Dark navy glass card, email validation, clean recovery instructions state |
| Settings | `app/settings/index.tsx`, `SettingsScreen.tsx` | Both | completed (Phase C) | **Full-width layout bug and right-side strip FIXED** (removed conflicting light background classes, unified dark navy viewport, glass cards, animated language switch) |
| Profile | `app/settings/profile.tsx`, `app/profile.tsx`, `ProfileScreen.tsx` | Both | completed (Phase C) | Dark glass container, avatar ring with upload trigger, missing-photo initials fallback, responsive form layout |
| Change Password | `app/settings/change-password.tsx`, `ChangePasswordScreen.tsx` | Both | completed (Phase C) | Dark glass card, eye password visibility toggles, Supabase Auth update with error/success feedback |
| Add User | `app/settings/add-user.tsx`, `app/add-user.tsx`, `AddUserScreen.tsx` | Both | completed (Phase C) | Dark glass container, animated segmented control (internal/external), role pills, explicit confirmation that Supabase Auth credentials are created via dashboard |
| Notifications Preferences | `app/settings/notifications.tsx`, `NotificationsScreen.tsx` | Both | completed (Phase C) | Dark glass container, dark navy switch tracks, review and account toggle preferences |
| Language Settings | `app/settings/language.tsx`, `LanguageScreen.tsx` | Both | completed (Phase C) | Shared single implementation with onboarding, instant preview and persistence via AsyncStorage |
| Help and Support | `app/settings/help.tsx`, `HelpSupportScreen.tsx`, `HelpScreen.tsx` | Both | completed (Phase C) | Dark glass container, search filter, action tiles for phone and email, expandable help topics |
| About PPEye | `app/settings/about.tsx`, `AboutScreen.tsx` | Both | completed (Phase C) | Dark glass container, glowing logo frame, version pills, technical details card, legal links |
| Floating Glass Tab Bar | `src/components/ui/GlassKit.tsx` (`GlassTabBar`) | Both | completed (Phase C) | Translucent dark glass floating pill, wired strictly to existing role routes (Vendor: Home, History, Settings; Reviewer: Home, Queue, History, Settings) |
| Central Theme System | `src/constants/theme.ts` | Both | completed (Phase C) | Centralized `Palette`, `Glass`, `Radius`, `Shadows`, `Spacing`, `Typography`, `Motion`, and script-safe `getLineHeight` |
| Glass Component Kit (19 components) | `src/components/ui/GlassKit.tsx` | Both | completed (Phase C) | `GlassCard`, `GradientHeroCard`, `MetricTile`, `ProgressRing`, `StatusPill`, `Avatar`, `IconTile`, `PressableScale`, `SectionHeader`, `Skeleton`, `EmptyState`, `ErrorState`, `Toast`, `GlassTabBar`, `AppHeader`, `PrimaryButton`, `SecondaryButton`, `SegmentedControl`, `OfflineBanner` |
| Dev-Only Component Preview | `SettingsScreen.tsx` (Dev Modal) | Both | completed (Phase C) | Guarded strictly by `__DEV__` (excluded from production release builds), renders all 19 components in loading, empty, error, long English, and Bengali script states |

---

## Domain & Feature Screens (Preserved for Subsequent Phases)

| Page / Feature State | Route or Component File | Role | Status | Notes |
|---|---|---:|---|---|
| Vendor Home & Recent Checks | `app/(external)/index.tsx`, `SharedHomeScreen.tsx` | Vendor | todo | Live Supabase vendor metrics and checks, DEMO marker on test fixtures |
| PPE Camera Capture | `app/(external)/capture.tsx`, `continuous-ppe-capture.tsx` | Vendor | todo | Portrait-locked camera, FRONT/BACK pose sequence, permission/error states |
| Optional Site/Context Photos | `app/(external)/capture-others.tsx`, `OthersCaptureScreen.tsx` | Vendor | todo | Optional site photos (access ID, rooftop, banners, first-aid box) |
| Review Before Submit | `app/(external)/submission-review.tsx`, `SubmissionReviewScreen.tsx` | Vendor | todo | Worker photo pair verification, GPS location prompt, weather metadata |
| Vendor Submission History | `app/(external)/history.tsx`, `SubmissionHistoryScreen.tsx` | Vendor | todo | Filterable submission cards, status badges, unsafe worker correction trigger |
| Unsafe Worker Details / Correction | `app/(external)/submission-details.tsx`, `SubmissionDetailsActionRequiredScreen.tsx` | Vendor | todo | Displays unsafe reasons/notes, photo replacement loop for resubmission |
| Vendor Team Management | `app/(external)/team.tsx`, `VendorTeamScreen.tsx` | Vendor (PM) | todo | Role-gated for Project Managers, lists vendor members, links profiles |
| Reviewer Home | `app/(internal)/index.tsx`, `InternalHomeScreen.tsx` | Reviewer | todo | Live queue summary, quick navigation to queue and history |
| Reviewer Queue | `app/(internal)/reviews.tsx`, `ReviewQueueScreen.tsx` | Reviewer | todo | Live Supabase submissions, 3 in-progress draft limit owned by reviewer |
| Review Detail & Verdicts | `app/(internal)/review/[submissionId].tsx`, `ReviewDetailScreen.tsx` | Reviewer | todo | Worker SAFE/UNSAFE verdict sequence, mandatory unsafe reasons, notes, exit dialog |
| Reviewer History | `app/(internal)/history.tsx`, `ReviewHistoryScreen.tsx` | Reviewer | todo | Audited past reviews, image zoom overlays, filtering |
| Reviewer 3-Draft Limit Modal | `InProgressLimitModal.tsx` | Reviewer | todo | Modal dialog blocking 4th concurrent draft for same reviewer |
| Review Detail Exit Confirmation | `ReviewDetailScreen.tsx` | Reviewer | todo | Prevents accidental loss of uncommitted review progress |
| Image Zoom Overlay | `ReviewDetailScreen.tsx`, `ReviewHistoryScreen.tsx` | Reviewer | todo | Full-screen pinch/zoom inspection for worker PPE photos |
| Camera Permission & Retake States | `CaptureScreen.tsx`, `OthersCaptureScreen.tsx` | Vendor | todo | Permission request fallback, front/back retake triggers |

---

## State Coverage & Verification Rules

1. **Zero Database Changes**: No table schemas, RLS policies, migrations, or query flows were altered.
2. **Zero Route Additions**: No new tabs (no Alerts, Workers, Analytics, or Search screens) were introduced.
3. **No Unapproved Dependencies**: Uses only pre-installed Expo SDK 57 / React Native 0.86 modules (`expo-image`, `expo-symbols`, `react-native-reanimated`, `react-native-safe-area-context`).
4. **Dev Mode Isolation**: Fixture rows and test logins remain gated strictly by `isDemoMode` / `__DEV__`.
5. **Script-Safe Bengali**: Bengali labels utilize safe line-height calculations (`getLineHeight(fontSize, 'bn')`) preventing vowel-sign clipping.
