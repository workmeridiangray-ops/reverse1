import { UserError } from "../errors";
import { parseQty } from "../money";
export function qtyFields(f: Record<string, string>, prefix: string) {
  const out: { id: string; qty: number }[] = [];
  for (const [k, v] of Object.entries(f)) { if (k.startsWith(prefix) && v !== "") { try { out.push({ id: k.slice(prefix.length), qty: parseQty(v) }); } catch (e: any) { throw new UserError(e.message, { [k]: e.message }); } } }
  return out;
}
