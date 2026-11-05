// Creates or updates the platform operator account. Usage:
//   PLATFORM_ADMIN_EMAIL=you@x.com PLATFORM_ADMIN_PASSWORD='...' DATABASE_URL=... node scripts/platform-admin.mjs
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const { PLATFORM_ADMIN_EMAIL: email, PLATFORM_ADMIN_PASSWORD: pw, DATABASE_URL: url } = process.env;
if (!email || !pw || !url) { console.error("Set PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD and DATABASE_URL"); process.exit(1); }
if (pw.length < 12) { console.error("Use a password of at least 12 characters"); process.exit(1); }
const salt = randomBytes(16);
const h = await promisify(scrypt)(pw, salt, 64);
const hash = `scrypt$${salt.toString("base64")}$${h.toString("base64")}`;
const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query(`INSERT INTO users(email,name,password_hash,is_platform_admin,email_verified_at) VALUES (lower($1),'Platform operator',$2,true,now())
  ON CONFLICT ((lower(email))) DO UPDATE SET password_hash=EXCLUDED.password_hash, is_platform_admin=true, status='active'`, [email, hash]);
await c.end();
console.log("platform admin ready:", email);
