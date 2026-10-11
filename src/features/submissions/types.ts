export type SubmissionStatus = 'draft' | 'submitted' | 'in_review' | 'approved' | 'rejected';

export type Submission = {
  createdAt: string;
  id: string;
  imageUri?: string;
  notes?: string;
  status: SubmissionStatus;
  vendorId?: string;
};
