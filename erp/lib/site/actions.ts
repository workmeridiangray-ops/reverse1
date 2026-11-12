"use server";
import { z } from "zod";
import { withSystem } from "../db";
import { fail, type ActionResult } from "../actions";
import { UserError } from "../errors";
import { queueEmail } from "../email";

export async function contactAction(kind: "demo" | "contact", _p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    if (String(f.get("website") ?? "")) return { ok: true, message: "Thanks — we’ll be in touch." };   // honeypot
    const d = z.object({ name: z.string().min(2, "Enter your name").max(100), email: z.string().email("Enter a valid email"),
      company: z.string().max(120).optional(), phone: z.string().max(30).optional(), message: z.string().min(5, "Tell us a little more").max(2000) })
      .parse({ name: String(f.get("name") ?? "").trim(), email: String(f.get("email") ?? "").trim().toLowerCase(), company: String(f.get("company") ?? "").trim(), phone: String(f.get("phone") ?? "").trim(), message: String(f.get("message") ?? "").trim() });
    await withSystem(async (db) => {
      const n = Number((await db.query("select count(*) c from contact_requests where lower(email)=$1 and created_at > now() - interval '1 hour'", [d.email])).rows[0].c);
      if (n >= 3) throw new UserError("We already have your recent requests. We’ll reply soon.");
      await db.query("insert into contact_requests(kind,name,email,company,phone,message) values ($1,$2,$3,$4,$5,$6)", [kind, d.name, d.email, d.company || null, d.phone || null, d.message]);
      await queueEmail(db, { to: d.email, subject: "We received your request", text: `Hi ${d.name},\n\nThanks for contacting Ledgerline. A person will reply within one business day.` });
    });
    return { ok: true, message: kind === "demo" ? "Demo request received. We’ll email you to schedule it." : "Message received. We’ll reply by email." };
  } catch (e) { return fail(e); }
}
export const demoAction = contactAction.bind(null, "demo");
export const contactFormAction = contactAction.bind(null, "contact");
