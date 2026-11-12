/** Where a journal's source document lives, for drill-down from any balance to its transaction. */
export function sourceLink(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  const m: Record<string, string> = { invoice: `/app/finance/invoices/${id}`, supplier_bill: `/app/procurement/bills/${id}`, dispatch: `/app/fulfilment/dispatches/${id}`, receipt: `/app/finance/receipts`, credit_note: `/app/finance/invoices`, goods_receipt: `/app/procurement/orders`, customer_return: `/app/fulfilment/returns`, stock_count: `/app/inventory/counts`, expense: `/app/finance/expenses`, supplier_payment: `/app/procurement/bills` };
  return m[type] ?? null;
}
