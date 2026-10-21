/**
 * PPEye Supabase Database Service
 *
 * Standalone, schema-typed PostgreSQL data-access layer.
 * Manages all queries, mutations, file metadata persistence, and foreign key relationships.
 * Independent of binary storage or Google Drive.
 */

export * from './database.types';
export * from './database.errors';
export * from './client';

export { FilesRepository } from './repositories/files.repository';
export { SubmissionsRepository } from './repositories/submissions.repository';
export { ImageLinksRepository } from './repositories/image-links.repository';
export { ReviewsRepository } from './repositories/reviews.repository';

import { FilesRepository } from './repositories/files.repository';
import { SubmissionsRepository } from './repositories/submissions.repository';
import { ImageLinksRepository } from './repositories/image-links.repository';
import { ReviewsRepository } from './repositories/reviews.repository';

export const filesRepository = new FilesRepository();
export const submissionsRepository = new SubmissionsRepository();
export const imageLinksRepository = new ImageLinksRepository();
export const reviewsRepository = new ReviewsRepository();

export const supabaseDatabaseService = {
  files: filesRepository,
  submissions: submissionsRepository,
  imageLinks: imageLinksRepository,
  reviews: reviewsRepository,
};

export default supabaseDatabaseService;
