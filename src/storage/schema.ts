import { isDateKey } from '../model/dates';
import type { CustomCategory, Expense, Trip } from '../model/types';
import { assertLedgerPath, DEFAULT_LEDGER_ROOT } from './paths';

type RecordValue = Record<string, unknown>;

function record(value: unknown): value is RecordValue {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function managed(value: unknown, kind: string): asserts value is RecordValue {
	if (!record(value) || value['trip-ledger'] !== kind || value.schemaVersion !== 1) {
		throw new Error(`Invalid ${kind} ledger file`);
	}
}

function nonempty(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${field}`);
	return value;
}

export function parseTrip(value: unknown, folderPath: string, root = DEFAULT_LEDGER_ROOT): Trip {
	assertLedgerPath(folderPath, root);
	managed(value, 'trip');
	const id = nonempty(value.id, 'trip ID');
	const name = nonempty(value.name, 'trip name');
	const currency = nonempty(value.currency, 'currency');
	if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency');
	if (typeof value.currencyLocked !== 'boolean') throw new Error('Invalid currency lock');
	return { id, name, currency, currencyLocked: value.currencyLocked, folderPath };
}

export interface DayRecord {
	tripId: string;
	date: string;
	expenses: Expense[];
}

export function parseDay(value: unknown, tripId: string, date: string): DayRecord {
	managed(value, 'day');
	const storedDate = value.date instanceof Date
		? Number.isFinite(value.date.getTime()) && value.date.toISOString() === `${date}T00:00:00.000Z` ? date : null
		: value.date;
	if (value.tripId !== tripId || storedDate !== date || !isDateKey(date)) {
		throw new Error('Day belongs to another trip or date');
	}
	if (!Array.isArray(value.expenses)) throw new Error('Invalid expenses');
	const ids = new Set<string>();
	const expenses = value.expenses.map((entry: unknown): Expense => {
		if (!record(entry)) throw new Error('Invalid expense');
		const id = nonempty(entry.id, 'expense ID');
		if (ids.has(id)) throw new Error('Duplicate expense ID');
		ids.add(id);
		const item = nonempty(entry.item, 'item');
		const place = nonempty(entry.place, 'place');
		const categoryId = nonempty(entry.categoryId, 'category');
		const amountMinor = entry.amountMinor;
		if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
			throw new Error('Invalid expense amount');
		}
		return { id, date, item, amountMinor, place, categoryId };
	});
	return { tripId, date, expenses };
}

export function parseCategories(value: unknown): CustomCategory[] {
	managed(value, 'categories');
	if (!Array.isArray(value.categories)) throw new Error('Invalid categories');
	const ids = new Set<string>();
	return value.categories.map((entry: unknown): CustomCategory => {
		if (!record(entry)) throw new Error('Invalid category');
		const id = nonempty(entry.id, 'category ID');
		const name = nonempty(entry.name, 'category name');
		if (ids.has(id) || typeof entry.archived !== 'boolean') throw new Error('Invalid category record');
		ids.add(id);
		return { id, name, archived: entry.archived };
	});
}
