import { App, Modal, Notice, Setting } from 'obsidian';
import { BUILT_IN_CATEGORIES, categoryName } from '../model/categories';
import type { CustomCategory } from '../model/types';
import { t, type Language } from '../i18n';

export function selectableCategories(categories: CustomCategory[], currentId?: string): { id: string; name: string }[] {
	return [
		...BUILT_IN_CATEGORIES.map((id) => ({ id, name: id })),
		...categories.filter((entry) => !entry.archived || entry.id === currentId).map((entry) => ({ id: entry.id, name: entry.name })),
		...(currentId && !BUILT_IN_CATEGORIES.some((id) => id === currentId) &&
			!categories.some((entry) => entry.id === currentId) ? [{ id: currentId, name: currentId }] : []),
	];
}

export function categoryOptions(categories: CustomCategory[], language: Language, currentId?: string): { id: string; name: string }[] {
	return selectableCategories(categories, currentId).map((entry) => ({
		id: entry.id,
		name: categoryName(entry.id, categories, language),
	}));
}

export class AddCategoryModal extends Modal {
	private name: string;

	constructor(
		app: App,
		private language: Language,
		private onAdd: (name: string) => Promise<void>,
		initialName = '',
		private title: 'addCategory' | 'rename' = 'addCategory',
	) {
		super(app);
		this.name = initialName;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: t(this.title, this.language) });
		new Setting(contentEl).setName(t('categoryName', this.language)).addText((text) => text
			.setValue(this.name)
			.onChange((value) => { this.name = value; }));
		new Setting(contentEl)
			.addButton((button) => button.setButtonText(t('cancel', this.language)).onClick(() => this.close()))
			.addButton((button) => button.setCta().setButtonText(t('save', this.language)).onClick(async () => {
				try {
					await this.onAdd(this.name);
					this.close();
				} catch (error) {
					new Notice(`${t('failed', this.language)} ${error instanceof Error ? error.message : String(error)}`);
				}
			}));
	}
}
