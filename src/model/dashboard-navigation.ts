export type LedgerScreen = { kind: 'dashboard' } | { kind: 'day'; date: string };

export function screenAfterSave(screen: LedgerScreen, savedDate: string, today: string): LedgerScreen {
	return screen.kind === 'dashboard' && savedDate === today
		? screen : { kind: 'day', date: savedDate };
}
