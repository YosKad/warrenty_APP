/**
 * Database types.
 *
 * Hand-written to mirror `supabase/migrations`. Regenerate with:
 *   supabase gen types typescript --local > src/types/database.ts
 * once a local stack is running; until then this file is the contract and must be
 * updated alongside any migration. Only the tables, views and functions the mobile
 * app actually touches are modelled — service-role-only tables are intentionally
 * absent so no client code can accidentally reference them.
 */

export type PlanIdDb = 'free' | 'plus' | 'pro';

export type SubscriptionStatusDb =
  | 'active'
  | 'in_trial'
  | 'in_grace_period'
  | 'in_billing_retry'
  | 'expired'
  | 'revoked'
  | 'none';

export type WarrantyStatusDb = 'active' | 'ending_soon' | 'expired' | 'unknown';

export type WarrantySourceDb =
  | 'user_entered'
  | 'manufacturer'
  | 'retailer'
  | 'internal_db'
  | 'document_extraction'
  | 'ai_inferred';

export type ProductLifecycleDb =
  | 'active'
  | 'claim_open'
  | 'repair_in_progress'
  | 'replaced'
  | 'sold'
  | 'disposed';

export type DocumentKindDb =
  | 'receipt'
  | 'invoice'
  | 'warranty_certificate'
  | 'service_document'
  | 'product_photo'
  | 'other';

export type ClaimStatusDb =
  | 'draft'
  | 'analysing'
  | 'ready_to_contact'
  | 'submitted'
  | 'in_progress'
  | 'resolved'
  | 'rejected'
  | 'cancelled';

export type NotificationKindDb =
  | 'warranty_expiring'
  | 'warranty_expired'
  | 'claim_update'
  | 'document_ready'
  | 'subscription';

export type CoverageVerdictDb =
  | 'likely_covered'
  | 'possibly_covered'
  | 'likely_not_covered'
  | 'insufficient_information';

export type ConfidenceLevelDb = 'high' | 'medium' | 'low';

export type VerificationStateDb =
  | 'unverified'
  | 'ai_extracted'
  | 'community_submitted'
  | 'verified'
  | 'official';

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

