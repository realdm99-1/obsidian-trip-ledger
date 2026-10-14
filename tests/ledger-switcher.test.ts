import assert from 'node:assert/strict';
import test from 'node:test';
import { LedgerDiscovery, type LedgerDiscoverySource } from '../src/storage/ledger-discovery';
import { LedgerSwitcher, type LedgerSwitchSettings } from '../src/storage/ledger-switcher';
import { MemoryLedgerFiles } from './support/memory-ledger-files';
import { withTripWriteLock } from '../src/storage/trip-write-lock';
import { CategoryStore } from '../src/storage/category-store';
import { TripStore } from '../src/storage/trip-store';
import { TripSelection } from '../src/model/trip-selection';
import { SettingsWriteQueue } from '../src/model/settings-write-queue';

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

class DelayedCategoryReadFiles extends MemoryLedgerFiles {
	readStarted = deferred();
	continueRead = deferred();

	override async readFrontmatter(path: string): Promise<Record<string, unknown> | null> {
		const result = await super.readFrontmatter(path);
		if (path === 'Trip Ledger/categories.md') {
			this.readStarted.resolve();
			await this.continueRead.promise;
		}
		return result;
	}
}

class DelayedTripFolderFiles extends MemoryLedgerFiles {
	folderCreated = deferred();
	continueCreate = deferred();

	override async createTripFolder(path: string): Promise<void> {
		await super.createTripFolder(path);
		if (path.startsWith('Trip Ledger/')) {
			this.folderCreated.resolve();
			await this.continueCreate.promise;
		}
	}
}

class TargetSource implements LedgerDiscoverySource {
	roots = ['2026-1'];
	folders = new Map<string, string[]>();
	data = new Map<string, Record<string, unknown>>();

	async listRoots(): Promise<string[]> { return this.roots; }
	async listTripFolders(root: string): Promise<string[]> { return this.folders.get(root) ?? []; }
	async readFrontmatter(path: string): Promise<Record<string, unknown> | null> {
		return this.data.get(path) ?? null;
	}

	addTrip(folder: string, id: string): void {
		const folderPath = `2026-1/${folder}`;
		this.folders.set('2026-1', [...(this.folders.get('2026-1') ?? []), folderPath]);
		this.data.set(`${folderPath}/trip.md`, {
			'trip-ledger': 'trip', schemaVersion: 1, id, name: folder,
			currency: 'JPY', currencyLocked: false,
		});
	}
}

function setup(currentId: string | null, files = new MemoryLedgerFiles()) {
	const source = new TargetSource();
	const settings: LedgerSwitchSettings = {
		ledgerRoot: 'Trip Ledger', lastSelectedTripId: currentId,
	};
	const original = { 'trip-ledger': 'trip', schemaVersion: 1, id: currentId ?? 'other',
		name: '일본', currency: 'JPY', currencyLocked: false };
	files.seed('2026-1/일본/trip.md', original);
	source.addTrip('일본', currentId ?? 'other');
	return { files, source, settings, original };
}

test('a ledger switch waits for a category add and keeps it in the original ledger', async () => {
	const files = new DelayedCategoryReadFiles();
	const { source, settings } = setup('trip-1', files);
	files.seed('Trip Ledger/categories.md', { 'trip-ledger': 'categories', schemaVersion: 1, categories: [] });
	files.seed('2026-1/categories.md', { 'trip-ledger': 'categories', schemaVersion: 1, categories: [] });
	const adding = new CategoryStore(files).add('기차비');
	await files.readStarted.promise;
	const switching = new LedgerSwitcher(files, settings, new LedgerDiscovery(source), async () => {}).select('2026-1');
	await new Promise<void>((resolve) => setImmediate(resolve));
	const rootWhileAdding = files.root;
	files.continueRead.resolve();
	await Promise.all([adding, switching]);
	assert.equal(rootWhileAdding, 'Trip Ledger');
	assert.deepEqual((await files.readFrontmatter('2026-1/categories.md'))?.categories, []);
	files.adoptRoot('Trip Ledger');
	const original = await files.readFrontmatter('Trip Ledger/categories.md');
	assert.deepEqual((original?.categories as Array<{ name: string }>).map((entry) => entry.name), ['기차비']);
});

test('a ledger switch waits for trip creation to finish its trip file', async () => {
	const files = new DelayedTripFolderFiles();
	const { source, settings } = setup('trip-1', files);
	const creating = new TripStore(files).createTrip('새 여행', 'KRW');
	await files.folderCreated.promise;
	const switching = new LedgerSwitcher(files, settings, new LedgerDiscovery(source), async () => {}).select('2026-1');
	await new Promise<void>((resolve) => setImmediate(resolve));
	const rootWhileCreating = files.root;
	files.continueCreate.resolve();
	const [trip] = await Promise.all([creating, switching]);
	assert.equal(rootWhileCreating, 'Trip Ledger');
	files.adoptRoot('Trip Ledger');
	assert.equal((await files.readFrontmatter(`${trip.folderPath}/trip.md`))?.id, trip.id);
});

