import { categoryName } from '../model/categories';
import { categoryPercent, summarize, type ExpenseSummary } from '../model/aggregate';
import { formatAmountMinor } from '../model/money';
import type { CustomCategory, Expense } from '../model/types';
import { t, type Language } from '../i18n';

export type StatsBreakdown = 'category' | 'date' | 'place';

export interface StatsPanelOptions {
	selected?: StatsBreakdown;
	onSelect?: (breakdown: StatsBreakdown) => void;
}

function categoryColor(index: number): string {
	return `hsl(${Math.round(index * 137.508) % 360} 65% 48%)`;
}

function renderCategoryPanel(
	panel: HTMLElement, summary: ExpenseSummary, categories: CustomCategory[], currency: string, language: Language,
): void {
	const entries = [...summary.byCategory.entries()].sort((a, b) => b[1] - a[1]);
	let cumulative = 0;
	const stops = entries.map(([, amount], index) => {
		const start = cumulative / summary.totalMinor * 100;
		cumulative += amount;
		const end = cumulative / summary.totalMinor * 100;
		return `${categoryColor(index)} ${start}% ${end}%`;
	});
	const donut = panel.createDiv({ cls: 'trip-ledger-stat-donut', attr: { 'aria-hidden': 'true' } });
	donut.style.background = `conic-gradient(${stops.join(', ')})`;
	for (const [index, [id, amount]] of entries.entries()) {
		const percent = categoryPercent(amount, summary.totalMinor);
		const color = categoryColor(index);
		const row = panel.createDiv({ cls: 'trip-ledger-stat-row' });
		const label = row.createDiv({ cls: 'trip-ledger-stat-label' });
		label.createDiv({ cls: 'trip-ledger-stat-swatch', attr: { 'aria-hidden': 'true' } }).style.background = color;
		label.createSpan({ text: categoryName(id, categories, language) });
		row.createDiv({ cls: 'trip-ledger-stat-value',
			text: `${formatAmountMinor(amount, currency, language)} · ${percent.toFixed(1)}%` });
		const track = row.createDiv({ cls: 'trip-ledger-stat-track', attr: { 'aria-hidden': 'true' } });
		const bar = track.createDiv({ cls: 'trip-ledger-stat-bar' });
		bar.style.width = `${percent}%`;
		bar.style.background = color;
	}
}

function renderBarPanel(panel: HTMLElement, entries: [string, number][], currency: string, language: Language): void {
	const maximum = entries.reduce((largest, [, amount]) => Math.max(largest, amount), 0);
	for (const [label, amount] of entries) {
		const row = panel.createDiv({ cls: 'trip-ledger-stat-row' });
		row.createDiv({ cls: 'trip-ledger-stat-label', text: label });
		row.createDiv({ cls: 'trip-ledger-stat-value', text: formatAmountMinor(amount, currency, language) });
		const track = row.createDiv({ cls: 'trip-ledger-stat-track', attr: { 'aria-hidden': 'true' } });
		const bar = track.createDiv({ cls: 'trip-ledger-stat-bar' });
		bar.style.width = `${categoryPercent(amount, maximum)}%`;
	}
}

export function renderStatsPanel(
	container: HTMLElement,
	expenses: Expense[],
	categories: CustomCategory[],
	currency: string,
	language: Language,
	options: StatsPanelOptions = {},
): void {
	const section = container.createDiv({ cls: 'trip-ledger-stats' });
	const summary = summarize(expenses);
	section.createEl('h3', { text: t('tripTotal', language) });
	section.createEl('p', { cls: 'trip-ledger-total', text: formatAmountMinor(summary.totalMinor, currency, language) });
	if (summary.totalMinor === 0) {
		section.createEl('p', { text: t('noStats', language) });
		return;
	}

	const tabBar = section.createDiv({ cls: 'trip-ledger-stat-tabs', attr: {
		role: 'group', 'aria-label': t('statsBreakdown', language),
	} });
	const breakdowns: { kind: StatsBreakdown; label: string }[] = [
		{ kind: 'category', label: t('byCategory', language) },
		{ kind: 'date', label: t('byDate', language) },
		{ kind: 'place', label: t('byPlace', language) },
	];
	const selectedBreakdown = options.selected ?? 'category';
	const tabs: HTMLButtonElement[] = [];
	const panels: HTMLElement[] = [];
	for (const { kind, label } of breakdowns) {
		const tab = tabBar.createEl('button', { cls: 'trip-ledger-stat-tab', text: label,
			attr: { type: 'button', 'aria-pressed': kind === selectedBreakdown ? 'true' : 'false' } });
		const panel = section.createDiv({ cls: 'trip-ledger-stat-panel',
			attr: { role: 'region', 'aria-label': label } });
		panel.hidden = kind !== selectedBreakdown;
		let rendered = false;
		const renderPanel = (): void => {
			if (rendered) return;
			if (kind === 'category') renderCategoryPanel(panel, summary, categories, currency, language);
			else if (kind === 'date') renderBarPanel(panel,
				[...summary.byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])), currency, language);
			else renderBarPanel(panel,
				[...summary.byPlace.entries()].sort((a, b) => b[1] - a[1]), currency, language);
			rendered = true;
		};
		tab.addEventListener('click', () => {
			options.onSelect?.(kind);
			for (const [index, button] of tabs.entries()) {
				const selected = button === tab;
				button.setAttribute('aria-pressed', String(selected));
				panels[index]!.hidden = !selected;
			}
			renderPanel();
		});
		tabs.push(tab);
		panels.push(panel);
		if (kind === selectedBreakdown) renderPanel();
	}
}
