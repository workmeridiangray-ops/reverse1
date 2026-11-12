import { ActionForm, Field } from "@/components/ActionForm";
import { forgotAction } from "@/lib/auth/actions";
export const metadata = { title: "Reset password" };
export default function Forgot() {
  return (<div className="card"><h1>Reset your password</h1><p className="muted">Enter your email and we’ll send a link that works for one hour.</p>
    <ActionForm action={forgotAction} submit="Send reset link" guard={false}><Field name="email" label="Email" type="email" required /></ActionForm></div>);
}
