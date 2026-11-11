
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "admission_summaries": {
                  Row: {
                    "admission_id": string,"clinic_id": string,"id": string | null,"patient_id": string,"summary": string,"updated_at": string,"written_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admission_id": string,"clinic_id": string,"id"?: never,"patient_id": string,"summary": string,"updated_at"?: string,"written_by": string
                  }
                  Update: {
                    "admission_id"?: string,"clinic_id"?: string,"id"?: never,"patient_id"?: string,"summary"?: string,"updated_at"?: string,"written_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "admission_summaries_admission_id_clinic_id_patient_id_fkey"
      columns: ["admission_id","clinic_id","patient_id"]
isOneToOne: false
      referencedRelation: "admissions"
      referencedColumns: ["id","clinic_id","patient_id"]
    },{
      foreignKeyName: "admission_summaries_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "admission_summaries_written_by_fkey"
      columns: ["written_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },
            "admissions": {
                  Row: {
                    "admission_type": string,"admitted_at": string | null,"attending_id": string,"cancelled_reason": string | null,"clinic_id": string,"created_at": string,"deposit_reference": string | null,"discharge_authorised_at": string | null,"discharge_authorised_by": string | null,"discharged_at": string | null,"discharged_by": string | null,"expected_discharge_on": string | null,"id": string,"patient_id": string,"reason": string,"requested_at": string,"requested_by": string | null,"row_version": number,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admission_type": string,"admitted_at"?: string | null,"attending_id": string,"cancelled_reason"?: string | null,"clinic_id": string,"created_at"?: string,"deposit_reference"?: string | null,"discharge_authorised_at"?: string | null,"discharge_authorised_by"?: string | null,"discharged_at"?: string | null,"discharged_by"?: string | null,"expected_discharge_on"?: string | null,"id"?: string,"patient_id": string,"reason": string,"requested_at"?: string,"requested_by"?: string | null,"row_version"?: number,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "admission_type"?: string,"admitted_at"?: string | null,"attending_id"?: string,"cancelled_reason"?: string | null,"clinic_id"?: string,"created_at"?: string,"deposit_reference"?: string | null,"discharge_authorised_at"?: string | null,"discharge_authorised_by"?: string | null,"discharged_at"?: string | null,"discharged_by"?: string | null,"expected_discharge_on"?: string | null,"id"?: string,"patient_id"?: string,"reason"?: string,"requested_at"?: string,"requested_by"?: string | null,"row_version"?: number,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "admissions_attending_id_clinic_id_fkey"
      columns: ["attending_id","clinic_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "admissions_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "admissions_discharge_authorised_by_fkey"
      columns: ["discharge_authorised_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "admissions_discharged_by_fkey"
      columns: ["discharged_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "admissions_patient_id_clinic_id_fkey"
      columns: ["patient_id","clinic_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "admissions_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },
            "appointments": {
                  Row: {
                    "cancelled_reason": string | null,"checked_in_at": string | null,"checked_in_by": string | null,"clinic_id": string,"completed_at": string | null,"created_at": string,"created_by": string | null,"doctor_id": string,"ends_at": string,"id": string,"patient_id": string,"reason": string | null,"room_id": string | null,"roomed_at": string | null,"starts_at": string,"status": Database["public"]['Enums']["appointment_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_reason"?: string | null,"checked_in_at"?: string | null,"checked_in_by"?: string | null,"clinic_id": string,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"doctor_id": string,"ends_at": string,"id"?: string,"patient_id": string,"reason"?: string | null,"room_id"?: string | null,"roomed_at"?: string | null,"starts_at": string,"status"?: Database["public"]['Enums']["appointment_status"],"updated_at"?: string
                  }
                  Update: {
                    "cancelled_reason"?: string | null,"checked_in_at"?: string | null,"checked_in_by"?: string | null,"clinic_id"?: string,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"doctor_id"?: string,"ends_at"?: string,"id"?: string,"patient_id"?: string,"reason"?: string | null,"room_id"?: string | null,"roomed_at"?: string | null,"starts_at"?: string,"status"?: Database["public"]['Enums']["appointment_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointments_checked_in_by_fkey"
      columns: ["checked_in_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_doctor_id_clinic_id_fkey"
      columns: ["doctor_id","clinic_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "appointments_patient_id_clinic_id_fkey"
      columns: ["patient_id","clinic_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "appointments_room_id_clinic_id_fkey"
      columns: ["room_id","clinic_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id","clinic_id"]
    }
                  ]
                },
            "audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_role": Database["public"]['Enums']["app_role"] | null,"changed_fields": (string)[] | null,"clinic_id": string,"id": number,"occurred_at": string,"patient_id": string | null,"reason": string | null,"record_id": string | null,"table_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_role"?: Database["public"]['Enums']["app_role"] | null,"changed_fields"?: (string)[] | null,"clinic_id": string,"id"?: never,"occurred_at"?: string,"patient_id"?: string | null,"reason"?: string | null,"record_id"?: string | null,"table_name": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_role"?: Database["public"]['Enums']["app_role"] | null,"changed_fields"?: (string)[] | null,"clinic_id"?: string,"id"?: never,"occurred_at"?: string,"patient_id"?: string | null,"reason"?: string | null,"record_id"?: string | null,"table_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },
            "bed_reservations": {
                  Row: {
                    "admission_id": string,"bed_id": string,"clinic_id": string,"created_at": string,"created_by": string | null,"id": string,"reserved_from": string,"reserved_until": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admission_id": string,"bed_id": string,"clinic_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"reserved_from": string,"reserved_until": string,"status"?: string
                  }
                  Update: {
                    "admission_id"?: string,"bed_id"?: string,"clinic_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"reserved_from"?: string,"reserved_until"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bed_reservations_admission_id_clinic_id_fkey"
      columns: ["admission_id","clinic_id"]
isOneToOne: false
      referencedRelation: "admissions"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "bed_reservations_bed_id_clinic_id_fkey"
      columns: ["bed_id","clinic_id"]
isOneToOne: false
      referencedRelation: "beds"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "bed_reservations_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bed_reservations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },
            "bed_stays": {
                  Row: {
                    "admission_id": string,"bed_id": string,"clinic_id": string,"created_at": string,"created_by": string | null,"ends_at": string | null,"id": string,"note": string | null,"patient_id": string,"reason": string,"starts_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admission_id": string,"bed_id": string,"clinic_id": string,"created_at"?: string,"created_by"?: string | null,"ends_at"?: string | null,"id"?: string,"note"?: string | null,"patient_id": string,"reason": string,"starts_at": string
                  }
                  Update: {
                    "admission_id"?: string,"bed_id"?: string,"clinic_id"?: string,"created_at"?: string,"created_by"?: string | null,"ends_at"?: string | null,"id"?: string,"note"?: string | null,"patient_id"?: string,"reason"?: string,"starts_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bed_stays_admission_id_clinic_id_patient_id_fkey"
      columns: ["admission_id","clinic_id","patient_id"]
isOneToOne: false
      referencedRelation: "admissions"
      referencedColumns: ["id","clinic_id","patient_id"]
    },{
      foreignKeyName: "bed_stays_bed_id_clinic_id_fkey"
      columns: ["bed_id","clinic_id"]
isOneToOne: false
      referencedRelation: "beds"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "bed_stays_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bed_stays_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },
            "beds": {
                  Row: {
                    "clinic_id": string,"created_at": string,"housekeeping": string,"id": string,"label": string,"out_of_service": boolean,"updated_at": string,"ward_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"created_at"?: string,"housekeeping"?: string,"id"?: string,"label": string,"out_of_service"?: boolean,"updated_at"?: string,"ward_id": string
                  }
                  Update: {
                    "clinic_id"?: string,"created_at"?: string,"housekeeping"?: string,"id"?: string,"label"?: string,"out_of_service"?: boolean,"updated_at"?: string,"ward_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "beds_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "beds_ward_id_clinic_id_fkey"
      columns: ["ward_id","clinic_id"]
isOneToOne: false
      referencedRelation: "wards"
      referencedColumns: ["id","clinic_id"]
    }
                  ]
                },
            "care_tasks": {
                  Row: {
                    "admission_id": string,"clinic_id": string,"completed_at": string | null,"completed_by": string | null,"created_at": string,"created_by": string | null,"due_at": string,"id": string,"not_done_reason": string | null,"patient_id": string,"status": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admission_id": string,"clinic_id": string,"completed_at"?: string | null,"completed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"due_at": string,"id"?: string,"not_done_reason"?: string | null,"patient_id": string,"status"?: string,"title": string
                  }
                  Update: {
                    "admission_id"?: string,"clinic_id"?: string,"completed_at"?: string | null,"completed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"due_at"?: string,"id"?: string,"not_done_reason"?: string | null,"patient_id"?: string,"status"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "care_tasks_admission_id_clinic_id_patient_id_fkey"
      columns: ["admission_id","clinic_id","patient_id"]
isOneToOne: false
      referencedRelation: "admissions"
      referencedColumns: ["id","clinic_id","patient_id"]
    },{
      foreignKeyName: "care_tasks_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "care_tasks_completed_by_fkey"
      columns: ["completed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "care_tasks_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },
            "clinics": {
                  Row: {
                    "consent_form_version": string,"created_at": string,"currency": string,"emergency_requires_finance_clearance": boolean,"id": string,"name": string,"require_deposit_for_elective": boolean,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consent_form_version"?: string,"created_at"?: string,"currency"?: string,"emergency_requires_finance_clearance"?: boolean,"id"?: string,"name": string,"require_deposit_for_elective"?: boolean,"timezone"?: string
                  }
                  Update: {
                    "consent_form_version"?: string,"created_at"?: string,"currency"?: string,"emergency_requires_finance_clearance"?: boolean,"id"?: string,"name"?: string,"require_deposit_for_elective"?: boolean,"timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                },
            "consultations": {
                  Row: {
                    "appointment_id": string | null,"assessment": string,"clinic_id": string,"created_at": string,"critical_reason": string | null,"doctor_id": string,"id": string,"is_critical": boolean,"objective": string,"patient_id": string,"plan": string,"signed_at": string | null,"signed_by": string | null,"subjective": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"assessment"?: string,"clinic_id": string,"created_at"?: string,"critical_reason"?: string | null,"doctor_id": string,"id"?: string,"is_critical"?: boolean,"objective"?: string,"patient_id": string,"plan"?: string,"signed_at"?: string | null,"signed_by"?: string | null,"subjective"?: string,"updated_at"?: string
                  }
                  Update: {
                    "appointment_id"?: string | null,"assessment"?: string,"clinic_id"?: string,"created_at"?: string,"critical_reason"?: string | null,"doctor_id"?: string,"id"?: string,"is_critical"?: boolean,"objective"?: string,"patient_id"?: string,"plan"?: string,"signed_at"?: string | null,"signed_by"?: string | null,"subjective"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "consultations_appointment_id_clinic_id_fkey"
      columns: ["appointment_id","clinic_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "consultations_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "consultations_doctor_id_clinic_id_fkey"
      columns: ["doctor_id","clinic_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "consultations_patient_id_clinic_id_fkey"
      columns: ["patient_id","clinic_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "consultations_signed_by_fkey"
      columns: ["signed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },
            "demo_requests": {
                  Row: {
                    "beds": number | null,"created_at": string,"email": string,"id": string,"message": string | null,"name": string,"organisation": string
                  }
                  ComputedFields: never
                  Insert: {
                    "beds"?: number | null,"created_at"?: string,"email": string,"id"?: string,"message"?: string | null,"name": string,"organisation": string
                  }
                  Update: {
                    "beds"?: number | null,"created_at"?: string,"email"?: string,"id"?: string,"message"?: string | null,"name"?: string,"organisation"?: string
                  }
                  Relationships: [
                    
                  ]
                },
            "discharge_clearances": {
                  Row: {
                    "admission_id": string,"cleared_at": string,"cleared_by": string,"clinic_id": string,"department": string,"id": string,"note": string | null,"patient_id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admission_id": string,"cleared_at"?: string,"cleared_by": string,"clinic_id": string,"department": string,"id"?: string,"note"?: string | null,"patient_id": string,"status": string
                  }
                  Update: {
                    "admission_id"?: string,"cleared_at"?: string,"cleared_by"?: string,"clinic_id"?: string,"department"?: string,"id"?: string,"note"?: string | null,"patient_id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "discharge_clearances_admission_id_clinic_id_patient_id_fkey"
      columns: ["admission_id","clinic_id","patient_id"]
isOneToOne: false
      referencedRelation: "admissions"
      referencedColumns: ["id","clinic_id","patient_id"]
    },{
      foreignKeyName: "discharge_clearances_cleared_by_fkey"
      columns: ["cleared_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "discharge_clearances_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },
            "invoice_lines": {
                  Row: {
                    "clinic_id": string,"created_at": string,"description": string,"id": string,"invoice_id": string,"quantity": number,"unit_price_minor": number
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"created_at"?: string,"description": string,"id"?: string,"invoice_id": string,"quantity": number,"unit_price_minor": number
                  }
                  Update: {
                    "clinic_id"?: string,"created_at"?: string,"description"?: string,"id"?: string,"invoice_id"?: string,"quantity"?: number,"unit_price_minor"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_lines_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_lines_invoice_id_clinic_id_fkey"
      columns: ["invoice_id","clinic_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id","clinic_id"]
    }
                  ]
                },
            "invoices": {
                  Row: {
                    "appointment_id": string | null,"clinic_id": string,"created_at": string,"created_by": string | null,"currency": string,"id": string,"insurance_claimed_minor": number,"insurance_paid_minor": number,"insurance_settled_at": string | null,"insurance_status": Database["public"]['Enums']["insurance_status"],"insurer_name": string | null,"issued_at": string | null,"number": string,"patient_id": string,"state": Database["public"]['Enums']["invoice_state"],"updated_at": string,"void_reason": string | null,"voided_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"clinic_id": string,"created_at"?: string,"created_by"?: string | null,"currency": string,"id"?: string,"insurance_claimed_minor"?: number,"insurance_paid_minor"?: number,"insurance_settled_at"?: string | null,"insurance_status"?: Database["public"]['Enums']["insurance_status"],"insurer_name"?: string | null,"issued_at"?: string | null,"number": string,"patient_id": string,"state"?: Database["public"]['Enums']["invoice_state"],"updated_at"?: string,"void_reason"?: string | null,"voided_at"?: string | null
                  }
                  Update: {
                    "appointment_id"?: string | null,"clinic_id"?: string,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"id"?: string,"insurance_claimed_minor"?: number,"insurance_paid_minor"?: number,"insurance_settled_at"?: string | null,"insurance_status"?: Database["public"]['Enums']["insurance_status"],"insurer_name"?: string | null,"issued_at"?: string | null,"number"?: string,"patient_id"?: string,"state"?: Database["public"]['Enums']["invoice_state"],"updated_at"?: string,"void_reason"?: string | null,"voided_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoices_appointment_id_clinic_id_fkey"
      columns: ["appointment_id","clinic_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "invoices_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_patient_id_clinic_id_fkey"
      columns: ["patient_id","clinic_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id","clinic_id"]
    }
                  ]
                },
            "observations": {
                  Row: {
                    "admission_id": string,"clinic_id": string,"correction_reason": string | null,"corrects_id": string | null,"diastolic": number | null,"id": string,"note": string | null,"patient_id": string,"pulse": number | null,"recorded_at": string,"recorded_by": string,"resp_rate": number | null,"spo2": number | null,"systolic": number | null,"temp_c": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "admission_id": string,"clinic_id": string,"correction_reason"?: string | null,"corrects_id"?: string | null,"diastolic"?: number | null,"id"?: string,"note"?: string | null,"patient_id": string,"pulse"?: number | null,"recorded_at"?: string,"recorded_by": string,"resp_rate"?: number | null,"spo2"?: number | null,"systolic"?: number | null,"temp_c"?: number | null
                  }
                  Update: {
                    "admission_id"?: string,"clinic_id"?: string,"correction_reason"?: string | null,"corrects_id"?: string | null,"diastolic"?: number | null,"id"?: string,"note"?: string | null,"patient_id"?: string,"pulse"?: number | null,"recorded_at"?: string,"recorded_by"?: string,"resp_rate"?: number | null,"spo2"?: number | null,"systolic"?: number | null,"temp_c"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "observations_admission_id_clinic_id_patient_id_fkey"
      columns: ["admission_id","clinic_id","patient_id"]
isOneToOne: false
      referencedRelation: "admissions"
      referencedColumns: ["id","clinic_id","patient_id"]
    },{
      foreignKeyName: "observations_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "observations_corrects_id_fkey"
      columns: ["corrects_id"]
isOneToOne: false
      referencedRelation: "observations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "observations_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },
            "patients": {
                  Row: {
                    "address": string | null,"archived_at": string | null,"auth_user_id": string | null,"clinic_id": string,"consent_communication": boolean,"consent_data_processing_at": string | null,"consent_recorded_by": string | null,"consent_treatment_at": string | null,"consent_version": string | null,"created_at": string,"date_of_birth": string,"email": string | null,"family_name": string,"given_name": string,"id": string,"mrn": string,"phone": string | null,"sex_at_birth": Database["public"]['Enums']["sex_at_birth"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"archived_at"?: string | null,"auth_user_id"?: string | null,"clinic_id": string,"consent_communication"?: boolean,"consent_data_processing_at"?: string | null,"consent_recorded_by"?: string | null,"consent_treatment_at"?: string | null,"consent_version"?: string | null,"created_at"?: string,"date_of_birth": string,"email"?: string | null,"family_name": string,"given_name": string,"id"?: string,"mrn": string,"phone"?: string | null,"sex_at_birth"?: Database["public"]['Enums']["sex_at_birth"],"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"archived_at"?: string | null,"auth_user_id"?: string | null,"clinic_id"?: string,"consent_communication"?: boolean,"consent_data_processing_at"?: string | null,"consent_recorded_by"?: string | null,"consent_treatment_at"?: string | null,"consent_version"?: string | null,"created_at"?: string,"date_of_birth"?: string,"email"?: string | null,"family_name"?: string,"given_name"?: string,"id"?: string,"mrn"?: string,"phone"?: string | null,"sex_at_birth"?: Database["public"]['Enums']["sex_at_birth"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "patients_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "patients_consent_recorded_by_fkey"
      columns: ["consent_recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },
            "payments": {
                  Row: {
                    "amount_minor": number,"clinic_id": string,"created_at": string,"id": string,"invoice_id": string,"method": Database["public"]['Enums']["payment_method"],"received_at": string,"received_by": string | null,"reference": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"clinic_id": string,"created_at"?: string,"id"?: string,"invoice_id": string,"method": Database["public"]['Enums']["payment_method"],"received_at"?: string,"received_by"?: string | null,"reference"?: string | null
                  }
                  Update: {
                    "amount_minor"?: number,"clinic_id"?: string,"created_at"?: string,"id"?: string,"invoice_id"?: string,"method"?: Database["public"]['Enums']["payment_method"],"received_at"?: string,"received_by"?: string | null,"reference"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_invoice_id_clinic_id_fkey"
      columns: ["invoice_id","clinic_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "payments_received_by_fkey"
      columns: ["received_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },
            "prescriptions": {
                  Row: {
                    "allergy_override_reason": string | null,"clinic_id": string,"consultation_id": string | null,"created_at": string,"dose": string,"drug_name": string,"duration_days": number | null,"frequency": string,"id": string,"patient_id": string,"prescriber_id": string,"route": string,"status": Database["public"]['Enums']["prescription_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allergy_override_reason"?: string | null,"clinic_id": string,"consultation_id"?: string | null,"created_at"?: string,"dose": string,"drug_name": string,"duration_days"?: number | null,"frequency": string,"id"?: string,"patient_id": string,"prescriber_id": string,"route": string,"status"?: Database["public"]['Enums']["prescription_status"],"updated_at"?: string
                  }
                  Update: {
                    "allergy_override_reason"?: string | null,"clinic_id"?: string,"consultation_id"?: string | null,"created_at"?: string,"dose"?: string,"drug_name"?: string,"duration_days"?: number | null,"frequency"?: string,"id"?: string,"patient_id"?: string,"prescriber_id"?: string,"route"?: string,"status"?: Database["public"]['Enums']["prescription_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "prescriptions_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "prescriptions_consultation_id_clinic_id_fkey"
      columns: ["consultation_id","clinic_id"]
isOneToOne: false
      referencedRelation: "consultations"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "prescriptions_patient_id_clinic_id_fkey"
      columns: ["patient_id","clinic_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "prescriptions_prescriber_id_clinic_id_fkey"
      columns: ["prescriber_id","clinic_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","clinic_id"]
    }
                  ]
                },
            "profiles": {
                  Row: {
                    "active": boolean,"clinic_id": string,"created_at": string,"full_name": string,"id": string,"role": Database["public"]['Enums']["app_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"clinic_id": string,"created_at"?: string,"full_name": string,"id": string,"role": Database["public"]['Enums']["app_role"],"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"clinic_id"?: string,"created_at"?: string,"full_name"?: string,"id"?: string,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },
            "rooms": {
                  Row: {
                    "clinic_id": string,"created_at": string,"id": string,"kind": string,"name": string,"out_of_service": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"created_at"?: string,"id"?: string,"kind"?: string,"name": string,"out_of_service"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "clinic_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"name"?: string,"out_of_service"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rooms_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },
            "wards": {
                  Row: {
                    "active": boolean,"clinic_id": string,"created_at": string,"id": string,"kind": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"clinic_id": string,"created_at"?: string,"id"?: string,"kind"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"clinic_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "wards_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "invoice_balances": {
                  Row: {
                    "appointment_id": string | null,"balance_due_minor": number | null,"clinic_id": string,"created_at": string,"currency": string,"insurance_adjustment_minor": number | null,"insurance_claimed_minor": number | null,"insurance_paid_minor": number | null,"insurance_status": Database["public"]['Enums']["insurance_status"],"invoice_id": string,"issued_at": string | null,"number": string,"patient_due_now_minor": number | null,"patient_id": string,"patient_paid_minor": number | null,"patient_responsibility_minor": number | null,"payment_status": string | null,"state": Database["public"]['Enums']["invoice_state"],"total_minor": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "invoices_appointment_id_clinic_id_fkey"
      columns: ["appointment_id","clinic_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "invoices_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_patient_id_clinic_id_fkey"
      columns: ["patient_id","clinic_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id","clinic_id"]
    }
                  ]
                }
          }
          Functions: {
            "allocate_bed":
{ Args: { "p_admission": string,"p_bed": string }; Returns: string
                           },
            "authorise_discharge":
{ Args: { "p_admission": string,"p_summary": string }; Returns: undefined
                           },
            "billed_bed_days":
{ Args: { "p_admission": string }; Returns: number
                           },
            "cancel_admission":
{ Args: { "p_admission": string,"p_reason": string }; Returns: undefined
                           },
            "finalise_discharge":
{ Args: { "p_admission": string }; Returns: undefined
                           },
            "log_record_access":
{ Args: { "p_reason"?: string,"p_record_id": string,"p_table": string }; Returns: undefined
                           },
            "record_clearance":
{ Args: { "p_admission": string,"p_department": string,"p_note"?: string,"p_status": string }; Returns: undefined
                           },
            "set_bed_housekeeping":
{ Args: { "p_bed": string,"p_state": string }; Returns: undefined
                           },
            "submit_demo_request":
{ Args: { "p_beds": number,"p_email": string,"p_message": string,"p_name": string,"p_organisation": string }; Returns: string
                           },
            "transfer_bed":
{ Args: { "p_admission": string,"p_bed": string,"p_effective"?: string,"p_note"?: string }; Returns: string
                           },
            "withdraw_discharge_authorisation":
{ Args: { "p_admission": string,"p_reason": string }; Returns: undefined
                           }
          }
          Enums: {
            "app_role": "admin"|"doctor"|"receptionist"|"lab"|"pharmacist"|"patient"|"nurse","appointment_status": "scheduled"|"arrived"|"in_room"|"completed"|"cancelled"|"no_show","insurance_status": "none"|"pending"|"settled"|"denied","invoice_state": "draft"|"issued"|"void","payment_method": "cash"|"card"|"bank_transfer"|"other","prescription_status": "draft"|"active"|"cancelled"|"dispensed","sex_at_birth": "female"|"male"|"intersex"|"unknown"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
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
    : never = never
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "app_role": ["admin", "doctor", "receptionist", "lab", "pharmacist", "patient", "nurse"],"appointment_status": ["scheduled", "arrived", "in_room", "completed", "cancelled", "no_show"],"insurance_status": ["none", "pending", "settled", "denied"],"invoice_state": ["draft", "issued", "void"],"payment_method": ["cash", "card", "bank_transfer", "other"],"prescription_status": ["draft", "active", "cancelled", "dispensed"],"sex_at_birth": ["female", "male", "intersex", "unknown"]
          }
        }
} as const
