import { App, Modal, Notice, Setting } from 'obsidian';
import { categoryOptions, AddCategoryModal } from './category-controls';
import { validateExpenseDraft, type ExpenseDraft } from '../model/expense-input';
import { amountInputValue } from '../model/money';
import type { CustomCategory, Expense, Trip } from '../model/types';
import type { CategoryStore } from '../storage/category-store';
import { t, type Language } from '../i18n';

export class ExpenseModal extends Modal {
	private draft: ExpenseDraft;
	private categories: CustomCategory[];

	constructor(
		app: App,
		private language: Language,
		private trip: Trip,
		date: string,
		categories: CustomCategory[],
		private categoryStore: CategoryStore,
		private onSave: (expense: Expense, expected?: Expense) => Promise<void>,
		private existing?: Expense,
	) {
		super(app);
		this.categories = categories;
		this.draft = {
			date: existing?.date ?? date,
			item: existing?.item ?? '',
			amount: existing ? amountInputValue(existing.amountMinor, trip.currency) : '',
			place: existing?.place ?? '',
			categoryId: existing?.categoryId ?? 'food',
		};
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: t(this.existing ? 'editExpense' : 'addExpense', this.language) });
		new Setting(contentEl).setName(t('date', this.language)).addText((text) => {
			text.inputEl.type = 'date';
			text.setValue(this.draft.date).onChange((value) => { this.draft.date = value; });
		});
		new Setting(contentEl).setName(t('item', this.language)).addText((text) => text
			.setValue(this.draft.item).onChange((value) => { this.draft.item = value; }));
		new Setting(contentEl).setName(t('amount', this.language)).addText((text) => {
			text.inputEl.inputMode = 'decimal';
			text.setValue(this.draft.amount).onChange((value) => { this.draft.amount = value; });
		});
		new Setting(contentEl).setName(t('place', this.language)).addText((text) => text
			.setValue(this.draft.place).onChange((value) => { this.draft.place = value; }));
		new Setting(contentEl).setName(t('category', this.language))
			.addDropdown((dropdown) => {
				for (const entry of categoryOptions(this.categories, this.language, this.existing?.categoryId)) {
					dropdown.addOption(entry.id, entry.name);
				}
				dropdown.setValue(this.draft.categoryId).onChange((value) => { this.draft.categoryId = value; });
			})
			.addButton((button) => button.setButtonText(t('addCategory', this.language)).onClick(() => {
				new AddCategoryModal(this.app, this.language, async (name) => {
					const added = await this.categoryStore.add(name);
					this.categories = await this.categoryStore.list();
					this.draft.categoryId = added.id;
					this.onOpen();
				}).open();
			}));
		new Setting(contentEl)
			.addButton((button) => button.setButtonText(t('cancel', this.language)).onClick(() => this.close()))
			.addButton((button) => button.setCta().setButtonText(t('save', this.language)).onClick(async () => {
				try {
					const validated = validateExpenseDraft(this.draft, this.trip.currency, this.categories, this.existing?.categoryId);
					const expense: Expense = { ...validated, id: this.existing?.id ?? crypto.randomUUID().replace(/-/g, '') };
					await this.onSave(expense, this.existing);
					this.close();
				} catch (error) {
					new Notice(`${t('failed', this.language)} ${error instanceof Error ? error.message : String(error)}`);
				}
			}));
	}
}

export class ConfirmDeleteModal extends Modal {
	constructor(app: App, private language: Language, private onDelete: () => Promise<void>) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl('h2', { text: t('deleteConfirm', this.language) });
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(t('cancel', this.language)).onClick(() => this.close()))
			.addButton((button) => button.setWarning().setButtonText(t('delete', this.language)).onClick(async () => {
				try {
					await this.onDelete();
					this.close();
				} catch (error) {
					new Notice(`${t('failed', this.language)} ${error instanceof Error ? error.message : String(error)}`);
				}
			}));
	}
}
