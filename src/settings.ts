import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type TripLedgerPlugin from './main';
import { t, type Language } from './i18n';
import type { CustomCategory } from './model/types';
import { configureAddCategorySetting, configureCategorySetting } from './ui/category-settings';
import { configureNewTripSetting, configureTripFolderSetting, renderTripSettings } from './ui/trip-settings';
import { configureExistingLedgerSetting, renderExistingLedgerSettings } from './ui/existing-ledger-settings';

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
	private cachedCategories: CustomCategory[] = [];
	private cachedCategoryRoot: string | null = null;
	private loadingCategoryRoot: string | null = null;
	private categoryLoadError: string | null = null;
	private categoryLoadGeneration = 0;

	constructor(app: App, private plugin: TripLedgerPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const language = this.plugin.settings.language;
		const root = this.plugin.files.root;
		const categories = this.cachedCategoryRoot === root ? this.cachedCategories : [];
		const definitions: SettingDefinitionItem[] = [
			{
				name: t('language', language),
				desc: t('languageDesc', language),
				render: (setting) => this.configureLanguageSetting(setting, language),
			},
			{
				name: t('ledgerFolder', language),
				desc: t('ledgerFolderDesc', language),
				render: (setting) => this.configureLedgerFolderSetting(setting, language),
			},
			{
				type: 'group',
				heading: t('existingLedger', language),
				items: [{
					name: t('selectLedger', language),
					aliases: [t('existingLedger', language)],
					render: (setting) => {
						void configureExistingLedgerSetting(setting, this.plugin, language, () => this.refreshCategorySettings());
					},
				}],
			},
			{
				type: 'group',
				heading: t('currentTrip', language),
				items: [
					{
						name: t('newTrip', language),
						render: (setting) => {
							setting.setName(t('newTrip', language));
							configureNewTripSetting(setting, this.plugin, language, () => this.redisplay());
						},
					},
					{
						name: t('selectTripFolder', language),
						render: (setting) => {
							void configureTripFolderSetting(setting, this.plugin, language, () => this.redisplay());
						},
					},
				],
			},
			{
				type: 'group',
				heading: t('categorySettings', language),
				items: [
					{
						name: t('addCategory', language),
						desc: this.categoryLoadError
							? `${t('fileError', language)} ${this.categoryLoadError}`
							: t('categorySettingsDesc', language),
						render: (setting) => {
							setting.setName(t('addCategory', language));
							setting.setDesc(this.categoryLoadError
								? `${t('fileError', language)} ${this.categoryLoadError}`
								: t('categorySettingsDesc', language));
							configureAddCategorySetting(setting, this.plugin, language, () => this.refreshCategorySettings());
						void this.ensureCategoryCacheLoaded();
						},
					},
					...categories.map((category) => ({
						name: category.name,
						render: (setting: Setting) => configureCategorySetting(
							setting, category, this.plugin, language, () => this.refreshCategorySettings(),
						),
					})),
				],
			},
		];
		if (this.plugin.rootRecoveryWarning) definitions.splice(1, 0, {
			name: t('folderRecoveryWarning', language),
			desc: this.plugin.rootRecoveryWarning,
			render: (setting) => {
				setting.setName(t('folderRecoveryWarning', language))
					.setDesc(this.plugin.rootRecoveryWarning ?? '');
			},
		});
		return definitions;
	}

	display(): void {
		this.renderLegacy();
	}

	private renderLegacy(): void {
		const { containerEl } = this;
		const language = this.plugin.settings.language;
		containerEl.empty();
		this.configureLanguageSetting(new Setting(containerEl), language);
		if (this.plugin.rootRecoveryWarning) {
			containerEl.createEl('p', {
				cls: 'trip-ledger-error',
				text: `${t('folderRecoveryWarning', language)} ${this.plugin.rootRecoveryWarning}`,
			});
		}
		this.configureLedgerFolderSetting(new Setting(containerEl), language);
		void renderExistingLedgerSettings(containerEl, this.plugin, language, () => this.refreshCategorySettings());
		void renderTripSettings(containerEl, this.plugin, language, () => this.redisplay());
		void this.renderCategories(containerEl, language);
	}

	private configureLanguageSetting(setting: Setting, language: Language): void {
		setting.setName(t('language', language))
			.setDesc(t('languageDesc', language))
			.addDropdown((dropdown) => dropdown
				.addOption('ko', '한국어')
				.addOption('en', 'English')
				.setValue(language)
				.onChange(async (value) => {
					try {
						await this.plugin.updateSettings({ language: value === 'en' ? 'en' : 'ko' });
						this.redisplay();
						this.plugin.refreshViews();
					} catch (error) {
						this.redisplay();
						new Notice(`${t('failed', language)} ${error instanceof Error ? error.message : String(error)}`);
					}
				}));
	}

	private configureLedgerFolderSetting(setting: Setting, language: Language): void {
		let requestedName = this.plugin.files.root;
		let inProgress = false;
		setting.setName(t('ledgerFolder', language))
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
						this.refreshCategorySettings();
					} catch (error) {
						this.redisplay();
						new Notice(`${t('folderRenameFailed', language)} ${error instanceof Error ? error.message : String(error)}`);
					} finally {
						inProgress = false;
						button.setDisabled(false);
					}
				}));
	}

	private redisplay(): void {
		const modernTab = this as { update?: () => void };
		if (typeof modernTab.update === 'function') modernTab.update();
		else this.renderLegacy();
	}

	private refreshCategorySettings(): void {
		this.categoryLoadGeneration++;
		this.cachedCategories = [];
		this.cachedCategoryRoot = null;
		this.loadingCategoryRoot = null;
		this.categoryLoadError = null;
		this.redisplay();
	}

	private async ensureCategoryCacheLoaded(): Promise<void> {
		const root = this.plugin.files.root;
		if (this.cachedCategoryRoot === root || this.loadingCategoryRoot === root) return;
		const generation = ++this.categoryLoadGeneration;
		this.loadingCategoryRoot = root;
		try {
			const categories = await this.plugin.categoryStore.list();
			if (this.plugin.files.root !== root || this.categoryLoadGeneration !== generation) return;
			this.cachedCategories = categories;
			this.cachedCategoryRoot = root;
			this.categoryLoadError = null;
		} catch (error) {
			if (this.plugin.files.root !== root || this.categoryLoadGeneration !== generation) return;
			this.cachedCategories = [];
			this.cachedCategoryRoot = root;
			this.categoryLoadError = error instanceof Error ? error.message : String(error);
		} finally {
			if (this.categoryLoadGeneration === generation) {
				this.loadingCategoryRoot = null;
				this.redisplay();
			}
		}
	}

	private async renderCategories(containerEl: HTMLElement, language: Language): Promise<void> {
		const section = containerEl.createDiv({ cls: 'trip-ledger-category-settings' });
		new Setting(section).setName(t('categorySettings', language)).setHeading();
		section.createEl('p', { text: t('categorySettingsDesc', language) });
		try {
			const categories = await this.plugin.categoryStore.list();
			if (categories.length === 0) section.createEl('p', { text: t('noCustomCategories', language) });
			for (const category of categories) {
				configureCategorySetting(new Setting(section), category, this.plugin, language, () => this.refreshCategorySettings());
			}
			configureAddCategorySetting(new Setting(section), this.plugin, language, () => this.refreshCategorySettings());
		} catch (error) {
			section.createEl('p', { cls: 'trip-ledger-error', text: `${t('fileError', language)} ${error instanceof Error ? error.message : String(error)}` });
		}
	}
}
