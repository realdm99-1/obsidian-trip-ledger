import { App, Modal, Notice, Setting } from 'obsidian';
import type { Trip } from '../model/types';
import { t, type Language } from '../i18n';

export class TripModal extends Modal {
	private name = '';
	private currency = 'KRW';

	constructor(
		app: App,
		private language: Language,
		private onSave: (name: string, currency: string) => Promise<void>,
		private trip?: Trip,
	) {
		super(app);
		if (trip) {
			this.name = trip.name;
			this.currency = trip.currency;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: t(this.trip ? 'tripSettings' : 'newTrip', this.language) });
		new Setting(contentEl).setName(t('tripName', this.language)).addText((text) => text
			.setValue(this.name)
			.onChange((value) => { this.name = value; }));
		new Setting(contentEl).setName(t('currency', this.language)).addText((text) => text
			.setPlaceholder(t('searchCurrency', this.language))
			.setValue(this.currency)
			.setDisabled(this.trip?.currencyLocked ?? false)
			.onChange((value) => { this.currency = value; }));
		if (this.trip?.currencyLocked) {
			contentEl.createEl('p', { text: t('currencyLocked', this.language) });
		}
		new Setting(contentEl)
			.addButton((button) => button.setButtonText(t('cancel', this.language)).onClick(() => this.close()))
			.addButton((button) => button.setCta().setButtonText(t('save', this.language)).onClick(async () => {
				try {
					await this.onSave(this.name.trim(), this.currency.trim().toUpperCase());
					this.close();
				} catch (error) {
					new Notice(`${t('failed', this.language)} ${error instanceof Error ? error.message : String(error)}`);
				}
			}));
	}
}
