"use client";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "./Button";

/** Submit button that disables itself and announces progress while pending. */
export function SubmitButton({ pendingLabel = "Saving…", children, ...rest }: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || rest.disabled} aria-disabled={pending} {...rest}>
      {pending ? <span aria-live="polite">{pendingLabel}</span> : children}
    </Button>
  );
}