type ProductRow = {
  id: string;
  workspace_id: string;
  owner_id: string;
  name: string;
  category_id: string;
  brand_id: string | null;
  brand_name: string | null;
  model: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  currency: string | null;
  retailer_id: string | null;
  retailer_name: string | null;
  country_code: string;
  warranty_start: string | null;
  warranty_end: string | null;
  warranty_duration_months: number | null;
  extension_months: number;
  warranty_source: WarrantySourceDb;
  warranty_id: string | null;
  warranty_provider_id: string | null;
  service_provider_id: string | null;
  importer_id: string | null;
  warranty_verified_by_user: boolean;
  image_path: string | null;
  notes: string | null;
  lifecycle: ProductLifecycleDb;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type ProductInsert = Omit<
  ProductRow,
  'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'extension_months' | 'importer_id'
> & {
  importer_id?: string | null;
  id?: string;
  extension_months?: number;
};

export type Database = {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string;
          display_name: string | null;
          email: string;
          country_code: string;
          region: string | null;
          preferred_language: string;
          time_zone: string;
          preferred_currency: string;
          marketing_opt_in: boolean;
          analytics_opt_in: boolean;
          biometric_lock: boolean;
          onboarding_completed_at: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Record<string, never>;
        Update: Partial<{
          display_name: string | null;
          country_code: string;
          region: string | null;
          preferred_language: string;
          time_zone: string;
          preferred_currency: string;
          marketing_opt_in: boolean;
          analytics_opt_in: boolean;
          biometric_lock: boolean;
          onboarding_completed_at: string | null;
        }>;
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          kind: 'personal' | 'family' | 'business';
          name: string;
          owner_id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Record<string, never>;
        Update: Partial<{ name: string }>;
        Relationships: [];
      };
      products: {
        Row: ProductRow;
        Insert: ProductInsert;
        Update: Partial<Omit<ProductInsert, 'owner_id' | 'workspace_id'>>;
        Relationships: [
          {
            foreignKeyName: 'products_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_retailer_id_fkey';
            columns: ['retailer_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_warranty_provider_id_fkey';
            columns: ['warranty_provider_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_service_provider_id_fkey';
            columns: ['service_provider_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'product_categories';
            referencedColumns: ['id'];
          },
        ];
      };
      product_documents: {
        Row: {
          id: string;
          product_id: string;
          owner_id: string;
          kind: DocumentKindDb;
          storage_path: string;
          file_name: string;
          mime_type: string;
          byte_size: number;
          content_hash: string | null;
          page_count: number | null;
          extracted_text: string | null;
          extracted_at: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          product_id: string;
          owner_id: string;
          kind: DocumentKindDb;
          storage_path: string;
          file_name: string;
          mime_type: string;
          byte_size: number;
          content_hash?: string | null;
          page_count?: number | null;
        };
        Update: Partial<{ kind: DocumentKindDb; file_name: string; deleted_at: string | null }>;
        Relationships: [];
      };
      product_categories: {
        Row: {
          id: string;
          slug: string;
          labels: Record<string, string>;
          parent_id: string | null;
          icon: string | null;
          sort_order: number;
          typical_warranty_months: number | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      organisations: {
        Row: {
          id: string;
          slug: string;
          name: string;
          legal_name: string | null;
          roles: string[];
          country_code: string | null;
          website: string | null;
          support_phone: string | null;
          support_email: string | null;
          logo_url: string | null;
          serviced_brand_ids: string[];
          serviced_category_ids: string[];
          parent_id: string | null;
          is_verified: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      service_locations: {
        Row: {
          id: string;
          organisation_id: string;
          name: string | null;
          country_code: string;
          region: string | null;
          city: string | null;
          address_line: string | null;
          postal_code: string | null;
          phone: string | null;
          email: string | null;
          latitude: number | null;
          longitude: number | null;
          opening_hours: Json | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      warranties: {
        Row: {
          id: string;
          brand_id: string | null;
          category_id: string | null;
          model_pattern: string | null;
          country_code: string | null;
          duration_months: number | null;
          parts_months: number | null;
          labour_months: number | null;
          coverage_summary: string | null;
          exclusions_summary: string | null;
          special_conditions_summary: string | null;
          warranty_provider_id: string | null;
          importer_id: string | null;
          retailer_id: string | null;
          serial_patterns: string[];
          policy_version: string | null;
          last_checked_at: string | null;
          source_id: string | null;
          valid_from: string | null;
          valid_to: string | null;
          verified_at: string | null;
          verification: VerificationStateDb;
          confidence: ConfidenceLevelDb;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: 'warranties_warranty_provider_id_fkey';
            columns: ['warranty_provider_id'];
            isOneToOne: false;
            referencedRelation: 'organisations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'warranties_source_id_fkey';
            columns: ['source_id'];
            isOneToOne: false;
            referencedRelation: 'warranty_sources';
            referencedColumns: ['id'];
          },
        ];
      };
      warranty_sources: {
        Row: {
          id: string;
          kind: WarrantySourceDb;
          organisation_id: string | null;
          source_url: string | null;
          document_title: string | null;
          document_version: string | null;
          content_hash: string | null;
          country_code: string | null;
          language: string;
          retrieved_at: string | null;
          last_verified_at: string | null;
          verified_by: string | null;
          verification: VerificationStateDb;
          notes: string | null;
          document_id: string | null;
          effective_from: string | null;
          effective_to: string | null;
          page_count: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      warranty_terms: {
        Row: {
          id: string;
          warranty_id: string;
          section: string | null;
          ordinal: number;
          clause_text: string;
          clause_type: string;
          coverage_categories: string[];
          language: string;
          title: string | null;
          summary: string | null;
          source_section: string | null;
          source_page: number | null;
          confidence: ConfidenceLevelDb;
          verification: VerificationStateDb;
          extraction_version: string | null;
          extracted_by: string | null;
          extracted_at: string | null;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      product_warranty_matches: {
        Row: {
          id: string;
          product_id: string;
          owner_id: string;
          warranty_id: string | null;
          match_score: number;
          match_state: string;
          signals: Json;
          has_conflict: boolean;
          conflict_summary: Json;
          candidate_ids: string[];
          resolved_at: string;
          source_checked_at: string | null;
          resolver_version: string;
          created_at: string;
          updated_at: string;
        };
        // Written by the warranty-resolve function only; RLS grants the client
        // SELECT and nothing else, so there is no Insert/Update shape here.
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: 'product_warranty_matches_warranty_id_fkey';
            columns: ['warranty_id'];
            isOneToOne: false;
            referencedRelation: 'warranties';
            referencedColumns: ['id'];
          },
        ];
      };
      product_warranty_overrides: {
        Row: {
          id: string;
          product_id: string;
          owner_id: string;
          field: string;
          value: Json;
          previous_value: Json | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          owner_id: string;
          field: string;
          value: Json;
          previous_value?: Json | null;
          reason?: string | null;
        };
        Update: {
          value?: Json;
          reason?: string | null;
        };
        Relationships: [];
      };
      claims: {
        Row: {
          id: string;
          product_id: string;
          owner_id: string;
          status: ClaimStatusDb;
          issue_description: string;
          issue_category: string | null;
          snapshot: Json;
          service_provider_id: string | null;
          service_location_id: string | null;
          reference_number: string | null;
          resolution_notes: string | null;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          product_id: string;
          owner_id: string;
          issue_description: string;
          issue_category?: string | null;
          status?: ClaimStatusDb;
        };
        Update: Partial<{
          status: ClaimStatusDb;
          issue_description: string;
          issue_category: string | null;
          service_provider_id: string | null;
          service_location_id: string | null;
          reference_number: string | null;
          resolution_notes: string | null;
          resolved_at: string | null;
          deleted_at: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: 'claims_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      claim_messages: {
        Row: {
          id: string;
          claim_id: string;
          owner_id: string;
          author: 'user' | 'system' | 'provider';
          body: string;
          attachments: string[];
          created_at: string;
        };
        Insert: {
          claim_id: string;
          owner_id: string;
          author: 'user';
          body: string;
          attachments?: string[];
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      ai_analyses: {
        Row: {
          id: string;
          owner_id: string;
          product_id: string;
          claim_id: string | null;
          verdict: CoverageVerdictDb;
          confidence: number;
          summary: string;
          reasoning_summary: string | null;
          recommended_action: string | null;
          exclusions: string[];
          warranty_id: string | null;
          retrieved_term_ids: string[];
          document_version: string | null;
          model_version: string;
          prompt_version: string;
          input_tokens: number | null;
          output_tokens: number | null;
          latency_ms: number | null;
          grounded_in_documents: boolean;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      ocr_jobs: {
        Row: {
          id: string;
          owner_id: string;
          document_id: string | null;
          status: 'queued' | 'processing' | 'succeeded' | 'failed';
          provider: string;
          fields: Json;
          error_code: string | null;
          attempts: number;
          started_at: string | null;
          finished_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          owner_id: string;
          product_id: string | null;
          claim_id: string | null;
          kind: NotificationKindDb;
          title_key: string;
          body_key: string;
          params: Record<string, string | number>;
          scheduled_for: string;
          sent_at: string | null;
          read_at: string | null;
          delivery: 'pending' | 'sent' | 'failed' | 'suppressed';
          failure_reason: string | null;
          idempotency_key: string;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Partial<{ read_at: string | null }>;
        Relationships: [];
      };
      user_notification_settings: {
        Row: {
          user_id: string;
          push_enabled: boolean;
          email_enabled: boolean;
          expiry_offsets_days: number[];
          preferred_hour_local: number;
          quiet_hours_start: number;
          quiet_hours_end: number;
          created_at: string;
          updated_at: string;
        };
        Insert: { user_id: string };
        Update: Partial<{
          push_enabled: boolean;
          email_enabled: boolean;
          expiry_offsets_days: number[];
          preferred_hour_local: number;
          quiet_hours_start: number;
          quiet_hours_end: number;
        }>;
        Relationships: [];
      };
      user_devices: {
        Row: {
          id: string;
          user_id: string;
          push_token: string;
          platform: 'ios' | 'android';
          app_version: string | null;
          locale: string | null;
          time_zone: string | null;
          last_seen_at: string;
          created_at: string;
          revoked_at: string | null;
        };
        Insert: {
          user_id: string;
          push_token: string;
          platform: 'ios' | 'android';
          app_version?: string | null;
          locale?: string | null;
          time_zone?: string | null;
        };
        Update: Partial<{ revoked_at: string | null; last_seen_at: string }>;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          user_id: string;
          plan: PlanIdDb;
          status: SubscriptionStatusDb;
          provider: 'apple' | 'google' | null;
          store_product_id: string | null;
          original_transaction_id: string | null;
          latest_transaction_id: string | null;
          started_at: string | null;
          current_period_start: string | null;
          expires_at: string | null;
          auto_renew: boolean;
          cancelled_at: string | null;
          grace_period_expires_at: string | null;
          is_trial: boolean;
          environment: 'sandbox' | 'production';
          last_verified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      feature_flags: {
        Row: {
          key: string;
          description: string | null;
          enabled: boolean;
          rollout_percent: number;
          plans: PlanIdDb[] | null;
          min_app_version: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: {
      product_warranty_overview: {
        Row: {
          id: string;
          owner_id: string;
          workspace_id: string;
          name: string;
          model: string | null;
          brand_id: string | null;
          brand_display_name: string | null;
          category_id: string;
          category_slug: string | null;
          purchase_date: string | null;
          image_path: string | null;
          lifecycle: ProductLifecycleDb;
          warranty_source: WarrantySourceDb;
          warranty_verified_by_user: boolean;
          effective_warranty_end: string | null;
          status: WarrantyStatusDb;
          days_remaining: number | null;
          created_at: string;
          updated_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      get_warranty_summary: {
        Args: Record<string, never>;
        Returns: {
          active_count: number;
          ending_soon_count: number;
          expired_count: number;
          unknown_count: number;
          total_count: number;
          next_expiry_product_id: string | null;
          next_expiry_date: string | null;
        }[];
        Relationships: [];
      };
      get_product_quota: {
        Args: Record<string, never>;
        Returns: {
          plan: PlanIdDb;
          product_limit: number | null;
          current_count: number;
          can_add: boolean;
        }[];
        Relationships: [];
      };
      soft_delete_product: {
        Args: { p_product_id: string };
        Returns: undefined;
        Relationships: [];
      };
      match_warranty_policies: {
        Args: { p_product_id: string };
        Returns: {
          warranty_id: string;
          duration_months: number | null;
          verification: VerificationStateDb;
          confidence: ConfidenceLevelDb;
          source_kind: WarrantySourceDb;
          provider_id: string | null;
          policy_version: string | null;
          valid_from: string | null;
          valid_to: string | null;
          matched_brand: boolean;
          matched_model: boolean;
          matched_category: boolean;
          matched_country: boolean;
          matched_importer: boolean;
          matched_retailer: boolean;
          matched_serial: boolean;
          within_validity: boolean;
        }[];
        Relationships: [];
      };
      get_warranty_clauses: {
        Args: { p_warranty_id: string };
        Returns: {
          id: string;
          clause_type: string;
          title: string | null;
          summary: string | null;
          clause_text: string;
          section: string | null;
          source_section: string | null;
          source_page: number | null;
          coverage_categories: string[];
          confidence: ConfidenceLevelDb;
          verification: VerificationStateDb;
          ordinal: number;
        }[];
        Relationships: [];
      };
      product_protection_completeness: {
        Args: { p_product_id: string };
        Returns: { score: number; gaps: string[] }[];
        Relationships: [];
      };
    };
    Enums: {
      plan_id: PlanIdDb;
      warranty_status: WarrantyStatusDb;
      product_lifecycle: ProductLifecycleDb;
    };
    CompositeTypes: Record<string, never>;
  };
};
