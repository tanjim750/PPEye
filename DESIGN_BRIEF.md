# PPEye Phase C Design Brief

This document serves as the **single visual source of truth** for Phase C and all subsequent development phases.
All business rules, database schemas, permission roles, and navigation flows remain strictly defined by `BUSINESS_FLOW.md`.

---

## 1. Product Frame & Hard Rules

1. **Visual & Interaction Pass Only**: No database changes, migrations, business logic alterations, route forks, or data-flow modifications.
2. **Style Reference, Not Feature Guide**: The reference design is a visual style guide for dark glassmorphism. Do **NOT** create new pages, tabs, or features (no Alerts, Workers, Analytics, or Search screens) and no invented metrics or fake numbers.
3. **No Unapproved Dependencies**: Zero new dependencies (no unapproved SVG, font, or blur libraries). All components operate within Expo SDK 57 / React Native 0.86 / New Architecture.
4. **Performance on Budget Devices**:
   - `FlatList` virtualization and row memoization are strictly preserved.
   - Animations operate exclusively on the UI thread via `react-native-reanimated` (animating `transform` and `opacity` only).
   - System reduced-motion preferences (`useReducedMotion()`) are honored globally.
5. **Real-Data Layouts & Dev Mode**:
   - Layouts are designed for real-world asynchronous states (0, 1, or many rows).
   - Demo fixtures and login shortcuts exist strictly behind `src/constants/devMode.ts` with a visible `DEMO` badge, never appearing in production builds.

---

## 2. Device Orientation Decision

- **Decision**: **Portrait Lock (`"orientation": "portrait"`)**
- **Rationale**:
  1. **Field Inspection Ergonomics**: PPE worker verification requires capturing head-to-toe vertical poses (Front and Back). Holding a device in portrait mode is mandatory for framing standing workers and operating the shutter single-handed on job sites.
  2. **Reviewer Checklist Layout**: The reviewer queue and inspection verification workflow (Front vs Back side-by-side or stacked, worker sequence navigation, checklist verdicts) are optimized for vertical thumb scrolling and bottom-sheet review forms.
  3. **Interface Predictability**: Landscape rotation on industrial phones introduces letterboxing on 19.5:9 and 20:9 screens, complicates camera preview aspect-ratio handling, and adds zero utility for field safety compliance.

---

## 3. Visual Language: Dark Premium Glassmorphism

- **Canvas & Background**:
  - Deep dark navy base canvas: `Palette.background = '#081326'` (never flat black `#000000`).
  - Subtle radial blue ambient glow at the top edge (`rgba(36, 115, 235, 0.13)` over 420px height) to provide spatial atmospheric depth.
- **Glass Cards (`GlassCard`)**:
  - Translucent dark blue tint: `Glass.tint = 'rgba(18, 39, 67, 0.86)'`.
  - 1px low-opacity border: `Glass.border = 'rgba(160, 197, 242, 0.16)'`.
  - Corner radius: `Radius.xl = 22` to `Radius.xxl = 28`.
  - Soft inner top highlight: 1px `borderTopColor: 'rgba(220, 239, 255, 0.11)'`.
  - Gentle elevation shadow: `Shadows.card` (`shadowColor: '#0F172A'`, radius 12, opacity 0.06).
  - **Glass without blur**: Pure tint + border + gradient/highlight layers. Operates at a silky 60fps on budget Android devices without GPU overdraw or list jank.
- **Hero Card (`GradientHeroCard`)**:
  - Deep blue tonal gradient stops (`['#143C72', '#1B5794']`).
  - Electric blue ambient accent glow layer: `Palette.heroGlow = 'rgba(78, 156, 255, 0.24)'`.
  - Corner radius: `Radius.xxl = 28`.
- **Primary & Interactive Accents**:
  - Electric Blue: `Palette.primary = '#4D9BFF'` / `Palette.primaryBorder = 'rgba(113, 177, 255, 0.38)'`.
  - Touch down states use `PressableScale` (scale 0.965 + light haptic feedback via `hapticLight()`).
- **Semantic Status Hierarchy**:
  - **Safe / Approved**: Soft green pill background (`#D1FAE5` / `rgba(42, 163, 102, 0.20)`), border `rgba(84, 214, 154, 0.32)`, dark green text (`#065F46`).
  - **Unsafe / Action Required**: Soft red pill background (`#FEE2E2` / `rgba(210, 61, 76, 0.20)`), border `rgba(255, 116, 123, 0.32)`, dark red text (`#7F1D1D`), accompanied by an inline reason line (`#FF747B`) describing the violation.
  - **Pending / In Progress / Review**: Soft amber pill background (`#FEF3C7` / `rgba(190, 130, 35, 0.20)`), border `rgba(245, 187, 85, 0.34)`, amber text (`#78350F` / `#FFD88D`).
  - **Neutral / Context**: Muted surface pill (`rgba(20, 40, 68, 0.70)`), secondary text (`#B5C5DA`).
- **Typography & Text Contrast**:
  - Headings: Bold crisp white (`#F2F7FF` / `#FFFFFF`).
  - Secondary/Supporting text: Muted blue-grey (`#B5C5DA` / `#8297B3`).
  - Micro copy: Subdued slate (`#667D9A`).

---

## 4. Typography & Bilingual Script Safety

- **Font Strategy**:
  - Native platform system fonts (`system-ui` on iOS, `Roboto/Noto` on Android) ensure native Bengali Unicode font fallback without bundling heavy custom TTF/OTF font assets.
