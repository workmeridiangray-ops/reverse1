/**
 * Turn database errors into messages a receptionist can act on. Business-rule
 * triggers raise human-readable messages already; constraint names map here.
 */
export function friendlyDbError(message: string | undefined): string {
  if (!message) return "Something went wrong. Please try again.";
  if (message.includes("appointments_no_doctor_overlap")) return "The doctor already has an appointment at this time.";
  if (message.includes("appointments_no_room_overlap")) return "The room is already booked at this time.";
  if (message.includes("bed_stays_no_bed_overlap")) return "That bed was just taken by someone else. Choose another bed.";
  if (message.includes("bed_stays_no_patient_overlap")) return "The patient already has a bed for that time.";
  if (message.includes("bed_reservations_no_overlap")) return "That bed is already reserved for part of that time.";
  if (message.includes("admissions_one_open_per_patient")) return "This patient already has an open admission.";
  if (message.includes("beds_ward_id_label_key")) return "A bed with that label already exists in this ward.";
  if (message.includes("wards_clinic_id_name_key")) return "A ward with that name already exists.";
  if (message.includes("row-level security")) return "You don't have permission to do that.";
  if (message.includes("violates foreign key")) return "That record belongs to another clinic or no longer exists.";
  if (message.includes("rooms_clinic_id_name_key")) return "A room with that name already exists.";
  if (/violates check constraint/.test(message)) return "Some values are not allowed. Check the form and try again.";
  return message;
}
