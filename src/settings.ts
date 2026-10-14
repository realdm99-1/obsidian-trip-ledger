import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type TripLedgerPlugin from './main';
import { t, type Language } from './i18n';
import { AddCategoryModal } from './ui/category-controls';
import { renderTripSettings } from './ui/trip-settings';
import { renderExistingLedgerSettings } from './ui/existing-ledger-settings';

export interface TripLedgerSettings {
	language: Language;
	ledgerRoot: string;
	pendingLedgerRoot?: string;
	lastSelectedTripId: string | null;
}

export const DEFAULT_SETTINGS: TripLedgerSettings = {
	language: 'ko',
	ledgerRoot: 'Trip Ledger',
	lastSelectedTripId: null,
};

export class TripLedgerSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: TripLedgerPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const language = this.plugin.settings.language;
		containerEl.empty();
		new Setting(containerEl)
			.setName(t('language', language))
			.setDesc(t('languageDesc', language))
			.addDropdown((dropdown) => dropdown
				.addOption('ko', '한국어')
				.addOption('en', 'English')
				.setValue(language)
				.onChange(async (value) => {
					try {
						await this.plugin.updateSettings({ language: value === 'en' ? 'en' : 'ko' });
						this.display();
						this.plugin.refreshViews();
					} catch (error) {
						this.display();
						new Notice(`${t('failed', language)} ${error instanceof Error ? error.message : String(error)}`);
					}
				}));
		if (this.plugin.rootRecoveryWarning) {
			containerEl.createEl('p', {
				cls: 'trip-ledger-error',
				text: `${t('folderRecoveryWarning', language)} ${this.plugin.rootRecoveryWarning}`,
			});
		}
		let requestedName = this.plugin.files.root;
		let inProgress = false;
		new Setting(containerEl)
			.setName(t('ledgerFolder', language))
			.setDesc(t('ledgerFolderDesc', language))
			.addText((text) => text
				.setValue(requestedName)
				.onChange((value) => { requestedName = value; }))
			.addButton((button) => button
				.setButtonText(t('renameFolder', language))
				.onClick(async () => {
					if (inProgress) return;
					inProgress = true;
					button.setDisabled(true);
					try {
						await this.plugin.renameLedgerRoot(requestedName);
						new Notice(t('folderRenamed', language));
						this.display();
					} catch (error) {
						this.display();
						new Notice(`${t('folderRenameFailed', language)} ${error instanceof Error ? error.message : String(error)}`);
					} finally {
						inProgress = false;
						button.setDisabled(false);
					}
				}));
		void renderExistingLedgerSettings(containerEl, this.plugin, language, () => this.display());
		void renderTripSettings(containerEl, this.plugin, language, () => this.display());
		void this.renderCategories(containerEl, language);
	}

	private async renderCategories(containerEl: HTMLElement, language: Language): Promise<void> {
		const section = containerEl.createDiv({ cls: 'trip-ledger-category-settings' });
		new Setting(section).setName(t('categorySettings', language)).setHeading();
		section.createEl('p', { text: t('categorySettingsDesc', language) });
		try {
			const categories = await this.plugin.categoryStore.list();
			if (categories.length === 0) section.createEl('p', { text: t('noCustomCategories', language) });
			for (const category of categories) {
				new Setting(section)
					.setName(category.name)
					.setDesc(category.archived ? t('hidden', language) : '')
					.addButton((button) => button.setButtonText(t('rename', language)).onClick(() => {
						new AddCategoryModal(this.app, language, async (name) => {
							await this.plugin.categoryStore.rename(category.id, name);
							this.display();
							this.plugin.refreshViews();
						}, category.name, 'rename').open();
					}))
					.addButton((button) => button.setButtonText(t(category.archived ? 'restore' : 'hide', language)).onClick(async () => {
						try {
							await this.plugin.categoryStore.setArchived(category.id, !category.archived);
							this.display();
							this.plugin.refreshViews();
						} catch (error) {
							new Notice(`${t('failed', language)} ${error instanceof Error ? error.message : String(error)}`);
						}
					}));
			}
			new Setting(section).addButton((button) => button.setCta().setButtonText(t('addCategory', language)).onClick(() => {
				new AddCategoryModal(this.app, language, async (name) => {
					await this.plugin.categoryStore.add(name);
					this.display();
					this.plugin.refreshViews();
				}).open();
			}));
		} catch (error) {
			section.createEl('p', { cls: 'trip-ledger-error', text: `${t('fileError', language)} ${error instanceof Error ? error.message : String(error)}` });
		}
	}
}
