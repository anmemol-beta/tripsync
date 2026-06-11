import type { ExpenseDoc } from "@tripsync/schema";

export type SettlementTransfer = {
  from: string;
  to: string;
  amount: number;
  currency: string;
};

export type SettlementSummary = {
  transfers: SettlementTransfer[];
  totals_by_currency: Array<{ currency: string; amount: number }>;
};

export function summarizeSettlement(expenses: ExpenseDoc[]): SettlementSummary {
  const parsed = expenses.filter((expense) => expense.status === "parsed");
  return {
    transfers: settleExpenses(parsed),
    totals_by_currency: totalsByCurrency(parsed),
  };
}

function totalsByCurrency(expenses: ExpenseDoc[]): Array<{ currency: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + expense.amount);
  }
  return [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function settleExpenses(expenses: ExpenseDoc[]): SettlementTransfer[] {
  const byCurrency = new Map<string, ExpenseDoc[]>();
  for (const expense of expenses) {
    const list = byCurrency.get(expense.currency) ?? [];
    list.push(expense);
    byCurrency.set(expense.currency, list);
  }

  const transfers: SettlementTransfer[] = [];
  for (const [currency, list] of byCurrency) {
    transfers.push(...settleOneCurrency(list, currency));
  }
  return transfers;
}

function settleOneCurrency(expenses: ExpenseDoc[], currency: string): SettlementTransfer[] {
  const net = new Map<string, number>();

  for (const expense of expenses) {
    if (expense.split_among.length === 0) continue;
    const share = Math.floor(expense.amount / expense.split_among.length);
    net.set(expense.payer, (net.get(expense.payer) ?? 0) + expense.amount);
    for (const member of expense.split_among) {
      net.set(member, (net.get(member) ?? 0) - share);
    }
  }

  const creditors: Array<{ handle: string; amount: number }> = [];
  const debtors: Array<{ handle: string; amount: number }> = [];
  for (const [handle, amount] of net) {
    if (amount > 0) creditors.push({ handle, amount });
    if (amount < 0) debtors.push({ handle, amount: -amount });
  }
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const transfers: SettlementTransfer[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;
  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex]!;
    const debtor = debtors[debtorIndex]!;
    const amount = Math.min(creditor.amount, debtor.amount);
    if (amount > 0) {
      transfers.push({ from: debtor.handle, to: creditor.handle, amount, currency });
    }
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0) creditorIndex += 1;
    if (debtor.amount === 0) debtorIndex += 1;
  }

  return transfers;
}
