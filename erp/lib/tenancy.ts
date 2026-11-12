import type { Db } from "./db";
import { SYSTEM_ROLES } from "./perms";
import { audit } from "./audit";

export const DEFAULT_ACCOUNTS: Array<[string, string, string, string | null]> = [
  ["1000", "Cash and bank", "asset", "cash"],
  ["1100", "Accounts receivable", "asset", "ar"],
  ["1200", "Inventory", "asset", "inventory"],
  ["1210", "Goods received not invoiced", "liability", "grni"],
  ["1300", "Input tax credit", "asset", "input_tax"],
  ["2000", "Accounts payable", "liability", "ap"],
  ["2100", "Output tax payable", "liability", "output_tax"],
  ["3000", "Owner equity / opening balances", "equity", "equity"],
  ["4000", "Sales revenue", "income", "sales"],
  ["4100", "Sales returns and allowances", "income", "sales_returns"],
  ["5000", "Cost of goods sold", "expense", "cogs"],
  ["5100", "Inventory adjustments", "expense", "inv_adjust"],
  ["5200", "Purchase price variance", "expense", "ppv"],
  ["5300", "Operating expenses", "expense", "opex"],
  ["5400", "Repairs and maintenance", "expense", "maintenance"],
];
const SEQUENCES: Record<string, string> = {
  quote: "QT", sales_order: "SO", purchase_request: "PR", purchase_order: "PO", goods_receipt: "GRN", supplier_bill: "BILL",
  dispatch: "DN", customer_return: "RET", invoice: "INV", credit_note: "CN", receipt: "RCT", supplier_payment: "PAY",
  journal: "JV", transfer: "TRF", stock_count: "CNT", expense: "EXP", supplier_return: "SRT", asset_ticket: "TKT",
};

/** Seeds roles, chart of accounts, tax codes, numbering, financial periods for a new company. */
export async function provisionTenant(db: Db, tenantId: string, ownerUserId: string, branchName: string, fyStartMonth = 4) {
  for (const [key, r] of Object.entries(SYSTEM_ROLES)) {
    await db.query("insert into roles(tenant_id,key,name,permissions,is_system) values ($1,$2,$3,$4,true)", [tenantId, key, r.name, r.permissions]);
  }
  const owner = (await db.query("select id from roles where tenant_id=$1 and key='owner'", [tenantId])).rows[0].id;
  await db.query("insert into memberships(tenant_id,user_id,role_id) values ($1,$2,$3)", [tenantId, ownerUserId, owner]);
  for (const [code, name, type, sk] of DEFAULT_ACCOUNTS) {
    await db.query("insert into accounts(tenant_id,code,name,type,system_key) values ($1,$2,$3,$4,$5)", [tenantId, code, name, type, sk]);
  }
  for (const [code, name, bps] of [["GST0", "GST 0%", 0], ["GST5", "GST 5%", 500], ["GST12", "GST 12%", 1200], ["GST18", "GST 18%", 1800], ["GST28", "GST 28%", 2800]] as const) {
    await db.query("insert into tax_codes(tenant_id,code,name,rate_bps) values ($1,$2,$3,$4)", [tenantId, code, name, bps]);
  }
  for (const [k, p] of Object.entries(SEQUENCES)) await db.query("insert into number_sequences(tenant_id,key,prefix) values ($1,$2,$3)", [tenantId, k, p]);
  const b = (await db.query("insert into branches(tenant_id,code,name) values ($1,'MAIN',$2) returning id", [tenantId, branchName])).rows[0].id;
  await db.query("insert into warehouses(tenant_id,branch_id,code,name) values ($1,$2,'WH-MAIN','Main warehouse')", [tenantId, b]);
  // monthly periods covering the current and next financial year
  const now = new Date();
  const startYear = now.getUTCMonth() + 1 >= fyStartMonth ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  for (let i = 0; i < 24; i++) {
    const s = new Date(Date.UTC(startYear, fyStartMonth - 1 + i, 1));
    const e = new Date(Date.UTC(startYear, fyStartMonth + i, 0));
    const label = s.toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
    await db.query("insert into fin_periods(tenant_id,label,starts_on,ends_on) values ($1,$2,$3,$4)", [tenantId, label, s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)]);
  }
  await db.query("insert into approval_rules(tenant_id,entity_type,min_amount_paise,approver_permission) values ($1,'purchase_order',5000000,'procurement.approve'), ($1,'quote',10000000,'sales.approve'), ($1,'expense',1000000,'finance.approve')", [tenantId]);
  await audit(db, { tenantId, actorUserId: ownerUserId, action: "tenant.provisioned", entityType: "tenant", entityId: tenantId });
  return { branchId: b };
}
