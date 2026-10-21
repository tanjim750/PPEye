/**
 * PPEye Submission Coordination Layer
 *
 * Coordinates image compression, Supabase Storage uploads, database metadata persistence,
 * relational entity-file linking, compensating cleanups, and replacement workflows.
 *
 * Strictly isolated from Google Drive.
 */

export * from './coordination.types';
export * from './submission-coordinator';
