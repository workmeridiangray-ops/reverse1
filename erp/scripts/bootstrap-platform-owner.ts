import { Client } from "pg";
import { randomBytes, scryptSync } from "node:crypto";

// Usage: DATABASE_OWNER_URL=... PLATFORM_OWNER_EMAIL=you@x.com PLATFORM_OWNER_PASSWORD='...' npm run bootstrap:owner
// Creates (or promotes) the first platform owner. The owner must enable two-factor at first sign-in.
const url = process.env.DATABASE_OWNER_URL, email = process.env.PLATFORM_OWNER_EMAIL?.toLowerCase(), pw = process.env.PLATFORM_OWNER_PASSWORD;
if (!url || !email) { console.error("DATABASE_OWNER_URL and PLATFORM_OWNER_EMAIL are required"); process.exit(1); }
const c = new Client({ connectionString: url }); await c.connect();
const ex = await c.query("select id from users where lower(email)=$1", [email]);
if (ex.rows[0]) { await c.query("update users set platform_role='owner' where id=$1", [ex.rows[0].id]); console.log("Promoted existing user to platform owner."); }
else {
  if (!pw || pw.length < 12) { console.error("PLATFORM_OWNER_PASSWORD (12+ chars) is required for a new user"); process.exit(1); }
  const salt = randomBytes(16); const key = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  await c.query("insert into users(email,name,password_hash,email_verified_at,platform_role) values ($1,'Platform Owner',$2,now(),'owner')", [email, `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`]);
  console.log("Created platform owner. Sign in and enable two-factor.");
}
await c.end();
