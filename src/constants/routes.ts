export const routes = {
  auth: {
    forgotPassword: '/forgot-password',
    login: '/login',
  },
  external: {
    capture: '/capture',
    history: '/history',
    home: '/',
    submissionReview: '/submission-review',
  },
  internal: {
    history: '/history',
    home: '/',
    reviewDetail: (submissionId: string) => `/review/${submissionId}`,
    reviews: '/reviews',
  },
  onboarding: {
    language: '/language',
  },
  profile: '/profile',
  settings: {
    about: '/settings/about',
    changePassword: '/settings/change-password',
    help: '/settings/help',
    home: '/settings',
    language: '/settings/language',
    notifications: '/settings/notifications',
    profile: '/settings/profile',
  },
} as const;
