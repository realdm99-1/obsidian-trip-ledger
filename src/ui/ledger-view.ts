import { ItemView, Notice, TFile, type TAbstractFile, WorkspaceLeaf } from 'obsidian';
import type TripLedgerPlugin from '../main';
import { t } from '../i18n';
import type { CustomCategory, Expense, Trip } from '../model/types';
import { isDateKey, shiftDateKey, todayLocal } from '../model/dates';
import { summarize } from '../model/aggregate';
import { formatAmountMinor } from '../model/money';
import { touchesLedgerRoot } from '../model/ledger-change';
import { dayPath } from '../storage/paths';
import { TripModal } from './trip-modal';
import { ConfirmDeleteModal, ExpenseModal } from './expense-modal';
import { renderDayTable } from './day-table';
import { renderStatsPanel } from './stats-panel';

export const LEDGER_VIEW_TYPE = 'trip-ledger-view';

export class LedgerView extends ItemView {
	private selectedDate = todayLocal();
	private generation = 0;
	private showStats = false;
	private refreshTimer: number | null = null;
	private recentDatesCache = new Map<string, string[]>();

	constructor(leaf: WorkspaceLeaf, private plugin: TripLedgerPlugin) {
		super(leaf);
	}

	clearRootCache(): void {
		this.recentDatesCache.clear();
	}

	getViewType(): string { return LEDGER_VIEW_TYPE; }
	getDisplayText(): string { return t('pluginName', this.plugin.settings.language); }
	getIcon(): string { return 'wallet'; }

	async onOpen(): Promise<void> {
		const onChanged = (file: TAbstractFile, oldPath?: string): void => {
			if (!touchesLedgerRoot(file.path, oldPath, this.plugin.files.root)) return;
			this.recentDatesCache.clear();
			if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
			this.refreshTimer = window.setTimeout(() => {
				this.refreshTimer = null;
				void this.render();
			}, 150);
		};
		this.registerEvent(this.app.vault.on('modify', onChanged));
		this.registerEvent(this.app.vault.on('create', onChanged));
		this.registerEvent(this.app.vault.on('delete', onChanged));
		this.registerEvent(this.app.vault.on('rename', onChanged));
		this.register(() => {
			if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		});
		await this.render();
	}

	async render(): Promise<void> {
		const generation = ++this.generation;
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('trip-ledger-view');
		contentEl.createEl('h2', { text: t('pluginName', this.plugin.settings.language) });
		try {
			const candidates = await this.plugin.tripStore.listTripCandidates();
			if (generation !== this.generation) return;
			const state = this.plugin.tripSelection.resolve(candidates);
			if (state.kind === 'ready') {
				await this.renderTripDetails(state.trip, generation);
			} else if (state.kind === 'invalid') {
				contentEl.createEl('p', { cls: 'trip-ledger-error',
					text: `${t('selectTripInSettings', this.plugin.settings.language)} ${state.folderPath}: ${state.error}` });
			} else {
				contentEl.createEl('p', { text: t(state.kind === 'create' ? 'createTripInSettings' : 'selectTripInSettings',
					this.plugin.settings.language) });
			}
		} catch (error) {
			if (generation !== this.generation) return;
			contentEl.createEl('p', { cls: 'trip-ledger-error', text: `${t('fileError', this.plugin.settings.language)} ${error instanceof Error ? error.message : String(error)}` });
		}
	}

