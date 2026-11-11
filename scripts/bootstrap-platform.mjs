// Creates (or promotes) the first platform owner. Usage: PLATFORM_OWNER_EMAIL=... PLATFORM_OWNER_PASSWORD=... node scripts/bootstrap-platform.mjs
import pg from "pg"; import crypto from "node:crypto";
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
const email = (process.env.PLATFORM_OWNER_EMAIL || "").toLowerCase(), pw = process.env.PLATFORM_OWNER_PASSWORD || "";
if (!url || !email || pw.length < 12) { console.error("Set DATABASE_URL, PLATFORM_OWNER_EMAIL and PLATFORM_OWNER_PASSWORD (12+ chars)"); process.exit(1); }
const salt = crypto.randomBytes(16); const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
const hash = `scrypt$${salt.toString("base64")}$${h.toString("base64")}`;
const c = new pg.Client({ connectionString: url }); await c.connect();
await c.query(`insert into users(email,name,password_hash,email_verified_at,platform_role) values ($1,'Platform owner',$2,now(),'owner')
  on conflict ((lower(email))) do update set platform_role='owner'`, [email, hash]);
await c.end(); console.log("Platform owner ready:", email);
