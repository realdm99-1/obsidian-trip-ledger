import { BUILT_IN_CATEGORIES } from './categories';
import { isDateKey } from './dates';
import { parseAmountMinor } from './money';
import type { CustomCategory, Expense } from './types';

export interface ExpenseDraft {
	date: string;
	item: string;
	amount: string;
	place: string;
	categoryId: string;
}

export function validateExpenseDraft(
	draft: ExpenseDraft,
	currency: string,
	categories: CustomCategory[],
	existingCategoryId?: string,
): Omit<Expense, 'id'> {
	if (!isDateKey(draft.date)) throw new Error('Invalid date');
	const item = draft.item.trim();
	const place = draft.place.trim();
	if (!item || !place) throw new Error('Item and place are required');
	if (item.length > 120 || place.length > 120) throw new Error('Item or place is too long');
	const categoryId = draft.categoryId;
	const builtIn = BUILT_IN_CATEGORIES.some((id) => id === categoryId);
	const custom = categories.find((entry) => entry.id === categoryId);
	if (!builtIn && !custom && categoryId !== existingCategoryId) throw new Error('Unknown category');
	if (custom?.archived && categoryId !== existingCategoryId) throw new Error('Category is hidden');
	return {
		date: draft.date,
		item,
		amountMinor: parseAmountMinor(draft.amount, currency),
		place,
		categoryId,
	};
}
