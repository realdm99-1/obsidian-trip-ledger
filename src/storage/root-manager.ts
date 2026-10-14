import type { LedgerFiles } from './obsidian-files';
import { validateLedgerRootName } from './paths';
import { RootTargetExistsError } from './errors';
import { withTripWritesPaused } from './trip-write-lock';

export interface RootSettings {
	ledgerRoot: string;
	pendingLedgerRoot?: string;
}

export class RootManager {
	private renaming = false;
	constructor(
		private files: LedgerFiles,
		private settings: RootSettings,
		private save: (next: RootSettings) => Promise<void>,
		private onRootChanged: () => void = () => {},
	) {}

	private async persist(next: RootSettings): Promise<void> {
		await this.save(next);
		this.settings.ledgerRoot = next.ledgerRoot;
		this.settings.pendingLedgerRoot = next.pendingLedgerRoot;
	}

	async rename(rawName: string): Promise<void> {
		if (this.renaming) throw new Error('Ledger folder rename already in progress');
		this.renaming = true;
		const initialRoot = this.files.root;
		try {
			await withTripWritesPaused(this.files, () => this.renameCore(rawName));
		} finally {
			this.renaming = false;
			if (this.files.root !== initialRoot) this.onRootChanged();
		}
	}

	private async renameCore(rawName: string): Promise<void> {
		const next = validateLedgerRootName(rawName);
		const previous = this.files.root;
		if (next === previous) return;
		if (await this.files.rootExists(next)) throw new Error(`Folder already exists: ${next}`);
		if (!(await this.files.rootExists(previous))) {
			await this.files.changeEmptyRoot(next, async () => {
				await this.persist({ ledgerRoot: next, pendingLedgerRoot: undefined });
			});
			return;
		}
		await this.persist({ ledgerRoot: previous, pendingLedgerRoot: next });
		try {
			await this.files.renameRoot(next);
		} catch (error) {
			if (error instanceof RootTargetExistsError) {
				await this.persist({ ledgerRoot: previous, pendingLedgerRoot: undefined });
			} else {
				await this.recover();
			}
			throw error;
		}
		await this.persist({ ledgerRoot: next, pendingLedgerRoot: undefined });
	}

	async recover(): Promise<string | null> {
		const previous = validateLedgerRootName(this.settings.ledgerRoot);
		const pending = this.settings.pendingLedgerRoot;
		if (!pending) return null;
		const next = validateLedgerRootName(pending);
		const [oldExists, newExists] = await Promise.all([
			this.files.rootExists(previous), this.files.rootExists(next),
		]);
		if (oldExists === newExists) {
			const reason = `Check ledger folders: ${previous}, ${next}`;
			this.files.blockRoot(reason);
			return reason;
		}
		const resolved = newExists ? next : previous;
		this.files.adoptRoot(resolved);
		try {
			await this.persist({ ledgerRoot: resolved, pendingLedgerRoot: undefined });
			return null;
		} catch (error) {
			return `Ledger folder is ${resolved}, but settings could not be saved: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
}
