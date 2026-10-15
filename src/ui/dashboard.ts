import { t, type Language } from '../i18n';
import { summarize } from '../model/aggregate';
import { isDateKey } from '../model/dates';
import { formatAmountMinor } from '../model/money';
import type { CustomCategory, DaySummary, Expense, Trip } from '../model/types';
import { renderDayTable } from './day-table';

export interface DashboardData {
	trip: Trip;
	language: Language;
	today: string;
	todayRows: Expense[];
	summaries: DaySummary[];
	categories: CustomCategory[];
	showStats: boolean;
}

export interface DashboardActions {
	onAdd: () => void;
	onEdit: (expense: Expense) => void;
	onDelete: (expense: Expense) => void;
	onOpenDate: (date: string) => void;
	onToggleStats: () => void;
}

export function renderDashboard(container: HTMLElement, data: DashboardData, actions: DashboardActions): void {
	const { language, trip, today } = data;
	const todaySection = container.createDiv({ cls: 'trip-ledger-dashboard-today' });
	todaySection.createEl('h3', { text: t('today', language) });
	todaySection.createEl('p', { text: today });
	const todayActions = todaySection.createDiv({ cls: 'trip-ledger-actions' });
	todayActions.createEl('button', { cls: 'mod-cta', text: t('addExpense', language) })
		.addEventListener('click', actions.onAdd);
	todayActions.createEl('button', { text: t('todayDetails', language) })
		.addEventListener('click', () => actions.onOpenDate(today));
	todaySection.createEl('p', {
		cls: 'trip-ledger-total',
		text: `${t('dailyTotal', language)}: ${formatAmountMinor(summarize(data.todayRows).totalMinor, trip.currency, language)}`,
	});
	renderDayTable(todaySection, data.todayRows, trip.currency, language, data.categories,
		actions.onEdit, actions.onDelete);

	const history = container.createDiv({ cls: 'trip-ledger-dashboard-history' });
	history.createEl('h3', { text: t('recentDates', language) });
	const recorded = data.summaries.filter((day) => day.date !== today);
	if (recorded.length === 0) history.createEl('p', { text: t('noRecordedDates', language) });
	for (const summary of recorded) {
		const count = t(summary.count === 1 ? 'expenseCountOne' : 'expenseCountMany', language)
			.replace('{count}', String(summary.count));
		const total = formatAmountMinor(summary.totalMinor, trip.currency, language);
		history.createEl('button', {
			cls: 'trip-ledger-date-entry',
			text: `${summary.date} · ${count} · ${total}`,
		}).addEventListener('click', () => actions.onOpenDate(summary.date));
	}
	const datePicker = container.createDiv({ cls: 'trip-ledger-date-toolbar' });
	const dateInput = datePicker.createEl('input', { type: 'date', attr: { 'aria-label': t('date', language) } });
	datePicker.createEl('button', { text: t('openDate', language) }).addEventListener('click', () => {
		if (isDateKey(dateInput.value)) actions.onOpenDate(dateInput.value);
	});
	container.createEl('button', { text: t(data.showStats ? 'hideStats' : 'showStats', language) })
		.addEventListener('click', actions.onToggleStats);
}
