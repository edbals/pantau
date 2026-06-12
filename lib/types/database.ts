// TypeScript types mirroring the Supabase schema.
// Keep in sync with supabase/migrations/ whenever the schema changes.

export type UserRole = 'owner' | 'project_manager' | 'koordinator' | 'pengawas'
export type ProjectType = 'residential' | 'commercial' | 'industrial' | 'mixed'
export type ProjectStatus = 'setup' | 'active' | 'on_hold' | 'completed' | 'archived'
export type UnitType =
  | 'house' | 'apartment' | 'shophouse' | 'commercial' | 'villa'
  | 'road' | 'common_area' | 'parking' | 'facility' | 'drainage' | 'boundary'
export type UnitStatus = 'not_started' | 'in_progress' | 'pending_review' | 'completed'
export type Urgency = 'normal' | 'high' | 'critical'
export type ReviewDecision = 'approved' | 'denied'
export type TemplateLevel = 'global' | 'org' | 'project'
export type ProjectMemberRole = 'project_manager' | 'koordinator' | 'pengawas'
export type ContactPlatform = 'whatsapp' | 'telegram'

export interface CanvasPosition {
  x: number        // 0-1 normalized
  y: number        // 0-1 normalized
  width: number    // 0-1 normalized
  height: number   // 0-1 normalized
  rotation: number // degrees
}

export interface SpkSubtask {
  subtask_number: number
  description: string
  requires_photo: boolean
}

export interface SpkStage {
  stage_number: number
  stage_name: string
  stage_code: string
  required_photo_count: number
  subtasks: SpkSubtask[]
}

// Row types (what comes back from SELECT)
export interface Organisation {
  id: string
  name: string
  slug: string
  created_at: string
  updated_at: string
}

export interface User {
  id: string
  org_id: string | null
  full_name: string
  phone: string | null
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  org_id: string
  project_code: string
  name: string
  project_type: ProjectType
  status: ProjectStatus
  site_plan_image_url: string | null
  canvas_data: unknown | null
  go_live_at: string | null
  created_at: string
  updated_at: string
}

export interface ProjectMember {
  id: string
  project_id: string
  user_id: string
  role: ProjectMemberRole
  created_at: string
}

export interface Subcontractor {
  id: string
  org_id: string
  name: string
  contact_phone: string | null
  color_hex: string
  created_at: string
  updated_at: string
}

export interface SpkTemplate {
  id: string
  name: string
  level: TemplateLevel
  org_id: string | null
  project_id: string | null
  cloned_from_id: string | null
  applicable_unit_types: UnitType[]
  stages: SpkStage[]
  total_stages: number
  total_subtasks: number
  is_archived: boolean
  created_at: string
  updated_at: string
}

export interface Unit {
  id: string
  project_id: string
  unit_code: string
  custom_label: string | null
  unit_type: UnitType
  canvas_position: CanvasPosition
  assigned_subcontractor_id: string | null
  assigned_supervisor_id: string | null
  urgency: Urgency
  spk_template_id: string | null
  progress_pct: number
  status: UnitStatus
  qr_code_url: string | null
  created_at: string
  updated_at: string
}

export interface Submission {
  id: string
  unit_id: string
  stage_number: number
  submitted_by: string
  subcontractor_id: string | null
  subtasks_checked: number[]
  notes: string | null
  submitted_at: string
  reviewed_by: string | null
  review_decision: ReviewDecision | null
  review_reason: string | null
  reviewed_at: string | null
  flagged_by: string | null
  flag_reason: string | null
  flagged_at: string | null
  created_at: string
  updated_at: string
}

export interface SubmissionPhoto {
  id: string
  submission_id: string
  r2_key: string
  public_url: string
  caption: string | null
  file_size_bytes: number | null
  taken_at: string | null
  created_at: string
}

export interface UnitAssignment {
  id: string
  unit_id: string
  user_id: string
  assigned_by: string
  created_at: string
}

