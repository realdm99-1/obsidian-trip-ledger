import { Notice, Setting } from 'obsidian';
import type TripLedgerPlugin from '../main';
import { t, type Language } from '../i18n';
import type { CustomCategory } from '../model/types';
import { AddCategoryModal } from './category-controls';

export function configureCategorySetting(
	setting: Setting,
	category: CustomCategory,
	plugin: TripLedgerPlugin,
	language: Language,
	redisplay: () => void,
): void {
	setting.setName(category.name)
		.setDesc(category.archived ? t('hidden', language) : '')
		.addButton((button) => button.setButtonText(t('rename', language)).onClick(() => {
			new AddCategoryModal(plugin.app, language, async (name) => {
				await plugin.categoryStore.rename(category.id, name);
				redisplay();
				plugin.refreshViews();
			}, category.name, 'rename').open();
		}))
		.addButton((button) => button.setButtonText(t(category.archived ? 'restore' : 'hide', language)).onClick(async () => {
			try {
				await plugin.categoryStore.setArchived(category.id, !category.archived);
				redisplay();
				plugin.refreshViews();
			} catch (error) {
				new Notice(`${t('failed', language)} ${error instanceof Error ? error.message : String(error)}`);
			}
		}));
}

export function configureAddCategorySetting(
	setting: Setting,
	plugin: TripLedgerPlugin,
	language: Language,
	redisplay: () => void,
): void {
	setting.addButton((button) => button.setCta().setButtonText(t('addCategory', language)).onClick(() => {
		new AddCategoryModal(plugin.app, language, async (name) => {
			await plugin.categoryStore.add(name);
			redisplay();
			plugin.refreshViews();
		}).open();
	}));
}
