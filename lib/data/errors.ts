/**
 * Turn database errors into messages a receptionist can act on. Business-rule
 * triggers raise human-readable messages already; constraint names map here.
 */
export function friendlyDbError(message: string | undefined): string {
  if (!message) return "Something went wrong. Please try again.";
  if (message.includes("appointments_no_doctor_overlap")) return "The doctor already has an appointment at this time.";
  if (message.includes("appointments_no_room_overlap")) return "The room is already booked at this time.";
  if (message.includes("row-level security")) return "You don't have permission to do that.";
  if (message.includes("stock_batches_product_id_batch_number_key")) return "That batch number has already been received for this product.";
  if (message.includes("stock_products_clinic_id_name_key")) return "A product with that name already exists.";
  if (message.includes("lab_test_types_clinic_id_code_key")) return "A test with that code already exists.";
  if (message.includes("lab_results_range_id_clinic_id_fkey")) return "This range has been used to flag results, so it can't be deleted. Edit it instead.";
  if (message.includes("lab_reference_ranges_check") || message.includes("lab_reference_ranges_age")) return "Those limits don't make sense together. Check the order: critical low, low, high, critical high.";
  if (message.includes("lab_ranges_no_overlap")) return "That range overlaps an existing one.";
  if (message.includes("violates foreign key")) return "That record belongs to another clinic or no longer exists.";
  if (message.includes("rooms_clinic_id_name_key")) return "A room with that name already exists.";
  if (/violates check constraint/.test(message)) return "Some values are not allowed. Check the form and try again.";
  return message;
}
