export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      anonymous_sessions: {
        Row: {
          created_at: string
          expires_at: string
          last_seen_at: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          last_seen_at?: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          last_seen_at?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "anonymous_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          id: string
          items_version: number
          responses: Json
          scores: Json
          taken_at: string
          type: Database["public"]["Enums"]["assessment_type"]
          user_id: string
        }
        Insert: {
          id?: string
          items_version: number
          responses: Json
          scores: Json
          taken_at?: string
          type: Database["public"]["Enums"]["assessment_type"]
          user_id: string
        }
        Update: {
          id?: string
          items_version?: number
          responses?: Json
          scores?: Json
          taken_at?: string
          type?: Database["public"]["Enums"]["assessment_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      career_profile: {
        Row: {
          conversation_id: string | null
          created_at: string
          current_stage: string
          data: Json
          extraction_count: number
          id: string
          last_extracted_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          current_stage?: string
          data?: Json
          extraction_count?: number
          id?: string
          last_extracted_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          current_stage?: string
          data?: Json
          extraction_count?: number
          id?: string
          last_extracted_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_profile_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "career_profile_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_version: {
        Row: { id: number; updated_at: string; version: number }
        Insert: { id?: number; updated_at?: string; version?: number }
        Update: { id?: number; updated_at?: string; version?: number }
        Relationships: []
      }
      consents: {
        Row: {
          accepted_at: string
          id: string
          ip_address: unknown
          purpose: string
          revoked_at: string | null
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          ip_address?: unknown
          purpose: string
          revoked_at?: string | null
          user_agent?: string | null
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          id?: string
          ip_address?: unknown
          purpose?: string
          revoked_at?: string | null
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          message_count: number
          stage: string
          status: string
          title: string | null
          total_input_tokens: number
          total_output_tokens: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_count?: number
          stage?: string
          status?: string
          title?: string | null
          total_input_tokens?: number
          total_output_tokens?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_count?: number
          stage?: string
          status?: string
          title?: string | null
          total_input_tokens?: number
          total_output_tokens?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          cache_read_tokens: number | null
          cache_write_tokens: number | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          input_tokens: number | null
          output_tokens: number | null
          role: string
          safety_flag: string | null
        }
        Insert: {
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          role: string
          safety_flag?: string | null
        }
        Update: {
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          role?: string
          safety_flag?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      occupations: {
        Row: {
          big5_fit: Json | null
          constraints: Json
          created_at: string
          data_source: string
          description_he: string
          desired_skills: Json
          id: string
          last_verified_at: string
          market: Json
          required_skills: Json
          riasec_affinity: Json
          title_en: string
          title_he: string
          updated_at: string
          values_fit: string[]
        }
        Insert: {
          big5_fit?: Json | null
          constraints: Json
          created_at?: string
          data_source: string
          description_he: string
          desired_skills: Json
          id: string
          last_verified_at: string
          market: Json
          required_skills: Json
          riasec_affinity: Json
          title_en: string
          title_he: string
          updated_at?: string
          values_fit?: string[]
        }
        Update: {
          big5_fit?: Json | null
          constraints?: Json
          created_at?: string
          data_source?: string
          description_he?: string
          desired_skills?: Json
          id?: string
          last_verified_at?: string
          market?: Json
          required_skills?: Json
          riasec_affinity?: Json
          title_en?: string
          title_he?: string
          updated_at?: string
          values_fit?: string[]
        }
        Relationships: []
      }
      plan_tasks: {
        Row: {
          category: Database["public"]["Enums"]["plan_task_category"]
          created_at: string
          day: number
          description_he: string
          done: boolean
          done_at: string | null
          estimated_minutes: number
          id: string
          plan_id: string
          title_he: string
        }
        Insert: {
          category: Database["public"]["Enums"]["plan_task_category"]
          created_at?: string
          day: number
          description_he: string
          done?: boolean
          done_at?: string | null
          estimated_minutes: number
          id?: string
          plan_id: string
          title_he: string
        }
        Update: {
          category?: Database["public"]["Enums"]["plan_task_category"]
          created_at?: string
          day?: number
          description_he?: string
          done?: boolean
          done_at?: string | null
          estimated_minutes?: number
          id?: string
          plan_id?: string
          title_he?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_tasks_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          archetype: Database["public"]["Enums"]["plan_archetype"]
          generated_at: string
          id: string
          recommendation_id: string
          user_id: string
        }
        Insert: {
          archetype: Database["public"]["Enums"]["plan_archetype"]
          generated_at?: string
          id?: string
          recommendation_id: string
          user_id: string
        }
        Update: {
          archetype?: Database["public"]["Enums"]["plan_archetype"]
          generated_at?: string
          id?: string
          recommendation_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "recommendations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendations: {
        Row: {
          generated_at: string
          id: string
          paths: Json
          profile_hash: string
          prose: Json
          rankings: Json
          user_id: string
        }
        Insert: {
          generated_at?: string
          id?: string
          paths: Json
          profile_hash: string
          prose: Json
          rankings: Json
          user_id: string
        }
        Update: {
          generated_at?: string
          id?: string
          paths?: Json
          profile_hash?: string
          prose?: Json
          rankings?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          category: string
          created_at: string
          id: string
          name_he: string
          related_ids: string[]
        }
        Insert: {
          category: string
          created_at?: string
          id: string
          name_he: string
          related_ids?: string[]
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          name_he?: string
          related_ids?: string[]
        }
        Relationships: []
      }
      users: {
        Row: {
          age_range: string | null
          auth_id: string | null
          career_stage: string | null
          created_at: string
          current_status: string | null
          deleted_at: string | null
          deletion_requested_at: string | null
          display_name: string | null
          email: string | null
          id: string
          is_anonymous: boolean
          updated_at: string
        }
        Insert: {
          age_range?: string | null
          auth_id?: string | null
          career_stage?: string | null
          created_at?: string
          current_status?: string | null
          deleted_at?: string | null
          deletion_requested_at?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          is_anonymous?: boolean
          updated_at?: string
        }
        Update: {
          age_range?: string | null
          auth_id?: string | null
          career_stage?: string | null
          created_at?: string
          current_status?: string | null
          deleted_at?: string | null
          deletion_requested_at?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          is_anonymous?: boolean
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      increment_conversation_counters: {
        Args: {
          p_conversation_id: string
          p_input_tokens: number
          p_output_tokens: number
        }
        Returns: undefined
      }
      merge_career_profile: {
        Args: {
          p_conversation_id: string
          p_data: Json
          p_stage: string
          p_user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      assessment_type: "riasec" | "big5" | "values" | "constraints"
      plan_archetype: "apply" | "taste_test" | "research"
      plan_task_category: "action" | "research" | "network" | "reflection"
    }
    CompositeTypes: { [_ in never]: never }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends { Row: infer R }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends { Insert: infer I }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends { Update: infer U }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      assessment_type: ["riasec", "big5", "values", "constraints"],
      plan_archetype: ["apply", "taste_test", "research"],
      plan_task_category: ["action", "research", "network", "reflection"],
    },
  },
} as const
