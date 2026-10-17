import type { LedgerFiles } from './obsidian-files';
import type { LedgerDiscovery } from './ledger-discovery';
import { validateLedgerRootName } from './paths';
import { withTripWritesPaused } from './trip-write-lock';

export interface LedgerSwitchSettings {
	ledgerRoot: string;
	lastSelectedTripId: string | null;
	pendingLedgerRoot?: string;
}

export class LedgerSwitcher {
	constructor(
		private files: LedgerFiles,
		private settings: LedgerSwitchSettings,
		private discovery: LedgerDiscovery,
		private save: (patch: LedgerSwitchSettings) => Promise<void>,
		private onRootChanged: () => void = () => {},
	) {}

	async select(rawRoot: string, options: { allowUninitialized?: boolean } = {}): Promise<void> {
		if (this.settings.pendingLedgerRoot) throw new Error('Resolve the pending ledger rename first');
		const next = validateLedgerRootName(rawRoot);
		await withTripWritesPaused(this.files, () => this.files.switchRoot(next, async () => {
			const candidate = options.allowUninitialized
				? await this.discovery.inspectForConfiguration(next)
				: await this.discovery.inspect(next);
			if (!candidate) throw new Error(`Invalid ledger folder: ${next}`);
			const selected = this.settings.lastSelectedTripId;
			const keptOrNull = selected && candidate.tripIds.includes(selected) ? selected
				: !selected && candidate.tripIds.length === 1 ? candidate.tripIds[0]! : null;
			const patch = { ledgerRoot: next, lastSelectedTripId: keptOrNull, pendingLedgerRoot: undefined };
			await this.save(patch);
			Object.assign(this.settings, patch);
		}));
		this.onRootChanged();
	}
}
