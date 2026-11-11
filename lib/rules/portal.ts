/**
 * Patient portal rules. Pure. The portal only ever lets a patient ask for or
 * change things; staff decide. Row-level security restricts every portal query
 * to the signed-in patient's own rows, and these rules only shape the input.
 */
import { validateContact } from "./patient";

export const MAX_OPEN_REQUESTS = 3;

export type RequestStatus = "open" | "booked" | "declined" | "cancelled";

export const REQUEST_LABEL: Readonly<Record<RequestStatus, string>> = {
  open: "Waiting for the clinic",
  booked: "Booked",
  declined: "Not possible",
  cancelled: "Cancelled by you",
};

export interface RequestInput {
  preferred: string;
  reason: string;
}

export function validateRequest(input: RequestInput, openCount: number): Partial<Record<keyof RequestInput | "form", string>> {
  const e: Partial<Record<keyof RequestInput | "form", string>> = {};
  if (!input.preferred.trim()) e.preferred = "Tell us when suits you, e.g. \"Tuesday or Wednesday mornings\".";
  else if (input.preferred.trim().length > 300) e.preferred = "Keep this under 300 characters.";
  if (!input.reason.trim()) e.reason = "Say briefly what the visit is for.";
  else if (input.reason.trim().length > 500) e.reason = "Keep this under 500 characters.";
  if (openCount >= MAX_OPEN_REQUESTS) e.form = `You already have ${MAX_OPEN_REQUESTS} requests waiting. Cancel one or wait for the clinic to reply.`;
  return e;
}

export function validateMyDetails(input: { phone: string; email: string }) {
  return validateContact(input.phone, input.email);
}

/** What a patient may do with a request in a given state. */
export const canCancelRequest = (status: RequestStatus): boolean => status === "open";
