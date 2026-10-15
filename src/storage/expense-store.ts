import type { DaySummary, Expense, Trip } from '../model/types';
import { isDateKey } from '../model/dates';
import { summarize } from '../model/aggregate';
import type { LedgerFiles } from './obsidian-files';
import { datesFolderPath, dayPath, tripFilePath } from './paths';
import { parseDay } from './schema';
import { TripStore } from './trip-store';
import { fileError, withFilePath } from './errors';
import { withTripWriteLock } from './trip-write-lock';

export interface ExpenseSaveResult {
	warning?: string;
}

function sameExpense(left: Expense | undefined, right: Expense): boolean {
	return left !== undefined && left.id === right.id && left.date === right.date &&
		left.item === right.item && left.amountMinor === right.amountMinor &&
		left.place === right.place && left.categoryId === right.categoryId;
}

function storedRows(rows: Expense[]): Omit<Expense, 'date'>[] {
	return rows.map(({ date: _date, ...row }) => row);
}

export class ExpenseStore {
	constructor(private files: LedgerFiles) {}

	async loadDay(trip: Trip, date: string): Promise<Expense[]> {
		const path = dayPath(trip.folderPath, date, this.files.root);
		const raw = await this.files.readFrontmatter(path);
		return raw === null ? [] : withFilePath(path, () => parseDay(raw, trip.id, date).expenses);
	}

	private async ensureDay(trip: Trip, date: string): Promise<string> {
		const path = dayPath(trip.folderPath, date, this.files.root);
		if (await this.files.readFrontmatter(path) !== null) return path;
		await this.files.createManagedFile(path, 'day', {
			tripId: trip.id, date, expenses: [],
		});
		return path;
	}

	async upsert(trip: Trip, expense: Expense, expected?: Expense): Promise<ExpenseSaveResult> {
		return withTripWriteLock(this.files, trip.id, () => this.upsertUnlocked(trip, expense, expected));
	}

	private async upsertUnlocked(trip: Trip, expense: Expense, expected?: Expense): Promise<ExpenseSaveResult> {
		if (!isDateKey(expense.date) || !expense.id || !expense.item.trim() || !expense.place.trim() ||
			!expense.categoryId || !Number.isSafeInteger(expense.amountMinor) || expense.amountMinor <= 0) {
			throw new Error('Invalid expense');
		}
		const tripStore = new TripStore(this.files);
		const locked = await tripStore.currencyLockState(trip);
		const path = await this.ensureDay(trip, expense.date);
		await this.files.mutateFrontmatter(path, (data) => {
			const current = parseDay(data, trip.id, expense.date).expenses;
			const previous = current.find((row) => row.id === expense.id);
			if (expected && !sameExpense(previous, expected)) throw new Error('Expense changed outside this view');
			if (!expected && previous) throw new Error('Duplicate expense ID');
			data.expenses = storedRows([...current.filter((row) => row.id !== expense.id), expense]);
		});
		if (!locked) {
			try {
				await tripStore.lockCurrency(trip);
			} catch (error) {
				return { warning: fileError(tripFilePath(trip.folderPath, this.files.root), error).message };
			}
		}
		return {};
	}

	async remove(trip: Trip, id: string, date: string, expected: Expense): Promise<void> {
		const path = dayPath(trip.folderPath, date, this.files.root);
		await this.files.mutateFrontmatter(path, (data) => {
			const current = parseDay(data, trip.id, date).expenses;
			const previous = current.find((row) => row.id === id);
			if (!sameExpense(previous, expected)) throw new Error('Expense changed outside this view');
			data.expenses = storedRows(current.filter((row) => row.id !== id));
		});
	}

	async moveDate(trip: Trip, expense: Expense, oldDate: string, expected: Expense): Promise<ExpenseSaveResult> {
		if (oldDate === expense.date) {
			return this.upsert(trip, expense, expected);
		}
		if (expected.date !== oldDate || expected.id !== expense.id) throw new Error('Invalid date move');
		return withTripWriteLock(this.files, trip.id, async () => {
			const result = await this.upsertUnlocked(trip, expense);
			try {
				await this.remove(trip, expense.id, oldDate, expected);
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				throw new Error(`Check both dates for a duplicate: ${dayPath(trip.folderPath, oldDate, this.files.root)}, ${dayPath(trip.folderPath, expense.date, this.files.root)}. ${detail}`);
			}
			return result;
		});
	}

	async listDates(trip: Trip): Promise<string[]> {
		const paths = await this.files.listMarkdownPaths(datesFolderPath(trip.folderPath, this.files.root));
		const dates: string[] = [];
		for (const path of paths) {
			const date = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
			if (!isDateKey(date)) continue;
			const rows = await this.loadDay(trip, date);
			if (rows.length > 0) dates.push(date);
		}
		return dates.sort().reverse();
	}

	async listDaySummaries(trip: Trip): Promise<DaySummary[]> {
		const paths = await this.files.listMarkdownPaths(datesFolderPath(trip.folderPath, this.files.root));
		const summaries: DaySummary[] = [];
		for (const path of paths) {
			const date = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
			if (!isDateKey(date)) continue;
			const rows = await this.loadDay(trip, date);
			if (rows.length > 0) {
				summaries.push({ date, count: rows.length, totalMinor: summarize(rows).totalMinor });
			}
		}
		return summaries.sort((a, b) => b.date.localeCompare(a.date));
	}

	async loadAll(trip: Trip): Promise<Expense[]> {
		const paths = await this.files.listMarkdownPaths(datesFolderPath(trip.folderPath, this.files.root));
		const dates = paths.map((path) => path.split('/').pop()?.replace(/\.md$/, '') ?? '').filter(isDateKey);
		const groups = await Promise.all(dates.map((date) => this.loadDay(trip, date)));
		return groups.flat();
	}
}
