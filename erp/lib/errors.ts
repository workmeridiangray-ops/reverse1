/** An error whose message is safe and useful to show to the user. */
export class UserError extends Error {
  constructor(message: string, public fields: Record<string, string> = {}, public code = "invalid") { super(message); }
}
export class AccessDenied extends Error {
  constructor(message = "You do not have permission to do this.") { super(message); }
}
export class ConflictError extends UserError {
  constructor(message = "This record was changed by someone else. Reload to see the latest version, then retry.") { super(message, {}, "conflict"); }
}
export class PlanLimitError extends UserError {
  constructor(message: string) { super(message, {}, "plan_limit"); }
}