	private async renderTripDetails(trip: Trip, generation: number): Promise<void> {
		const language = this.plugin.settings.language;
		const header = this.contentEl.createDiv({ cls: 'trip-ledger-trip-header' });
		header.createEl('h3', { text: trip.name });
		const settings = header.createEl('button', { text: t('tripSettings', language) });
		settings.addEventListener('click', () => {
			new TripModal(this.app, language, async (name, currency) => {
				await this.plugin.tripStore.updateTripDetails(trip, name, currency);
				new Notice(t('tripSaved', language));
				await this.render();
			}, trip).open();
		});
		const toolbar = this.contentEl.createDiv({ cls: 'trip-ledger-date-toolbar' });
		const previous = toolbar.createEl('button', { text: '‹', attr: { 'aria-label': t('previousDay', language) } });
		previous.addEventListener('click', () => { this.selectedDate = shiftDateKey(this.selectedDate, -1); void this.render(); });
		const dateInput = toolbar.createEl('input', { type: 'date', attr: { 'aria-label': t('date', language) } });
		dateInput.value = this.selectedDate;
		dateInput.addEventListener('change', () => {
			if (isDateKey(dateInput.value)) { this.selectedDate = dateInput.value; void this.render(); }
		});
		const next = toolbar.createEl('button', { text: '›', attr: { 'aria-label': t('nextDay', language) } });
		next.addEventListener('click', () => { this.selectedDate = shiftDateKey(this.selectedDate, 1); void this.render(); });
		const all = this.showStats ? await this.plugin.expenseStore.loadAll(trip) : null;
		const cachedDates = this.recentDatesCache.get(trip.id);
		const [rows, dates, categories] = await Promise.all([
			all ? Promise.resolve(all.filter((expense) => expense.date === this.selectedDate))
				: this.plugin.expenseStore.loadDay(trip, this.selectedDate),
			all ? Promise.resolve([...new Set(all.map((expense) => expense.date))].sort().reverse())
				: cachedDates ? Promise.resolve(cachedDates) : this.plugin.expenseStore.listDates(trip),
			this.plugin.categoryStore.list(),
		]);
		if (generation !== this.generation) return;
		this.recentDatesCache.set(trip.id, dates);
		if (dates.length > 0) this.renderRecentDates(toolbar, dates);
		const actions = this.contentEl.createDiv({ cls: 'trip-ledger-actions' });
		const add = actions.createEl('button', { cls: 'mod-cta', text: t('addExpense', language) });
		add.addEventListener('click', () => this.openExpenseModal(trip, categories));
		const note = actions.createEl('button', { text: t('openDayNote', language) });
		note.disabled = this.app.vault.getAbstractFileByPath(dayPath(trip.folderPath, this.selectedDate, this.plugin.files.root)) === null;
		note.addEventListener('click', () => {
			const file = this.app.vault.getAbstractFileByPath(dayPath(trip.folderPath, this.selectedDate, this.plugin.files.root));
			if (file instanceof TFile) void this.app.workspace.getLeaf(true).openFile(file);
			else new Notice(t('noDateNote', language));
		});
		this.contentEl.createEl('p', {
			cls: 'trip-ledger-total',
			text: `${t('dailyTotal', language)}: ${formatAmountMinor(summarize(rows).totalMinor, trip.currency, language)}`,
		});
		renderDayTable(this.contentEl, rows, trip.currency, language, categories,
			(expense) => this.openExpenseModal(trip, categories, expense),
			(expense) => this.confirmDelete(trip, expense));
		const statsButton = this.contentEl.createEl('button', { text: t(this.showStats ? 'hideStats' : 'showStats', language) });
		statsButton.addEventListener('click', () => { this.showStats = !this.showStats; void this.render(); });
		if (this.showStats) {
			renderStatsPanel(this.contentEl, all ?? [], categories, trip.currency, language);
		}
	}

	private renderRecentDates(container: HTMLElement, dates: string[]): void {
		const language = this.plugin.settings.language;
		const select = container.createEl('select', { attr: { 'aria-label': t('recentDates', language) } });
		select.createEl('option', { text: t('recentDates', language), value: '' });
		for (const date of dates) select.createEl('option', { text: date, value: date });
		select.addEventListener('change', () => {
			if (isDateKey(select.value)) { this.selectedDate = select.value; void this.render(); }
		});
	}

	private openExpenseModal(trip: Trip, categories: CustomCategory[], existing?: Expense): void {
		new ExpenseModal(this.app, this.plugin.settings.language, trip, this.selectedDate, categories,
			this.plugin.categoryStore, async (expense, expected) => {
				const result = expected && expected.date !== expense.date
					? await this.plugin.expenseStore.moveDate(trip, expense, expected.date, expected)
					: await this.plugin.expenseStore.upsert(trip, expense, expected);
				this.selectedDate = expense.date;
				await this.render();
				if (result.warning) new Notice(`${t('expenseSavedLockWarning', this.plugin.settings.language)} ${result.warning}`);
			}, existing).open();
	}

	private confirmDelete(trip: Trip, expense: Expense): void {
		new ConfirmDeleteModal(this.app, this.plugin.settings.language, async () => {
			await this.plugin.expenseStore.remove(trip, expense.id, expense.date, expense);
			await this.render();
		}).open();
	}
}
