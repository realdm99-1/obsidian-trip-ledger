import { categoryName } from '../model/categories';
import { categoryPercent, summarize } from '../model/aggregate';
import { formatAmountMinor } from '../model/money';
import type { CustomCategory, Expense } from '../model/types';
import { t, type Language } from '../i18n';

export function renderStatsPanel(
	container: HTMLElement,
	expenses: Expense[],
	categories: CustomCategory[],
	currency: string,
	language: Language,
): void {
	const section = container.createDiv({ cls: 'trip-ledger-stats' });
	const summary = summarize(expenses);
	section.createEl('h3', { text: t('tripTotal', language) });
	section.createEl('p', { cls: 'trip-ledger-total', text: formatAmountMinor(summary.totalMinor, currency, language) });
	if (summary.totalMinor === 0) {
		section.createEl('p', { text: t('noStats', language) });
		return;
	}
	section.createEl('h4', { text: t('byCategory', language) });
	for (const [id, amount] of [...summary.byCategory.entries()].sort((a, b) => b[1] - a[1])) {
		const percent = categoryPercent(amount, summary.totalMinor);
		const row = section.createDiv({ cls: 'trip-ledger-stat-row' });
		row.createDiv({ text: categoryName(id, categories, language) });
		row.createDiv({ text: `${formatAmountMinor(amount, currency, language)} · ${percent.toFixed(1)}%` });
		const track = row.createDiv({ cls: 'trip-ledger-stat-track' });
		const bar = track.createDiv({ cls: 'trip-ledger-stat-bar' });
		bar.style.width = `${percent}%`;
	}
	section.createEl('h4', { text: t('byPlace', language) });
	const list = section.createEl('ul', { cls: 'trip-ledger-place-list' });
	for (const [place, amount] of [...summary.byPlace.entries()].sort((a, b) => b[1] - a[1])) {
		list.createEl('li', { text: `${place}: ${formatAmountMinor(amount, currency, language)}` });
	}
}
