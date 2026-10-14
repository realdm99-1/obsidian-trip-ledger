export function todayLocal(): string {
	const now = new Date();
	return `${now.getFullYear().toString().padStart(4, '0')}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
}

export function isDateKey(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function shiftDateKey(value: string, days: number): string {
	if (!isDateKey(value) || !Number.isInteger(days)) throw new Error('Invalid date shift');
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(0);
	date.setUTCFullYear(year!, month! - 1, day! + days);
	return date.toISOString().slice(0, 10);
}
