function fractionDigits(currency: string): number {
	const digits = new Intl.NumberFormat('en', {
		style: 'currency',
		currency,
	}).resolvedOptions().maximumFractionDigits;
	if (digits === undefined) throw new Error('Currency precision unavailable');
	return digits;
}

export function parseAmountMinor(raw: string, currency: string): number {
	const value = raw.trim();
	const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
	if (!match) throw new Error('Invalid amount');
	const digits = fractionDigits(currency);
	const fraction = match[2] ?? '';
	if (fraction.length > digits) throw new Error('Too many decimal places');
	const whole = BigInt(match[1] ?? '0');
	const minor = whole * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
	if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error('Amount out of range');
	}
	return Number(minor);
}

export function formatAmountMinor(amountMinor: number, currency: string, locale: string): string {
	if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error('Invalid amount');
	const digits = fractionDigits(currency);
	const text = amountMinor.toString().padStart(digits + 1, '0');
	const decimal = digits === 0 ? text : `${text.slice(0, -digits)}.${text.slice(-digits)}`;
	// Intl.NumberFormat accepts decimal strings exactly, while ES2021 types still declare only numbers.
	const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
	return formatter.format(decimal as unknown as number);
}

export function amountInputValue(amountMinor: number, currency: string): string {
	if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error('Invalid amount');
	const digits = fractionDigits(currency);
	const text = amountMinor.toString().padStart(digits + 1, '0');
	return digits === 0 ? text : `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}
