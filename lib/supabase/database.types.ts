
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
            "charges": {
                  Row: {
                    "admission_id": string | null,"cancel_reason": string | null,"captured_at": string,"captured_by": string | null,"category": string,"clinic_id": string,"description": string,"id": string,"invoice_id": string | null,"item_code": string,"patient_id": string,"quantity": number,"status": string,"tariff_version_id": string,"unit_price_minor": number
                  }
                  ComputedFields: never
                  Insert: {
                    "admission_id"?: string | null,"cancel_reason"?: string | null,"captured_at"?: string,"captured_by"?: string | null,"category": string,"clinic_id": string,"description": string,"id"?: string,"invoice_id"?: string | null,"item_code": string,"patient_id": string,"quantity": number,"status"?: string,"tariff_version_id": string,"unit_price_minor": number
                  }
                  Update: {
                    "admission_id"?: string | null,"cancel_reason"?: string | null,"captured_at"?: string,"captured_by"?: string | null,"category"?: string,"clinic_id"?: string,"description"?: string,"id"?: string,"invoice_id"?: string | null,"item_code"?: string,"patient_id"?: string,"quantity"?: number,"status"?: string,"tariff_version_id"?: string,"unit_price_minor"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "charges_admission_id_clinic_id_fkey"
      columns: ["admission_id","clinic_id"]
isOneToOne: false
      referencedRelation: "admissions"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "charges_captured_by_fkey"
      columns: ["captured_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "charges_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "charges_invoice_id_clinic_id_fkey"
      columns: ["invoice_id","clinic_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "charges_patient_id_clinic_id_fkey"
      columns: ["patient_id","clinic_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "charges_tariff_version_id_clinic_id_fkey"
      columns: ["tariff_version_id","clinic_id"]
isOneToOne: false
      referencedRelation: "tariff_versions"
      referencedColumns: ["id","clinic_id"]
    }
                  ]
                },
            "clinics": {
                  Row: {
                    "consent_form_version": string,"created_at": string,"critical_ack_minutes": number,"currency": string,"emergency_requires_finance_clearance": boolean,"id": string,"name": string,"require_deposit_for_elective": boolean,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consent_form_version"?: string,"created_at"?: string,"critical_ack_minutes"?: number,"currency"?: string,"emergency_requires_finance_clearance"?: boolean,"id"?: string,"name": string,"require_deposit_for_elective"?: boolean,"timezone"?: string
                  }
                  Update: {
                    "consent_form_version"?: string,"created_at"?: string,"critical_ack_minutes"?: number,"currency"?: string,"emergency_requires_finance_clearance"?: boolean,"id"?: string,"name"?: string,"require_deposit_for_elective"?: boolean,"timezone"?: string
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
            "deposits": {
                  Row: {
                    "admission_id": string | null,"amount_minor": number,"applied_minor": number,"clinic_id": string,"id": string,"method": Database["public"]['Enums']["payment_method"],"patient_id": string,"received_at": string,"received_by": string | null,"reference": string,"refunded_minor": number
                  }
                  ComputedFields: never
                  Insert: {
                    "admission_id"?: string | null,"amount_minor": number,"applied_minor"?: number,"clinic_id": string,"id"?: string,"method": Database["public"]['Enums']["payment_method"],"patient_id": string,"received_at"?: string,"received_by"?: string | null,"reference": string,"refunded_minor"?: number
                  }
                  Update: {
                    "admission_id"?: string | null,"amount_minor"?: number,"applied_minor"?: number,"clinic_id"?: string,"id"?: string,"method"?: Database["public"]['Enums']["payment_method"],"patient_id"?: string,"received_at"?: string,"received_by"?: string | null,"reference"?: string,"refunded_minor"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "deposits_admission_id_clinic_id_fkey"
      columns: ["admission_id","clinic_id"]
isOneToOne: false
      referencedRelation: "admissions"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "deposits_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "deposits_patient_id_clinic_id_fkey"
      columns: ["patient_id","clinic_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "deposits_received_by_fkey"
      columns: ["received_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
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
            "dispensings": {
                  Row: {
                    "batch_id": string,"clinic_id": string,"dispensed_at": string,"dispensed_by": string,"id": string,"medicine_id": string,"patient_id": string,"prescription_id": string,"qty": number,"returned_qty": number,"witness_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_id": string,"clinic_id": string,"dispensed_at"?: string,"dispensed_by": string,"id"?: string,"medicine_id": string,"patient_id": string,"prescription_id": string,"qty": number,"returned_qty"?: number,"witness_id"?: string | null
                  }
                  Update: {
                    "batch_id"?: string,"clinic_id"?: string,"dispensed_at"?: string,"dispensed_by"?: string,"id"?: string,"medicine_id"?: string,"patient_id"?: string,"prescription_id"?: string,"qty"?: number,"returned_qty"?: number,"witness_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "dispensings_batch_id_clinic_id_fkey"
      columns: ["batch_id","clinic_id"]
isOneToOne: false
      referencedRelation: "stock_batches"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "dispensings_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "dispensings_dispensed_by_fkey"
      columns: ["dispensed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "dispensings_patient_id_clinic_id_fkey"
      columns: ["patient_id","clinic_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "dispensings_prescription_id_clinic_id_fkey"
      columns: ["prescription_id","clinic_id"]
isOneToOne: false
      referencedRelation: "prescriptions"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "dispensings_witness_id_fkey"
      columns: ["witness_id"]
isOneToOne: false
      referencedRelation: "profiles"
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
            "lab_orders": {
                  Row: {
                    "accession": string | null,"admission_id": string | null,"cancel_reason": string | null,"clinic_id": string,"clinical_note": string | null,"collected_at": string | null,"collected_by": string | null,"id": string,"kind": string,"ordered_at": string,"ordered_by": string,"patient_id": string,"priority": string,"status": string,"test_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accession"?: string | null,"admission_id"?: string | null,"cancel_reason"?: string | null,"clinic_id": string,"clinical_note"?: string | null,"collected_at"?: string | null,"collected_by"?: string | null,"id"?: string,"kind"?: string,"ordered_at"?: string,"ordered_by": string,"patient_id": string,"priority"?: string,"status"?: string,"test_name": string
                  }
                  Update: {
                    "accession"?: string | null,"admission_id"?: string | null,"cancel_reason"?: string | null,"clinic_id"?: string,"clinical_note"?: string | null,"collected_at"?: string | null,"collected_by"?: string | null,"id"?: string,"kind"?: string,"ordered_at"?: string,"ordered_by"?: string,"patient_id"?: string,"priority"?: string,"status"?: string,"test_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lab_orders_admission_id_clinic_id_fkey"
      columns: ["admission_id","clinic_id"]
isOneToOne: false
      referencedRelation: "admissions"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "lab_orders_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lab_orders_collected_by_fkey"
      columns: ["collected_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lab_orders_ordered_by_clinic_id_fkey"
      columns: ["ordered_by","clinic_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "lab_orders_patient_id_clinic_id_fkey"
      columns: ["patient_id","clinic_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id","clinic_id"]
    }
                  ]
                },
            "lab_results": {
                  Row: {
                    "acknowledged_at": string | null,"acknowledged_by": string | null,"amendment_reason": string | null,"clinic_id": string,"entered_at": string,"entered_by": string,"flag": string,"id": string,"note": string | null,"order_id": string,"patient_id": string,"published_at": string | null,"reference_range": string | null,"reviewed_by": string | null,"state": string,"unit": string | null,"value": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledged_at"?: string | null,"acknowledged_by"?: string | null,"amendment_reason"?: string | null,"clinic_id": string,"entered_at"?: string,"entered_by": string,"flag"?: string,"id"?: string,"note"?: string | null,"order_id": string,"patient_id": string,"published_at"?: string | null,"reference_range"?: string | null,"reviewed_by"?: string | null,"state"?: string,"unit"?: string | null,"value": string,"version": number
                  }
                  Update: {
                    "acknowledged_at"?: string | null,"acknowledged_by"?: string | null,"amendment_reason"?: string | null,"clinic_id"?: string,"entered_at"?: string,"entered_by"?: string,"flag"?: string,"id"?: string,"note"?: string | null,"order_id"?: string,"patient_id"?: string,"published_at"?: string | null,"reference_range"?: string | null,"reviewed_by"?: string | null,"state"?: string,"unit"?: string | null,"value"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "lab_results_acknowledged_by_fkey"
      columns: ["acknowledged_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lab_results_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lab_results_entered_by_fkey"
      columns: ["entered_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lab_results_order_id_clinic_id_fkey"
      columns: ["order_id","clinic_id"]
isOneToOne: false
      referencedRelation: "lab_orders"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "lab_results_patient_id_clinic_id_fkey"
      columns: ["patient_id","clinic_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "lab_results_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },
            "medicines": {
                  Row: {
                    "active": boolean,"clinic_id": string,"controlled": boolean,"created_at": string,"form": string,"id": string,"name": string,"on_formulary": boolean,"strength": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"clinic_id": string,"controlled"?: boolean,"created_at"?: string,"form"?: string,"id"?: string,"name": string,"on_formulary"?: boolean,"strength"?: string
                  }
                  Update: {
                    "active"?: boolean,"clinic_id"?: string,"controlled"?: boolean,"created_at"?: string,"form"?: string,"id"?: string,"name"?: string,"on_formulary"?: boolean,"strength"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "medicines_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },
            "notifications": {
                  Row: {
                    "clinic_id": string,"created_at": string,"id": string,"kind": string,"link": string | null,"read_at": string | null,"title": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"created_at"?: string,"id"?: string,"kind": string,"link"?: string | null,"read_at"?: string | null,"title": string,"user_id": string
                  }
                  Update: {
                    "clinic_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"link"?: string | null,"read_at"?: string | null,"title"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
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
                    "allergy_override_reason": string | null,"clinic_id": string,"consultation_id": string | null,"created_at": string,"dose": string,"drug_name": string,"duration_days": number | null,"frequency": string,"id": string,"medicine_id": string | null,"patient_id": string,"prescriber_id": string,"quantity": number | null,"route": string,"status": Database["public"]['Enums']["prescription_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allergy_override_reason"?: string | null,"clinic_id": string,"consultation_id"?: string | null,"created_at"?: string,"dose": string,"drug_name": string,"duration_days"?: number | null,"frequency": string,"id"?: string,"medicine_id"?: string | null,"patient_id": string,"prescriber_id": string,"quantity"?: number | null,"route": string,"status"?: Database["public"]['Enums']["prescription_status"],"updated_at"?: string
                  }
                  Update: {
                    "allergy_override_reason"?: string | null,"clinic_id"?: string,"consultation_id"?: string | null,"created_at"?: string,"dose"?: string,"drug_name"?: string,"duration_days"?: number | null,"frequency"?: string,"id"?: string,"medicine_id"?: string | null,"patient_id"?: string,"prescriber_id"?: string,"quantity"?: number | null,"route"?: string,"status"?: Database["public"]['Enums']["prescription_status"],"updated_at"?: string
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
      foreignKeyName: "prescriptions_medicine_id_clinic_id_fkey"
      columns: ["medicine_id","clinic_id"]
isOneToOne: false
      referencedRelation: "medicines"
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
            "refunds": {
                  Row: {
                    "amount_minor": number,"clinic_id": string,"decided_at": string | null,"decided_by": string | null,"decision_reason": string | null,"deposit_id": string | null,"id": string,"invoice_id": string | null,"patient_id": string,"reason": string,"requested_at": string,"requested_by": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"clinic_id": string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_reason"?: string | null,"deposit_id"?: string | null,"id"?: string,"invoice_id"?: string | null,"patient_id": string,"reason": string,"requested_at"?: string,"requested_by": string,"status"?: string
                  }
                  Update: {
                    "amount_minor"?: number,"clinic_id"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_reason"?: string | null,"deposit_id"?: string | null,"id"?: string,"invoice_id"?: string | null,"patient_id"?: string,"reason"?: string,"requested_at"?: string,"requested_by"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "refunds_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_deposit_id_clinic_id_fkey"
      columns: ["deposit_id","clinic_id"]
isOneToOne: false
      referencedRelation: "deposits"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "refunds_invoice_id_clinic_id_fkey"
      columns: ["invoice_id","clinic_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "refunds_patient_id_clinic_id_fkey"
      columns: ["patient_id","clinic_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "refunds_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
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
            "stock_batches": {
                  Row: {
                    "batch_no": string,"clinic_id": string,"expiry_date": string,"id": string,"medicine_id": string,"on_hand_qty": number,"received_at": string,"received_by": string | null,"received_qty": number,"status": string,"status_reason": string | null,"supplier_ref": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_no": string,"clinic_id": string,"expiry_date": string,"id"?: string,"medicine_id": string,"on_hand_qty": number,"received_at"?: string,"received_by"?: string | null,"received_qty": number,"status"?: string,"status_reason"?: string | null,"supplier_ref"?: string | null
                  }
                  Update: {
                    "batch_no"?: string,"clinic_id"?: string,"expiry_date"?: string,"id"?: string,"medicine_id"?: string,"on_hand_qty"?: number,"received_at"?: string,"received_by"?: string | null,"received_qty"?: number,"status"?: string,"status_reason"?: string | null,"supplier_ref"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_batches_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_batches_medicine_id_clinic_id_fkey"
      columns: ["medicine_id","clinic_id"]
isOneToOne: false
      referencedRelation: "medicines"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "stock_batches_received_by_fkey"
      columns: ["received_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },
            "stock_movements": {
                  Row: {
                    "at": string,"batch_id": string,"by_user": string | null,"clinic_id": string,"id": number,"kind": string,"qty": number,"reason": string | null,"reference_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"batch_id": string,"by_user"?: string | null,"clinic_id": string,"id"?: never,"kind": string,"qty": number,"reason"?: string | null,"reference_id"?: string | null
                  }
                  Update: {
                    "at"?: string,"batch_id"?: string,"by_user"?: string | null,"clinic_id"?: string,"id"?: never,"kind"?: string,"qty"?: number,"reason"?: string | null,"reference_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_movements_batch_id_clinic_id_fkey"
      columns: ["batch_id","clinic_id"]
isOneToOne: false
      referencedRelation: "stock_batches"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "stock_movements_by_user_fkey"
      columns: ["by_user"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },
            "stock_returns": {
                  Row: {
                    "claimed_saleable": boolean,"clinic_id": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"dispensing_id": string,"id": string,"qty": number,"reason": string,"requested_at": string,"requested_by": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "claimed_saleable": boolean,"clinic_id": string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"dispensing_id": string,"id"?: string,"qty": number,"reason": string,"requested_at"?: string,"requested_by": string,"status"?: string
                  }
                  Update: {
                    "claimed_saleable"?: boolean,"clinic_id"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"dispensing_id"?: string,"id"?: string,"qty"?: number,"reason"?: string,"requested_at"?: string,"requested_by"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_returns_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_returns_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_returns_dispensing_id_clinic_id_fkey"
      columns: ["dispensing_id","clinic_id"]
isOneToOne: false
      referencedRelation: "dispensings"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "stock_returns_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },
            "substitutions": {
                  Row: {
                    "clinic_id": string,"decided_at": string | null,"decided_by": string | null,"id": string,"medicine_id": string,"prescription_id": string,"reason": string,"requested_by": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"medicine_id": string,"prescription_id": string,"reason": string,"requested_by": string,"status"?: string
                  }
                  Update: {
                    "clinic_id"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"medicine_id"?: string,"prescription_id"?: string,"reason"?: string,"requested_by"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "substitutions_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "substitutions_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "substitutions_medicine_id_clinic_id_fkey"
      columns: ["medicine_id","clinic_id"]
isOneToOne: false
      referencedRelation: "medicines"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "substitutions_prescription_id_clinic_id_fkey"
      columns: ["prescription_id","clinic_id"]
isOneToOne: false
      referencedRelation: "prescriptions"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "substitutions_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },
            "tariff_items": {
                  Row: {
                    "category": string,"clinic_id": string,"code": string,"description": string,"id": string,"unit_price_minor": number,"version_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: string,"clinic_id": string,"code": string,"description": string,"id"?: string,"unit_price_minor": number,"version_id": string
                  }
                  Update: {
                    "category"?: string,"clinic_id"?: string,"code"?: string,"description"?: string,"id"?: string,"unit_price_minor"?: number,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tariff_items_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tariff_items_version_id_clinic_id_fkey"
      columns: ["version_id","clinic_id"]
isOneToOne: false
      referencedRelation: "tariff_versions"
      referencedColumns: ["id","clinic_id"]
    }
                  ]
                },
            "tariff_versions": {
                  Row: {
                    "activated_at": string | null,"clinic_id": string,"created_at": string,"created_by": string | null,"effective_from": string,"id": string,"name": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activated_at"?: string | null,"clinic_id": string,"created_at"?: string,"created_by"?: string | null,"effective_from": string,"id"?: string,"name": string,"status"?: string
                  }
                  Update: {
                    "activated_at"?: string | null,"clinic_id"?: string,"created_at"?: string,"created_by"?: string | null,"effective_from"?: string,"id"?: string,"name"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tariff_versions_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tariff_versions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
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
                },
            "overdue_critical_results": {
                  Row: {
                    "clinic_id": string | null,"order_id": string | null,"ordered_by": string | null,"patient_id": string | null,"published_at": string | null,"test_name": string | null
                  }
                  ComputedFields: never
                  Relationships: []
                }
          }
          Functions: {
            "acknowledge_critical":
{ Args: { "p_order": string }; Returns: undefined
                           },
            "activate_tariff":
{ Args: { "p_version": string }; Returns: undefined
                           },
            "add_medicine":
{ Args: { "p_controlled": boolean,"p_form": string,"p_name": string,"p_strength": string }; Returns: string
                           },
            "allocate_bed":
{ Args: { "p_admission": string,"p_bed": string }; Returns: string
                           },
            "apply_deposit":
{ Args: { "p_deposit": string,"p_invoice": string }; Returns: number
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
            "cancel_charge":
{ Args: { "p_charge": string,"p_reason": string }; Returns: undefined
                           },
            "cancel_order":
{ Args: { "p_order": string,"p_reason": string }; Returns: undefined
                           },
            "capture_bed_days":
{ Args: { "p_admission": string }; Returns: number
                           },
            "capture_charge":
{ Args: { "p_admission": string,"p_code": string,"p_patient": string,"p_qty": number }; Returns: string
                           },
            "collect_specimen":
{ Args: { "p_order": string }; Returns: string
                           },
            "create_tariff_draft":
{ Args: { "p_copy_from"?: string,"p_effective": string,"p_name": string }; Returns: string
                           },
            "decide_refund":
{ Args: { "p_approve": boolean,"p_reason"?: string,"p_refund": string }; Returns: undefined
                           },
            "decide_return":
{ Args: { "p_accept": boolean,"p_note"?: string,"p_return": string }; Returns: string
                           },
            "decide_substitution":
{ Args: { "p_approve": boolean,"p_sub": string }; Returns: undefined
                           },
            "dispense":
{ Args: { "p_batch": string,"p_qty": number,"p_rx": string,"p_witness"?: string }; Returns: string
                           },
            "dispose_batch":
{ Args: { "p_batch": string,"p_reason": string }; Returns: undefined
                           },
            "enter_result":
{ Args: { "p_amend_reason"?: string,"p_flag": string,"p_note": string,"p_order": string,"p_range": string,"p_unit": string,"p_value": string }; Returns: number
                           },
            "finalise_discharge":
{ Args: { "p_admission": string }; Returns: undefined
                           },
            "generate_bill":
{ Args: { "p_admission": string,"p_patient": string }; Returns: string
                           },
            "log_record_access":
{ Args: { "p_reason"?: string,"p_record_id": string,"p_table": string }; Returns: undefined
                           },
            "mark_notifications_read":
{ Args: {  }; Returns: undefined
                           },
            "place_order":
{ Args: { "p_admission": string,"p_kind": string,"p_note": string,"p_patient": string,"p_priority": string,"p_test": string }; Returns: string
                           },
            "prescribe":
{ Args: { "p_days": number,"p_dose": string,"p_frequency": string,"p_medicine": string,"p_patient": string,"p_qty": number,"p_route": string }; Returns: string
                           },
            "publish_result":
{ Args: { "p_order": string }; Returns: undefined
                           },
            "receive_stock":
{ Args: { "p_batch": string,"p_expiry": string,"p_medicine": string,"p_qty": number,"p_supplier": string }; Returns: string
                           },
            "record_clearance":
{ Args: { "p_admission": string,"p_department": string,"p_note"?: string,"p_status": string }; Returns: undefined
                           },
            "record_deposit":
{ Args: { "p_admission": string,"p_amount": number,"p_method": Database["public"]['Enums']["payment_method"],"p_patient": string,"p_reference": string }; Returns: string
                           },
            "request_refund":
{ Args: { "p_amount": number,"p_deposit": string,"p_invoice": string,"p_reason": string }; Returns: string
                           },
            "request_return":
{ Args: { "p_dispensing": string,"p_qty": number,"p_reason": string,"p_saleable": boolean }; Returns: string
                           },
            "request_substitution":
{ Args: { "p_medicine": string,"p_reason": string,"p_rx": string }; Returns: undefined
                           },
            "set_batch_status":
{ Args: { "p_batch": string,"p_reason": string,"p_status": string }; Returns: number
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
