"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { queueEmail, tx } from "@/lib/server/db";
import { type FormState, str, toState } from "@/lib/server/actions";
import { UserError } from "@/lib/server/db";

const schema = z.object({
  kind: z.enum(["demo", "contact"]),
  name: z.string().min(2, "Enter your name").max(120),
  email: z.string().email("Enter a valid email address").max(200),
  company: z.string().max(160).optional(),
  message: z.string().max(2000).optional(),
});

/** Public lead forms: validated, rate-limited per IP, stored, and queued to sales. */
export async function submitLead(_p: FormState, fd: FormData): Promise<FormState> {
  try {
    if (str(fd, "website")) return { ok: true, message: "Thanks — we will be in touch." }; // honeypot
    const d = schema.parse({ kind: str(fd, "kind"), name: str(fd, "name"), email: str(fd, "email"), company: str(fd, "company"), message: str(fd, "message") });
    const ip = ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0]!.trim();
    await tx({}, async (db) => {
      const n = await db.one<{ n: number }>("SELECT count(*)::int n FROM login_attempts WHERE key = $1 AND at > now() - interval '1 hour'", [`lead:${ip}`]);
      if (n.n >= 10) throw new UserError("Too many requests from your network. Please try again later.");
      await db.exec("INSERT INTO login_attempts(key) VALUES ($1)", [`lead:${ip}`]);
      await db.exec("INSERT INTO leads(kind,name,email,company,message) VALUES ($1,$2,$3,$4,$5)", [d.kind, d.name, d.email, d.company ?? null, d.message ?? null]);
      if (process.env.SALES_EMAIL) await queueEmail(db, null, process.env.SALES_EMAIL, `New ${d.kind} request from ${d.name}`, `${d.name} <${d.email}> ${d.company ?? ""}\n\n${d.message ?? ""}`);
    });
    return { ok: true, message: d.kind === "demo" ? "Demo request received. We will email you within one business day." : "Message received. We will reply by email." };
  } catch (e) {
    return toState(e);
  }
}
