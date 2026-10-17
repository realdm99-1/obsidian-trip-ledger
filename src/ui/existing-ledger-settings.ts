import { Notice, Setting } from 'obsidian';
import type TripLedgerPlugin from '../main';
import { t, type Language } from '../i18n';
import { beginSettingRequest } from './setting-request';

export async function configureExistingLedgerSetting(
	setting: Setting,
	plugin: TripLedgerPlugin,
	language: Language,
	redisplay: () => void,
): Promise<void> {
	const isCurrent = beginSettingRequest(setting);
	setting.setName(t('selectLedger', language));
	try {
		const candidates = await plugin.ledgerDiscovery.list();
		if (!isCurrent()) return;
		setting.clear().setDesc('');
		if (candidates.length === 0) {
			setting.setDesc(t('noExistingLedgers', language));
			return;
		}
		let selectedRoot = candidates.some((candidate) => candidate.root === plugin.files.root)
			? plugin.files.root : candidates[0]!.root;
		let inProgress = false;
		setting.addDropdown((dropdown) => {
				for (const candidate of candidates) dropdown.addOption(candidate.root, candidate.root);
				dropdown.setValue(selectedRoot);
				dropdown.onChange((value) => { selectedRoot = value; });
			})
			.addButton((button) => button.setButtonText(t('selectLedger', language)).onClick(async () => {
				if (inProgress) return;
				inProgress = true;
				button.setDisabled(true);
				try {
					await plugin.selectExistingLedger(selectedRoot);
					new Notice(t('ledgerSelected', language));
				} catch (error) {
					new Notice(`${t('ledgerSelectFailed', language)} ${error instanceof Error ? error.message : String(error)}`);
				} finally {
					inProgress = false;
					button.setDisabled(false);
					redisplay();
				}
			}));
	} catch (error) {
		if (isCurrent()) setting.clear().setDesc(`${t('fileError', language)} ${error instanceof Error ? error.message : String(error)}`);
	}
}

export async function renderExistingLedgerSettings(
	containerEl: HTMLElement,
	plugin: TripLedgerPlugin,
	language: Language,
	redisplay: () => void,
): Promise<void> {
	const section = containerEl.createDiv({ cls: 'trip-ledger-existing-settings' });
	new Setting(section).setName(t('existingLedger', language)).setHeading();
	await configureExistingLedgerSetting(new Setting(section), plugin, language, redisplay);
}
