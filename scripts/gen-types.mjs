/**
 * Regenerates lib/supabase/database.types.ts from a running Postgres without
 * Docker (the Supabase CLI needs Docker for `gen types`). Output keeps the
 * Supabase layout; Views are preserved from the existing file because their
 * relationships cannot be introspected.   node scripts/gen-types.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const FILE = new URL("../lib/supabase/database.types.ts", import.meta.url);
const url = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const c = new pg.Client({ connectionString: url });
await c.connect();

const old = readFileSync(FILE, "utf8");
const viewsBlock = old.match(/          Views: \{[\s\S]*?\n          \}\n          Functions:/)[0].replace(/\n          Functions:$/, "");
const tail = old.slice(old.indexOf("type DatabaseWithoutInternals"));

const enums = (await c.query(`select t.typname, array_agg(e.enumlabel::text order by e.enumsortorder) labels
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' group by t.typname order by t.typname`)).rows;
const enumNames = new Set(enums.map((e) => e.typname));

function tsType(udt, isArray) {
  const base = (u) => {
    if (enumNames.has(u)) return `Database["public"]['Enums']["${u}"]`;
    if (["int2", "int4", "int8", "numeric", "float4", "float8"].includes(u)) return "number";
    if (u === "bool") return "boolean";
    if (["json", "jsonb"].includes(u)) return "Json";
    return "string";
  };
  return isArray ? `(${base(udt.replace(/^_/, ""))})[]` : base(udt);
}

const cols = (await c.query(`
  select c.table_name, c.column_name, c.udt_name, c.data_type, c.is_nullable, c.column_default,
         c.is_identity, c.identity_generation, c.is_generated
  from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE' order by c.table_name, c.column_name`)).rows;
const fks = (await c.query(`
  select con.conname, cl.relname as tbl, rc.relname as ref,
    (select array_agg(a.attname::text order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols,
    (select array_agg(a.attname::text order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as refcols,
    exists (select 1 from pg_constraint u where u.conrelid = con.conrelid and u.contype in ('u','p') and u.conkey = con.conkey) as one
  from pg_constraint con join pg_class cl on cl.oid = con.conrelid join pg_class rc on rc.oid = con.confrelid
  join pg_namespace n on n.oid = cl.relnamespace where con.contype = 'f' and n.nspname = 'public' and rc.relnamespace = n.oid
  order by cl.relname, con.conname`)).rows;

const tables = [...new Set(cols.map((x) => x.table_name))];
const q = (s) => `"${s}"`;
const tableBlocks = tables.map((t) => {
  const tc = cols.filter((x) => x.table_name === t);
  const row = tc.map((x) => `${q(x.column_name)}: ${tsType(x.udt_name, x.data_type === "ARRAY")}${x.is_nullable === "YES" ? " | null" : ""}`).join(",");
  const ins = tc.map((x) => {
    const type = `${tsType(x.udt_name, x.data_type === "ARRAY")}${x.is_nullable === "YES" ? " | null" : ""}`;
    if (x.identity_generation === "ALWAYS" || x.is_generated === "ALWAYS") return `${q(x.column_name)}?: never`;
    const optional = x.is_nullable === "YES" || x.column_default !== null || x.is_identity === "YES";
    return `${q(x.column_name)}${optional ? "?" : ""}: ${type}`;
  }).join(",");
  const upd = tc.map((x) => {
    if (x.identity_generation === "ALWAYS" || x.is_generated === "ALWAYS") return `${q(x.column_name)}?: never`;
    return `${q(x.column_name)}?: ${tsType(x.udt_name, x.data_type === "ARRAY")}${x.is_nullable === "YES" ? " | null" : ""}`;
  }).join(",");
  const rels = fks.filter((f) => f.tbl === t).map((f) => `{
      foreignKeyName: "${f.conname}"
      columns: [${f.cols.map(q).join(",")}]
isOneToOne: ${f.one}
      referencedRelation: "${f.ref}"
      referencedColumns: [${f.refcols.map(q).join(",")}]
    }`).join(",");
  return `            "${t}": {
                  Row: {
                    ${row}
                  }
                  ComputedFields: never
                  Insert: {
                    ${ins}
                  }
                  Update: {
                    ${upd}
                  }
                  Relationships: [
                    ${rels}
                  ]
                }`;
});

const fnRows = (await c.query(`
  select p.proname, p.pronargs, p.pronargdefaults, p.proargnames, p.proargtypes::oid[] as argtypes, rt.typname as ret, p.proretset
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type rt on rt.oid = p.prorettype
  where n.nspname = 'public' and rt.typname <> 'trigger' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  order by p.proname`)).rows;
const typeNames = Object.fromEntries((await c.query(`select oid::int as oid, typname from pg_type`)).rows.map((r) => [r.oid, r.typname]));
const fnBlocks = fnRows.map((f) => {
  const names = f.proargnames ?? [];
  const args = f.argtypes.map((oid, i) => ({ name: names[i], type: typeNames[oid] }));
  const firstDefault = f.pronargs - f.pronargdefaults;
  const argStr = args.slice().map((a, i) => ({ ...a, opt: i >= firstDefault }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => `"${a.name}"${a.opt ? "?" : ""}: ${tsType(a.type, a.type.startsWith("_"))}`).join(",");
  const ret = f.ret === "void" ? "undefined" : tsType(f.ret, f.ret.startsWith("_"));
  return `            "${f.proname}":
{ Args: { ${argStr} }; Returns: ${ret}${f.proretset ? "[]" : ""}
                           }`;
});

const enumStr = enums.map((e) => `"${e.typname}": ${e.labels.map(q).join("|")}`).join(",");
const enumConst = enums.map((e) => `"${e.typname}": [${e.labels.map(q).join(", ")}]`).join(",");

const out = `
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
${tableBlocks.join(",\n")}
          }
${viewsBlock}
          Functions: {
${fnBlocks.join(",\n")}
          }
          Enums: {
            ${enumStr}
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

${tail.replace(/export const Constants = \{[\s\S]*$/, `export const Constants = {
  "public": {
          Enums: {
            ${enumConst}
          }
        }
} as const
`)}`;
writeFileSync(FILE, out);
await c.end();
console.log(`wrote ${tables.length} tables, ${fnRows.length} functions, ${enums.length} enums`);
