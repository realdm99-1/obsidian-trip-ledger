import { Notice, Setting } from 'obsidian';
import type TripLedgerPlugin from '../main';
import { t, type Language } from '../i18n';
import { tripListLabel } from '../model/trip-label';
import { TripModal } from './trip-modal';
import { beginSettingRequest } from './setting-request';

export function configureNewTripSetting(
	setting: Setting,
	plugin: TripLedgerPlugin,
	language: Language,
	redisplay: () => void,
): void {
	setting.addButton((button) => button.setCta().setButtonText(t('newTrip', language)).onClick(() => {
		new TripModal(plugin.app, language, async (name, currency) => {
			const created = await plugin.tripStore.createTrip(name, currency);
			try {
				if (!await plugin.selectCurrentTrip(created.folderPath)) {
					new Notice(t('tripCreatedSelectionFailed', language));
				}
			} catch (error) {
				new Notice(`${t('tripCreatedSelectionFailed', language)} ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				redisplay();
			}
		}).open();
	}));
}

export async function configureTripFolderSetting(
	setting: Setting,
	plugin: TripLedgerPlugin,
	language: Language,
	redisplay: () => void,
): Promise<void> {
	const isCurrent = beginSettingRequest(setting);
	setting.setName(t('selectTripFolder', language));
	try {
		const candidates = await plugin.tripStore.listTripCandidates();
		if (!isCurrent()) return;
		setting.clear().setDesc('');
		const validTrips = candidates.flatMap((candidate) => candidate.trip ? [candidate.trip] : []);
		const matching = candidates.filter((candidate) => candidate.idHint === plugin.settings.lastSelectedTripId);
		const currentFolderPath = matching.length === 1 ? matching[0]!.folderPath : '';
		let inProgress = false;
		setting.addDropdown((dropdown) => {
			dropdown.addOption('', t('selectTripFolder', language));
			for (const candidate of candidates) {
				const label = candidate.trip
					? `${tripListLabel(candidate.trip, validTrips)} · ${candidate.folderPath}`
					: candidate.folderPath;
				dropdown.addOption(candidate.folderPath, label);
			}
			dropdown.setValue(currentFolderPath);
			dropdown.onChange(async (path) => {
				if (!path || inProgress) return;
				inProgress = true;
				try {
					if (!await plugin.selectCurrentTrip(path)) new Notice(t('invalidTripFolder', language));
				} catch (error) {
					new Notice(`${t('failed', language)} ${error instanceof Error ? error.message : String(error)}`);
				} finally {
					redisplay();
				}
			});
		});
		const errors = candidates.filter((candidate) => candidate.error)
			.map((candidate) => `${candidate.folderPath}: ${candidate.error}`);
		if (errors.length > 0) setting.setDesc(errors.join('; '));
	} catch (error) {
		if (isCurrent()) setting.clear().setDesc(`${t('fileError', language)} ${error instanceof Error ? error.message : String(error)}`);
	}
}

export async function renderTripSettings(
	containerEl: HTMLElement,
	plugin: TripLedgerPlugin,
	language: Language,
	redisplay: () => void,
): Promise<void> {
	const section = containerEl.createDiv({ cls: 'trip-ledger-trip-settings' });
	new Setting(section).setName(t('currentTrip', language)).setHeading();
	configureNewTripSetting(new Setting(section), plugin, language, redisplay);
	await configureTripFolderSetting(new Setting(section), plugin, language, redisplay);
}
