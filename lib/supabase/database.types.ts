
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
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
                },"audit_log": {
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
                },"clinics": {
                  Row: {
                    "consent_form_version": string,"created_at": string,"currency": string,"id": string,"name": string,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consent_form_version"?: string,"created_at"?: string,"currency"?: string,"id"?: string,"name": string,"timezone"?: string
                  }
                  Update: {
                    "consent_form_version"?: string,"created_at"?: string,"currency"?: string,"id"?: string,"name"?: string,"timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"consultations": {
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
                },"invoice_lines": {
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
      referencedRelation: "invoice_balances"
      referencedColumns: ["invoice_id","clinic_id"]
    },{
      foreignKeyName: "invoice_lines_invoice_id_clinic_id_fkey"
      columns: ["invoice_id","clinic_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id","clinic_id"]
    }
                  ]
                },"invoices": {
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
                },"lab_orders": {
                  Row: {
                    "cancelled_reason": string | null,"clinic_id": string,"clinical_notes": string | null,"collected_at": string | null,"collected_by": string | null,"consultation_id": string | null,"created_at": string,"id": string,"ordered_at": string,"ordered_by": string,"patient_id": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_reason"?: string | null,"clinic_id": string,"clinical_notes"?: string | null,"collected_at"?: string | null,"collected_by"?: string | null,"consultation_id"?: string | null,"created_at"?: string,"id"?: string,"ordered_at"?: string,"ordered_by": string,"patient_id": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "cancelled_reason"?: string | null,"clinic_id"?: string,"clinical_notes"?: string | null,"collected_at"?: string | null,"collected_by"?: string | null,"consultation_id"?: string | null,"created_at"?: string,"id"?: string,"ordered_at"?: string,"ordered_by"?: string,"patient_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lab_orders_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lab_orders_collected_by_clinic_id_fkey"
      columns: ["collected_by","clinic_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "lab_orders_consultation_id_clinic_id_fkey"
      columns: ["consultation_id","clinic_id"]
isOneToOne: false
      referencedRelation: "consultations"
      referencedColumns: ["id","clinic_id"]
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
                },"lab_reference_ranges": {
                  Row: {
                    "age_max_years": number,"age_min_years": number,"clinic_id": string,"created_at": string,"critical_high": number | null,"critical_low": number | null,"high": number | null,"id": string,"low": number | null,"note": string | null,"reviewed_at": string | null,"reviewed_by_name": string | null,"sex": string,"test_type_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "age_max_years"?: number,"age_min_years"?: number,"clinic_id": string,"created_at"?: string,"critical_high"?: number | null,"critical_low"?: number | null,"high"?: number | null,"id"?: string,"low"?: number | null,"note"?: string | null,"reviewed_at"?: string | null,"reviewed_by_name"?: string | null,"sex"?: string,"test_type_id": string
                  }
                  Update: {
                    "age_max_years"?: number,"age_min_years"?: number,"clinic_id"?: string,"created_at"?: string,"critical_high"?: number | null,"critical_low"?: number | null,"high"?: number | null,"id"?: string,"low"?: number | null,"note"?: string | null,"reviewed_at"?: string | null,"reviewed_by_name"?: string | null,"sex"?: string,"test_type_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lab_reference_ranges_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lab_reference_ranges_test_type_id_clinic_id_fkey"
      columns: ["test_type_id","clinic_id"]
isOneToOne: false
      referencedRelation: "lab_test_types"
      referencedColumns: ["id","clinic_id"]
    }
                  ]
                },"lab_results": {
                  Row: {
                    "acknowledged_at": string | null,"acknowledged_by": string | null,"clinic_id": string,"comment": string | null,"created_at": string,"entered_at": string | null,"entered_by": string | null,"flag": string | null,"id": string,"order_id": string,"patient_id": string,"range_id": string | null,"range_reviewed": boolean | null,"ref_critical_high": number | null,"ref_critical_low": number | null,"ref_high": number | null,"ref_low": number | null,"released_at": string | null,"released_by": string | null,"test_type_id": string,"unit": string,"updated_at": string,"value": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledged_at"?: string | null,"acknowledged_by"?: string | null,"clinic_id": string,"comment"?: string | null,"created_at"?: string,"entered_at"?: string | null,"entered_by"?: string | null,"flag"?: string | null,"id"?: string,"order_id": string,"patient_id": string,"range_id"?: string | null,"range_reviewed"?: boolean | null,"ref_critical_high"?: number | null,"ref_critical_low"?: number | null,"ref_high"?: number | null,"ref_low"?: number | null,"released_at"?: string | null,"released_by"?: string | null,"test_type_id": string,"unit": string,"updated_at"?: string,"value"?: number | null
                  }
                  Update: {
                    "acknowledged_at"?: string | null,"acknowledged_by"?: string | null,"clinic_id"?: string,"comment"?: string | null,"created_at"?: string,"entered_at"?: string | null,"entered_by"?: string | null,"flag"?: string | null,"id"?: string,"order_id"?: string,"patient_id"?: string,"range_id"?: string | null,"range_reviewed"?: boolean | null,"ref_critical_high"?: number | null,"ref_critical_low"?: number | null,"ref_high"?: number | null,"ref_low"?: number | null,"released_at"?: string | null,"released_by"?: string | null,"test_type_id"?: string,"unit"?: string,"updated_at"?: string,"value"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lab_results_acknowledged_by_clinic_id_fkey"
      columns: ["acknowledged_by","clinic_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "lab_results_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lab_results_entered_by_clinic_id_fkey"
      columns: ["entered_by","clinic_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","clinic_id"]
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
      foreignKeyName: "lab_results_range_id_clinic_id_fkey"
      columns: ["range_id","clinic_id"]
isOneToOne: false
      referencedRelation: "lab_reference_ranges"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "lab_results_released_by_clinic_id_fkey"
      columns: ["released_by","clinic_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "lab_results_test_type_id_clinic_id_fkey"
      columns: ["test_type_id","clinic_id"]
isOneToOne: false
      referencedRelation: "lab_test_types"
      referencedColumns: ["id","clinic_id"]
    }
                  ]
                },"lab_test_types": {
                  Row: {
                    "active": boolean,"clinic_id": string,"code": string,"created_at": string,"id": string,"name": string,"unit": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"clinic_id": string,"code": string,"created_at"?: string,"id"?: string,"name": string,"unit": string
                  }
                  Update: {
                    "active"?: boolean,"clinic_id"?: string,"code"?: string,"created_at"?: string,"id"?: string,"name"?: string,"unit"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lab_test_types_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"patient_allergies": {
                  Row: {
                    "allergen": string | null,"allergen_class": string | null,"clinic_id": string,"created_at": string,"id": string,"kind": string,"patient_id": string,"reaction": string | null,"recorded_at": string,"recorded_by": string | null,"removed_at": string | null,"removed_by": string | null,"removed_reason": string | null,"severity": Database["public"]['Enums']["allergy_severity"] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "allergen"?: string | null,"allergen_class"?: string | null,"clinic_id": string,"created_at"?: string,"id"?: string,"kind": string,"patient_id": string,"reaction"?: string | null,"recorded_at"?: string,"recorded_by"?: string | null,"removed_at"?: string | null,"removed_by"?: string | null,"removed_reason"?: string | null,"severity"?: Database["public"]['Enums']["allergy_severity"] | null
                  }
                  Update: {
                    "allergen"?: string | null,"allergen_class"?: string | null,"clinic_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"patient_id"?: string,"reaction"?: string | null,"recorded_at"?: string,"recorded_by"?: string | null,"removed_at"?: string | null,"removed_by"?: string | null,"removed_reason"?: string | null,"severity"?: Database["public"]['Enums']["allergy_severity"] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "patient_allergies_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "patient_allergies_patient_id_clinic_id_fkey"
      columns: ["patient_id","clinic_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "patient_allergies_recorded_by_clinic_id_fkey"
      columns: ["recorded_by","clinic_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","clinic_id"]
    },{
      foreignKeyName: "patient_allergies_removed_by_clinic_id_fkey"
      columns: ["removed_by","clinic_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","clinic_id"]
    }
                  ]
                },"patients": {
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
                },"payments": {
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
      referencedRelation: "invoice_balances"
      referencedColumns: ["invoice_id","clinic_id"]
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
                },"prescriptions": {
                  Row: {
                    "allergy_check_status": string,"allergy_override_reason": string | null,"clinic_id": string,"consultation_id": string | null,"created_at": string,"dose": string,"drug_classes": (string)[],"drug_name": string,"duration_days": number | null,"frequency": string,"id": string,"patient_id": string,"prescriber_id": string,"route": string,"status": Database["public"]['Enums']["prescription_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allergy_check_status"?: string,"allergy_override_reason"?: string | null,"clinic_id": string,"consultation_id"?: string | null,"created_at"?: string,"dose": string,"drug_classes"?: (string)[],"drug_name": string,"duration_days"?: number | null,"frequency": string,"id"?: string,"patient_id": string,"prescriber_id": string,"route": string,"status"?: Database["public"]['Enums']["prescription_status"],"updated_at"?: string
                  }
                  Update: {
                    "allergy_check_status"?: string,"allergy_override_reason"?: string | null,"clinic_id"?: string,"consultation_id"?: string | null,"created_at"?: string,"dose"?: string,"drug_classes"?: (string)[],"drug_name"?: string,"duration_days"?: number | null,"frequency"?: string,"id"?: string,"patient_id"?: string,"prescriber_id"?: string,"route"?: string,"status"?: Database["public"]['Enums']["prescription_status"],"updated_at"?: string
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
                },"profiles": {
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
                },"rooms": {
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
            "create_lab_order":
{ Args: { "p_consultation": string,"p_notes"?: string,"p_patient": string,"p_tests": (string)[] }; Returns: string
                           },
"log_record_access":
{ Args: { "p_reason"?: string,"p_record_id": string,"p_table": string }; Returns: undefined
                           }
          }
          Enums: {
            "allergy_severity": "mild"|"moderate"|"severe","app_role": "admin"|"doctor"|"receptionist"|"lab"|"pharmacist"|"patient","appointment_status": "scheduled"|"arrived"|"in_room"|"completed"|"cancelled"|"no_show","insurance_status": "none"|"pending"|"settled"|"denied","invoice_state": "draft"|"issued"|"void","payment_method": "cash"|"card"|"bank_transfer"|"other","prescription_status": "draft"|"active"|"cancelled"|"dispensed","sex_at_birth": "female"|"male"|"intersex"|"unknown"
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
            "allergy_severity": ["mild", "moderate", "severe"],"app_role": ["admin", "doctor", "receptionist", "lab", "pharmacist", "patient"],"appointment_status": ["scheduled", "arrived", "in_room", "completed", "cancelled", "no_show"],"insurance_status": ["none", "pending", "settled", "denied"],"invoice_state": ["draft", "issued", "void"],"payment_method": ["cash", "card", "bank_transfer", "other"],"prescription_status": ["draft", "active", "cancelled", "dispensed"],"sex_at_birth": ["female", "male", "intersex", "unknown"]
          }
        }
} as const
