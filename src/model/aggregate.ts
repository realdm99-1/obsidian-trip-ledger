import type { Expense } from './types';

export interface ExpenseSummary {
	totalMinor: number;
	byCategory: Map<string, number>;
	byPlace: Map<string, number>;
	byDate: Map<string, number>;
}

function addSafe(left: number, right: number): number {
	const sum = left + right;
	if (!Number.isSafeInteger(sum)) throw new Error('Total amount is too large');
	return sum;
}

export function summarize(expenses: Expense[]): ExpenseSummary {
	const byCategory = new Map<string, number>();
	const byPlace = new Map<string, number>();
	const byDate = new Map<string, number>();
	let totalMinor = 0;
	for (const expense of expenses) {
		totalMinor = addSafe(totalMinor, expense.amountMinor);
		byCategory.set(expense.categoryId, addSafe(byCategory.get(expense.categoryId) ?? 0, expense.amountMinor));
		byPlace.set(expense.place, addSafe(byPlace.get(expense.place) ?? 0, expense.amountMinor));
		byDate.set(expense.date, addSafe(byDate.get(expense.date) ?? 0, expense.amountMinor));
	}
	return { totalMinor, byCategory, byPlace, byDate };
}

export function categoryPercent(amountMinor: number, totalMinor: number): number {
	return totalMinor === 0 ? 0 : Math.round(amountMinor / totalMinor * 1000) / 10;
}