export interface ProjectNotification {
  id: string
  project_id: string
  telegram_chat_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// Join row: which roster contacts are assigned to a given project.
export interface ProjectTeamMember {
  id: string
  project_id: string
  contact_id: string
  added_by: string | null
  created_at: string
}

// Global team roster (org-scoped). The map editor links units to these by id.
// `has_whatsapp`/`has_telegram` let one number be reachable on both apps;
// `custom_attributes` is an open bag for the future Notion-style data grid.
export interface Contact {
  id: string
  org_id: string
  name: string
  role: string
  email: string | null
  has_whatsapp: boolean
  has_telegram: boolean
  country_code: string
  phone: string
  custom_attributes: Record<string, unknown>
  created_by: string | null
  created_at: string
  updated_at: string
}

// Database type consumed by the Supabase client generic.
// Insert/Update types are defined explicitly to avoid circular references.
export type Database = {
  public: {
    Tables: {
      organisations: {
        Row: Organisation
        Insert: { name: string; slug: string }
        Update: { name?: string; slug?: string }
      }
      users: {
        Row: User
        Insert: {
          id: string
          org_id?: string | null
          full_name: string
          phone?: string | null
          role: UserRole
          is_active?: boolean
        }
        Update: {
          org_id?: string | null
          full_name?: string
          phone?: string | null
          role?: UserRole
          is_active?: boolean
        }
      }
      projects: {
        Row: Project
        Insert: {
          org_id: string
          project_code: string
          name: string
          project_type: ProjectType
          status?: ProjectStatus
          site_plan_image_url?: string | null
          canvas_data?: unknown | null
          go_live_at?: string | null
        }
        Update: {
          project_code?: string
          name?: string
          project_type?: ProjectType
          status?: ProjectStatus
          site_plan_image_url?: string | null
          canvas_data?: unknown | null
          go_live_at?: string | null
        }
      }
      project_members: {
        Row: ProjectMember
        Insert: { project_id: string; user_id: string; role: ProjectMemberRole }
        Update: { role?: ProjectMemberRole }
      }
      subcontractors: {
        Row: Subcontractor
        Insert: { org_id: string; name: string; contact_phone?: string | null; color_hex?: string }
        Update: { name?: string; contact_phone?: string | null; color_hex?: string }
      }
      spk_templates: {
        Row: SpkTemplate
        Insert: {
          name: string
          level: TemplateLevel
          org_id?: string | null
          project_id?: string | null
          cloned_from_id?: string | null
          applicable_unit_types: UnitType[]
          stages: SpkStage[]
          total_stages: number
          total_subtasks: number
          is_archived?: boolean
        }
        Update: {
          name?: string
          applicable_unit_types?: UnitType[]
          stages?: SpkStage[]
          total_stages?: number
          total_subtasks?: number
          is_archived?: boolean
        }
      }
      units: {
        Row: Unit
        Insert: {
          project_id: string
          unit_code: string
          custom_label?: string | null
          unit_type: UnitType
          canvas_position: CanvasPosition
          assigned_subcontractor_id?: string | null
          assigned_supervisor_id?: string | null
          urgency?: Urgency
          spk_template_id?: string | null
          progress_pct?: number
          status?: UnitStatus
          qr_code_url?: string | null
        }
        Update: {
          unit_code?: string
          custom_label?: string | null
          unit_type?: UnitType
          canvas_position?: CanvasPosition
          assigned_subcontractor_id?: string | null
          assigned_supervisor_id?: string | null
          urgency?: Urgency
          spk_template_id?: string | null
          progress_pct?: number
          status?: UnitStatus
          qr_code_url?: string | null
        }
      }
      submissions: {
        Row: Submission
        Insert: {
          unit_id: string
          stage_number: number
          submitted_by: string
          subcontractor_id?: string | null
          subtasks_checked?: number[]
          notes?: string | null
          submitted_at?: string
        }
        Update: {
          reviewed_by?: string | null
          review_decision?: ReviewDecision | null
          review_reason?: string | null
          reviewed_at?: string | null
          flagged_by?: string | null
          flag_reason?: string | null
          flagged_at?: string | null
        }
      }
      submission_photos: {
        Row: SubmissionPhoto
        Insert: {
          submission_id: string
          r2_key: string
          public_url: string
          caption?: string | null
          file_size_bytes?: number | null
          taken_at?: string | null
        }
        Update: { caption?: string | null }
      }
      unit_assignments: {
        Row: UnitAssignment
        Insert: { unit_id: string; user_id: string; assigned_by: string }
        Update: Record<never, never>
      }
      project_notifications: {
        Row: ProjectNotification
        Insert: { project_id: string; telegram_chat_id?: string | null; is_active?: boolean }
        Update: { telegram_chat_id?: string | null; is_active?: boolean }
      }
      contacts: {
        Row: Contact
        Insert: {
          org_id: string
          name: string
          role: string
          email?: string | null
          has_whatsapp?: boolean
          has_telegram?: boolean
          country_code?: string
          phone: string
          custom_attributes?: Record<string, unknown>
          created_by?: string | null
        }
        Update: {
          name?: string
          role?: string
          email?: string | null
          has_whatsapp?: boolean
          has_telegram?: boolean
          country_code?: string
          phone?: string
          custom_attributes?: Record<string, unknown>
        }
      }
      project_team_members: {
        Row: ProjectTeamMember
        Insert: { project_id: string; contact_id: string; added_by?: string | null }
        Update: Record<never, never>
      }
    }
    Functions: {
      compute_unit_progress: {
        Args: { p_unit_id: string }
        Returns: number
      }
      user_project_role: {
        Args: { p_project_id: string }
        Returns: string
      }
      current_user_org_id: {
        Args: Record<never, never>
        Returns: string
      }
      is_project_admin: {
        Args: { p_project_id: string }
        Returns: boolean
      }
    }
  }
}
