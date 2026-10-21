export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserCategory = 'INTERNAL' | 'EXTERNAL';
export type ExternalUserType = 'PROJECT_MANAGER' | 'TEAM_LEADER' | 'WORKER';
export type SubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'COMPLETED';
export type ImageSide = 'FRONT' | 'BACK';
export type SafetyVerdict = 'SAFE' | 'UNSAFE';
export type StorageProvider = 'GOOGLE_DRIVE' | 'SUPABASE';

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: number;
          name: string;
          phone: string;
          email: string | null;
          category: UserCategory;
          designation: string | null;
          external_type: ExternalUserType | null;
          profile_picture_file_id: number | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          name: string;
          phone: string;
          email?: string | null;
          category: UserCategory;
          designation?: string | null;
          external_type?: ExternalUserType | null;
          profile_picture_file_id?: number | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          name?: string;
          phone?: string;
          email?: string | null;
          category?: UserCategory;
          designation?: string | null;
          external_type?: ExternalUserType | null;
          profile_picture_file_id?: number | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      files: {
        Row: {
          id: number;
          storage_provider: StorageProvider;
          provider_file_id: string;
          file_name: string;
          mime_type: string | null;
          size_bytes: number | null;
          created_by: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          storage_provider?: StorageProvider;
          provider_file_id: string;
          file_name: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          created_by?: number | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          storage_provider?: StorageProvider;
          provider_file_id?: string;
          file_name?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          created_by?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      vendor_profiles: {
        Row: {
          id: number;
          vendor_name: string;
          project_name: string;
          created_by: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          vendor_name: string;
          project_name: string;
          created_by: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          vendor_name?: string;
          project_name?: string;
          created_by?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      vendor_members: {
        Row: {
          id: number;
          vendor_profile_id: number;
          user_id: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          vendor_profile_id: number;
          user_id: number;
          created_at?: string;
        };
        Update: {
          id?: number;
          vendor_profile_id?: number;
          user_id?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      ppe_submissions: {
        Row: {
          id: number;
          vendor_profile_id: number;
          submitted_by: number;
          site_name: string;
          metadata: Json;
          status: SubmissionStatus;
          submitted_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          vendor_profile_id: number;
          submitted_by: number;
          site_name: string;
          metadata?: Json;
          status?: SubmissionStatus;
          submitted_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          vendor_profile_id?: number;
          submitted_by?: number;
          site_name?: string;
          metadata?: Json;
          status?: SubmissionStatus;
          submitted_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ppe_worker_instances: {
        Row: {
          id: number;
          submission_id: number;
          sequence_no: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          submission_id: number;
          sequence_no: number;
          created_at?: string;
        };
        Update: {
          id?: number;
          submission_id?: number;
          sequence_no?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      ppe_images: {
        Row: {
          id: number;
          worker_instance_id: number;
          file_id: number;
          side: ImageSide;
          created_at: string;
        };
        Insert: {
          id?: number;
          worker_instance_id: number;
          file_id: number;
          side: ImageSide;
          created_at?: string;
        };
        Update: {
          id?: number;
          worker_instance_id?: number;
          file_id?: number;
          side?: ImageSide;
          created_at?: string;
        };
        Relationships: [];
      };
      other_images: {
        Row: {
          id: number;
          submission_id: number;
          file_id: number;
          sequence_no: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          submission_id: number;
          file_id: number;
          sequence_no?: number | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          submission_id?: number;
          file_id?: number;
          sequence_no?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      ppe_reviews: {
        Row: {
          id: number;
          worker_instance_id: number;
          reviewer_id: number;
          verdict: SafetyVerdict;
          reviewed_at: string;
        };
        Insert: {
          id?: number;
          worker_instance_id: number;
          reviewer_id: number;
          verdict: SafetyVerdict;
          reviewed_at?: string;
        };
        Update: {
          id?: number;
          worker_instance_id?: number;
          reviewer_id?: number;
          verdict?: SafetyVerdict;
          reviewed_at?: string;
        };
        Relationships: [];
      };
      unsafe_reasons: {
        Row: {
          id: number;
          code: string;
          label: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: number;
          code: string;
          label: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: number;
          code?: string;
          label?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      ppe_review_reasons: {
        Row: {
          id: number;
          ppe_review_id: number;
          unsafe_reason_id: number;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          ppe_review_id: number;
          unsafe_reason_id: number;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          ppe_review_id?: number;
          unsafe_reason_id?: number;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      other_reviews: {
        Row: {
          id: number;
          submission_id: number;
          reviewer_id: number;
          verdict: SafetyVerdict;
          reason: string | null;
          reviewed_at: string;
        };
        Insert: {
          id?: number;
          submission_id: number;
          reviewer_id: number;
          verdict: SafetyVerdict;
          reason?: string | null;
          reviewed_at?: string;
        };
        Update: {
          id?: number;
          submission_id?: number;
          reviewer_id?: number;
          verdict?: SafetyVerdict;
          reason?: string | null;
          reviewed_at?: string;
        };
        Relationships: [];
      };
      submission_reviews: {
        Row: {
          id: number;
          submission_id: number;
          reviewer_id: number;
          verdict: SafetyVerdict;
          reason: string | null;
          reviewed_at: string;
        };
        Insert: {
          id?: number;
          submission_id: number;
          reviewer_id: number;
          verdict: SafetyVerdict;
          reason?: string | null;
          reviewed_at?: string;
        };
        Update: {
          id?: number;
          submission_id?: number;
          reviewer_id?: number;
          verdict?: SafetyVerdict;
          reason?: string | null;
          reviewed_at?: string;
        };
        Relationships: [];
      };
      storage_operations_log: {
        Row: {
          id: number;
          operation: string;
          bucket: string;
          file_path: string;
          file_size_bytes: number | null;
          mime_type: string | null;
          performed_by: number | null;
          status: string;
          error_message: string | null;
          metadata: Record<string, any>;
          created_at: string;
        };
        Insert: {
          id?: number;
          operation: string;
          bucket: string;
          file_path: string;
          file_size_bytes?: number | null;
          mime_type?: string | null;
          performed_by?: number | null;
          status?: string;
          error_message?: string | null;
          metadata?: Record<string, any>;
          created_at?: string;
        };
        Update: {
          id?: number;
          operation?: string;
          bucket?: string;
          file_path?: string;
          file_size_bytes?: number | null;
          mime_type?: string | null;
          performed_by?: number | null;
          status?: string;
          error_message?: string | null;
          metadata?: Record<string, any>;
          created_at?: string;
        };
        Relationships: [];
      };
      database_service_logs: {
        Row: {
          id: number;
          action: string;
          entity_type: string;
          entity_id: string | null;
          performed_by: number | null;
          status: string;
          payload: Record<string, any>;
          error_details: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          performed_by?: number | null;
          status?: string;
          payload?: Record<string, any>;
          error_details?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          action?: string;
          entity_type?: string;
          entity_id?: string | null;
          performed_by?: number | null;
          status?: string;
          payload?: Record<string, any>;
          error_details?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      user_category: UserCategory;
      external_user_type: ExternalUserType;
      submission_status: SubmissionStatus;
      image_side: ImageSide;
      safety_verdict: SafetyVerdict;
      storage_provider: StorageProvider;
    };
    CompositeTypes: Record<string, never>;
  };
}
