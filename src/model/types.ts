export interface Trip {
	id: string;
	name: string;
	currency: string;
	currencyLocked: boolean;
	folderPath: string;
}

export interface Expense {
	id: string;
	date: string;
	item: string;
	amountMinor: number;
	place: string;
	categoryId: string;
}

export interface DaySummary {
	date: string;
	count: number;
	totalMinor: number;
}

export interface CustomCategory {
	id: string;
	name: string;
	archived: boolean;
}