test('a selection queued during a switch cannot restore an old ledger trip ID', async () => {
	const { files, source, settings } = setup('old-trip');
	source.data.get('2026-1/일본/trip.md')!.id = 'new-trip';
	const oldTrip = await new TripStore(files).createTrip('이전 여행', 'KRW');
	settings.lastSelectedTripId = oldTrip.id;
	const oldCandidates = await new TripStore(files).listTripCandidates();
	const switchSaveStarted = deferred();
	const continueSwitchSave = deferred();
	let persisted: LedgerSwitchSettings = { ...settings };
	const writer = new SettingsWriteQueue(settings, async (snapshot) => {
		if (snapshot.ledgerRoot === '2026-1') {
			switchSaveStarted.resolve();
			await continueSwitchSave.promise;
		}
		persisted = { ...snapshot };
	});
	const selection = new TripSelection(settings, (id) => writer.update({ lastSelectedTripId: id }), files);
	const switcher = new LedgerSwitcher(files, settings, new LedgerDiscovery(source), (patch) => writer.update(patch));
	const switching = switcher.select('2026-1');
	await switchSaveStarted.promise;
	const choosing = selection.chooseFolder(oldTrip.folderPath, oldCandidates);
	continueSwitchSave.resolve();
	await switching;
	assert.equal(await choosing, false);
	assert.equal(settings.lastSelectedTripId, null);
	assert.equal(persisted.lastSelectedTripId, null);
});

test('selecting a moved ledger keeps a uniquely matching current trip without changing records', async () => {
	const { files, source, settings, original } = setup('trip-1');
	let refreshes = 0;
	const switcher = new LedgerSwitcher(files, settings, new LedgerDiscovery(source), async () => {},
		() => { refreshes++; });
	await switcher.select('2026-1');
	assert.equal(files.root, '2026-1');
	assert.equal(settings.ledgerRoot, '2026-1');
	assert.equal(settings.lastSelectedTripId, 'trip-1');
	assert.deepEqual(await files.readFrontmatter('2026-1/일본/trip.md'), original);
	assert.equal(refreshes, 1);
});

test('switching to a ledger without the selected trip clears the current trip', async () => {
	const { files, source, settings } = setup('old-trip');
	source.data.get('2026-1/일본/trip.md')!.id = 'new-trip';
	const switcher = new LedgerSwitcher(files, settings, new LedgerDiscovery(source), async () => {});
	await switcher.select('2026-1');
	assert.equal(settings.lastSelectedTripId, null);
});

test('a duplicate current trip ID is not retained when another valid trip exists', async () => {
	const { files, source, settings } = setup('duplicate');
	source.addTrip('copy', 'duplicate');
	source.addTrip('valid', 'other');
	const switcher = new LedgerSwitcher(files, settings, new LedgerDiscovery(source), async () => {});
	await switcher.select('2026-1');
	assert.equal(settings.lastSelectedTripId, null);
});

test('invalid targets and failed settings saves leave the previous root and trip selected', async () => {
	const { files, source, settings } = setup('trip-1');
	const discovery = new LedgerDiscovery(source);
	const switcher = new LedgerSwitcher(files, settings, discovery, async () => {
		throw new Error('save failed');
	});
	await assert.rejects(switcher.select('2026-1'), /save failed/);
	assert.equal(files.root, 'Trip Ledger');
	assert.equal(settings.ledgerRoot, 'Trip Ledger');
	assert.equal(settings.lastSelectedTripId, 'trip-1');
	source.roots = [];
	await assert.rejects(switcher.select('2026-1'), /Invalid ledger folder/);
	assert.equal(files.root, 'Trip Ledger');
});

test('a pending folder rename blocks selecting another ledger', async () => {
	const { files, source, settings } = setup('trip-1');
	settings.pendingLedgerRoot = 'renamed';
	const switcher = new LedgerSwitcher(files, settings, new LedgerDiscovery(source), async () => {});
	await assert.rejects(switcher.select('2026-1'), /pending ledger rename/);
	assert.equal(files.root, 'Trip Ledger');
});

test('a ledger switch waits for an in-progress trip write', async () => {
	const { files, source, settings } = setup('trip-1');
	let releaseWrite!: () => void;
	const writing = withTripWriteLock(files, 'trip-1', () => new Promise<void>((resolve) => { releaseWrite = resolve; }));
	let saved = false;
	const switcher = new LedgerSwitcher(files, settings, new LedgerDiscovery(source), async () => {
		saved = true;
	});
	const switching = switcher.select('2026-1');
	await Promise.resolve();
	assert.equal(saved, false);
	releaseWrite();
	await writing;
	await switching;
	assert.equal(saved, true);
});