- **Script-Safe Bengali Metrics**:
  - Bengali vowels (কার: ি, ী, ু, ূ, ৃ, ৌ) and conjuncts (ফলা / যুক্তাক্ষর) extend above and below the Latin x-height.
  - Standard Latin line-height causes vowel clipping at top or bottom boundaries.
  - Standardized formula: `getLineHeight(fontSize, language)`:
    - English: multiplier `1.38x`.
    - Bengali (`'bn'`): multiplier **`1.52x`** minimum, with zero fixed-height text wrappers.
- **Dynamic Font Scaling**:
  - Text containers wrap dynamically and avoid fixed heights to accommodate accessibility font size enlargement.

---

## 5. Responsive Layout Architecture

- **Breakpoints (`useResponsiveLayout`)**:
  - `compact`: `< 360px` (e.g., small Android devices, iPhone SE). Horizontal padding: 16px.
  - `regular`: `360px – 430px` (standard smartphones). Horizontal padding: 20px.
  - `large`: `> 430px` (large phones e.g., Pro Max, Plus, Note). Max width: 560px.
  - `tablet`: `> 600px` (tablets / foldables). Horizontal padding: 28px, Max width: 760px.
- **Safe Area Insets**:
  - All screens integrate `react-native-safe-area-context` to respect top notches, Dynamic Island, bottom home gesture indicators, and 3-button navigation bars.
- **Viewport Resilience**:
  - Forms and bottom sheets wrap in `KeyboardAvoidingView` with `ScrollView` so inputs remain visible above the soft keyboard.
  - Camera viewports support standard phone aspect ratios (16:9, 19.5:9, 20:9).

---

## 6. Shared Component Kit (`src/components/ui/GlassKit.tsx`)

1. **`GlassCard`**: Translucent tinted card with 1px border, soft top highlight, and subtle shadow.
2. **`GradientHeroCard`**: Deep blue layered card with glow accent for summaries.
3. **`MetricTile`**: Metric display card with label, prominent number, and supporting detail.
4. **`ProgressRing`**: High-performance SVG-free progress ring with Reanimated rotation.
5. **`StatusPill`**: Semantic status pill with soft background, high-contrast dark text, and optional unsafe reason line.
6. **`Avatar`**: Electric blue bordered avatar ring with support for remote image or fallback initials.
7. **`IconTile`**: Electric blue tinted icon tile for quick actions.
8. **`PressableScale`**: Interactive wrapper with scale transform, slight opacity dip, and light haptics.
9. **`SectionHeader`**: Clean section header with bold title and optional action element.
10. **`Skeleton`**: Shimmering placeholder box for loading states.
11. **`EmptyState`**: Centered glass card for empty collection states.
12. **`ErrorState`**: Error banner with warning icon, message, and retry button.
13. **`Toast`**: Floating notification feedback banner with semantic color tones.
14. **`GlassTabBar`**: Floating glass tab bar wired dynamically to role-specific routes.
15. **`AppHeader`**: Standardized top navigation bar with back button and centered title.
16. **`PrimaryButton`**: Electric blue call-to-action button with loading spinner and disabled state.
17. **`SecondaryButton`**: Bordered translucent glass button with loading spinner.
18. **`SegmentedControl`**: Animated pill selector with Reanimated spring indicator.
19. **`OfflineBanner`**: Amber alert strip indicating offline or cached information.

---

## 7. Shared Screens Redesign Pass (Phase C)

- **Launch / Route Resolution**:
  - Initial background set to `#081326` with top radial glow in `RootLayout`.
  - `SplashScreen.preventAutoHideAsync()` guarantees zero white screen flashing on startup.
  - Auth session hydration routes directly to `/(external)` or `/(internal)`, eliminating wrong-screen frame flicker.
- **Language Selection (`LanguageScreen`)**:
  - Shared between onboarding (`app/(onboarding)/language.tsx`) and settings (`app/settings/language.tsx`).
  - Translucent radio cards with checkmarks and script-safe typography.
- **Sign In (`LoginScreen`)**:
  - Dark glass card with electric blue active focus borders.
  - Reanimated horizontal shake on authentication error.
  - Dev demo credentials shortcut preserved under `isLoginTestMode`.
- **Forgot Password (`ForgotPasswordScreen`)**:
  - Dark glass layout with email validation and recovery feedback.
- **Settings Screen (`SettingsScreen`)**:
  - **Full-Width Bug & Right Strip FIXED**: Eliminated conflicting light background NativeWind class (`bg-[#f9f9ff]`), aligned `SafeAreaView` and viewport shell to solid `Palette.background` (`#081326`), ensuring content stretches to full available width with zero light strip showing on the right.
  - Glass account card, animated language switch, and dev-only preview entry.
- **Profile Screen (`ProfileScreen`)**:
  - Avatar ring with photo upload picker and fallback initials badge.
- **Change Password (`ChangePasswordScreen`)**:
  - Form validation, visibility toggles, and Supabase Auth password update.
- **Add User (`AddUserScreen`)**:
  - Animated internal/external segmented selector, role pills, and explicit notice that Supabase Auth credentials must be provisioned via admin dashboard.
- **Notifications Screen (`NotificationsScreen`)**:
  - Dark switch tracks with review and account notification preferences.
- **Help and Support (`HelpSupportScreen`)**:
  - Search bar, phone/email contact tiles, and filterable help topics.
- **About (`AboutScreen`)**:
  - Glowing logo frame, version pills, and technical specification cards.

---

## 8. Development-Only Component Preview

- **Access**: Located inside the `Settings` screen, strictly wrapped inside `{__DEV__ ? ... : null}`.
- **Coverage**: Showcases all 19 components in loading, empty, error, long English text, and complex Bengali script states.
- **Exclusion**: Completely eliminated from production release bundles.
