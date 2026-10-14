import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { t } from './i18n';
import { ObsidianLedgerFiles } from './storage/obsidian-files';
import { TripStore } from './storage/trip-store';
import { CategoryStore } from './storage/category-store';
import { ExpenseStore } from './storage/expense-store';
import { DEFAULT_SETTINGS, TripLedgerSettings, TripLedgerSettingTab } from './settings';
import { LedgerView, LEDGER_VIEW_TYPE } from './ui/ledger-view';
import { RootManager } from './storage/root-manager';
import { validateLedgerRootName } from './storage/paths';
import { TripSelection } from './model/trip-selection';
import { SettingsWriteQueue } from './model/settings-write-queue';
import { LedgerDiscovery } from './storage/ledger-discovery';
import { ObsidianDiscoverySource } from './storage/obsidian-discovery-source';
import { LedgerSwitcher } from './storage/ledger-switcher';

export default class TripLedgerPlugin extends Plugin {
	settings!: TripLedgerSettings;
	files!: ObsidianLedgerFiles;
	tripStore!: TripStore;
	categoryStore!: CategoryStore;
	expenseStore!: ExpenseStore;
	rootManager!: RootManager;
	ledgerDiscovery!: LedgerDiscovery;
	ledgerSwitcher!: LedgerSwitcher;
	tripSelection!: TripSelection;
	rootRecoveryWarning: string | null = null;
	private settingsWriter!: SettingsWriteQueue<TripLedgerSettings>;

	async onload(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData() as Partial<TripLedgerSettings> | null) };
		this.settings.ledgerRoot = validateLedgerRootName(this.settings.ledgerRoot);
		this.settingsWriter = new SettingsWriteQueue(this.settings, (snapshot) => this.saveData(snapshot));
		this.files = new ObsidianLedgerFiles(this.app, this.settings.ledgerRoot);
		this.rootManager = new RootManager(this.files, this.settings,
			(next) => this.updateSettings(next), () => this.refreshViews(true));
		this.rootRecoveryWarning = await this.rootManager.recover();
		this.ledgerDiscovery = new LedgerDiscovery(new ObsidianDiscoverySource(this.app));
		this.ledgerSwitcher = new LedgerSwitcher(this.files, this.settings, this.ledgerDiscovery,
			(patch) => this.updateSettings(patch), () => this.refreshViews(true));
		this.tripStore = new TripStore(this.files);
		this.categoryStore = new CategoryStore(this.files);
		this.expenseStore = new ExpenseStore(this.files);
		this.tripSelection = new TripSelection(this.settings,
			(id) => this.updateSettings({ lastSelectedTripId: id }), this.files);

		this.registerView(LEDGER_VIEW_TYPE, (leaf: WorkspaceLeaf) => new LedgerView(leaf, this));
		this.addRibbonIcon('wallet', t('openLedger', this.settings.language), () => {
			void this.activateLedgerView();
		});
		this.addCommand({
			id: 'open-trip-ledger',
			name: t('openLedger', this.settings.language),
			callback: () => void this.activateLedgerView(),
		});
		this.addSettingTab(new TripLedgerSettingTab(this.app, this));
		if (this.rootRecoveryWarning) new Notice(`${t('folderRecoveryWarning', this.settings.language)} ${this.rootRecoveryWarning}`);
	}

	async activateLedgerView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(LEDGER_VIEW_TYPE)[0];
		const leaf = existing ?? this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: LEDGER_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
		if (existing && leaf.view instanceof LedgerView) await leaf.view.render();
	}

	async selectCurrentTrip(folderPath: string): Promise<boolean> {
		const candidates = await this.tripStore.listTripCandidates();
		const selected = await this.tripSelection.chooseFolder(folderPath, candidates);
		if (selected) this.refreshViews();
		return selected;
	}

	async updateSettings(next: Partial<TripLedgerSettings>): Promise<void> {
		await this.settingsWriter.update(next);
	}

	async renameLedgerRoot(name: string): Promise<void> {
		await this.rootManager.rename(name);
		this.rootRecoveryWarning = null;
	}

	async selectExistingLedger(root: string): Promise<void> {
		await this.ledgerSwitcher.select(root);
	}

	refreshViews(rootChanged = false): void {
		for (const leaf of this.app.workspace.getLeavesOfType(LEDGER_VIEW_TYPE)) {
			if (leaf.view instanceof LedgerView) {
				if (rootChanged) leaf.view.clearRootCache();
				void leaf.view.render();
			}
		}
	}
}
