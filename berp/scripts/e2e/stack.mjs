// Local test stack: stands in for Supabase's public URL.
//   /rest/v1/*  → real PostgREST (real schema, real RLS, real JWT role switching)
//   /auth/v1/*  → minimal GoTrue stand-in (email+password, signup, refresh, user, logout) backed by auth.users
// Only authentication is simulated. Used by scripts/e2e/run.sh; never deployed.
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

const { PG_URL, JWT_SECRET, POSTGREST_URL = "http://127.0.0.1:3001", PORT = "54321" } = process.env;
const db = new pg.Pool({ connectionString: PG_URL, max: 3 });
await db.query("create schema if not exists e2e; create table if not exists e2e.passwords (user_id uuid primary key, salt text, hash text)");

const b64 = (b) => Buffer.from(b).toString("base64url");
const sign = (claims) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64(JSON.stringify(claims)); return `${h}.${p}.${crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const verify = (t) => { try { const [h, p, s] = t.split("."); const ok = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url") === s; const c = JSON.parse(Buffer.from(p, "base64url")); return ok && c.exp > Date.now() / 1000 ? c : null; } catch { return null; } };
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString("hex");
const userObj = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: "email" }, user_metadata: u.meta ?? {}, created_at: new Date().toISOString() });
const session = (u) => { const now = Math.floor(Date.now() / 1000); return { access_token: sign({ sub: u.id, role: "authenticated", aud: "authenticated", email: u.email, exp: now + 3600 }), token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: sign({ sub: u.id, typ: "refresh", exp: now + 86400 * 7, n: crypto.randomUUID() }), user: userObj(u) }; };
const send = (res, code, body, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(body === undefined ? "" : JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname.startsWith("/rest/v1/")) {
      const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "connection", "content-length"].includes(k)));
      const r = await fetch(POSTGREST_URL + url.pathname.slice("/rest/v1".length) + url.search, { method: req.method, headers, body });
      const out = Buffer.from(await r.arrayBuffer());
      const rh = Object.fromEntries([...r.headers].filter(([k]) => !["content-encoding", "transfer-encoding", "connection"].includes(k)));
      res.writeHead(r.status, { ...rh, "content-length": out.length }); return res.end(out);
    }
    if (!url.pathname.startsWith("/auth/v1/")) return send(res, 404, { message: "not found" });
    const route = url.pathname.slice("/auth/v1".length);
    const body = req.method === "POST" ? JSON.parse((await readBody(req)).toString() || "{}") : {};
    if (route === "/signup") {
      const email = String(body.email ?? "").toLowerCase();
      if ((await db.query("select 1 from auth.users where lower(email)=$1", [email])).rowCount) return send(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
      const { rows: [u] } = await db.query("insert into auth.users (email) values ($1) returning id, email", [email]);
      const salt = crypto.randomBytes(8).toString("hex");
      await db.query("insert into e2e.passwords values ($1,$2,$3)", [u.id, salt, hash(body.password, salt)]);
      return send(res, 200, session({ ...u, meta: body.data }));
    }
    if (route === "/token" && url.searchParams.get("grant_type") === "password") {
      const { rows: [u] } = await db.query("select u.id, u.email, p.salt, p.hash from auth.users u join e2e.passwords p on p.user_id = u.id where lower(u.email)=$1", [String(body.email ?? "").toLowerCase()]);
      if (!u || hash(body.password ?? "", u.salt) !== u.hash) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      return send(res, 200, session(u));
    }
    if (route === "/token" && url.searchParams.get("grant_type") === "refresh_token") {
      const c = verify(body.refresh_token ?? ""); if (!c || c.typ !== "refresh") return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      const { rows: [u] } = await db.query("select id, email from auth.users where id=$1", [c.sub]);
      return u ? send(res, 200, session(u)) : send(res, 400, { msg: "user gone" });
    }
    if (route === "/user") {
      const c = verify((req.headers.authorization ?? "").replace(/^Bearer /, ""));
      if (!c || c.role !== "authenticated") return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      const { rows: [u] } = await db.query("select id, email from auth.users where id=$1", [c.sub]);
      return u ? send(res, 200, userObj(u)) : send(res, 401, { msg: "user not found" });
    }
    if (route === "/logout") return send(res, 204);
    return send(res, 404, { msg: "unsupported auth route " + route });
  } catch (e) { console.error(e); send(res, 500, { msg: String(e.message) }); }
}).listen(Number(PORT), "127.0.0.1", () => console.log("stack listening on", PORT));
