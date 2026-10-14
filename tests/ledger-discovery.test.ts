import assert from 'node:assert/strict';
import test from 'node:test';
import { LedgerDiscovery, type LedgerDiscoverySource } from '../src/storage/ledger-discovery';

class MemoryDiscoverySource implements LedgerDiscoverySource {
	roots: string[] = [];
	folders = new Map<string, string[]>();
	files = new Map<string, Record<string, unknown>>();

	async listRoots(): Promise<string[]> { return this.roots; }
	async listTripFolders(root: string): Promise<string[]> { return this.folders.get(root) ?? []; }
	async readFrontmatter(path: string): Promise<Record<string, unknown> | null> {
		return this.files.get(path) ?? null;
	}

	addTrip(root: string, folder: string, id: string): void {
		const path = `${root}/${folder}`;
		this.folders.set(root, [...(this.folders.get(root) ?? []), path]);
		this.files.set(`${path}/trip.md`, {
			'trip-ledger': 'trip', schemaVersion: 1, id,
			name: folder, currency: 'JPY', currencyLocked: false,
		});
	}
}

test('discovers only top-level ledgers with a valid trip and optional categories', async () => {
	const source = new MemoryDiscoverySource();
	source.roots = ['2026-1', 'empty', 'bad-category'];
	source.addTrip('2026-1', '일본--legacy12', 'trip-1');
	source.addTrip('bad-category', '태국', 'trip-2');
	source.files.set('bad-category/categories.md', {
		'trip-ledger': 'categories', schemaVersion: 2, categories: [],
	});
	const discovery = new LedgerDiscovery(source);
	assert.deepEqual(await discovery.list(), [{ root: '2026-1', tripIds: ['trip-1'] }]);
	assert.equal(await discovery.inspect('nested/ledger'), null);
	assert.equal(await discovery.inspect('bad-category'), null);
});

test('ignores malformed trips and duplicate IDs while retaining another valid trip', async () => {
	const source = new MemoryDiscoverySource();
	source.roots = ['mixed', 'duplicates'];
	source.addTrip('mixed', 'first', 'duplicate');
	source.addTrip('mixed', 'second', 'duplicate');
	source.addTrip('mixed', 'third', 'unique');
	source.addTrip('mixed', 'broken', 'broken');
	source.files.set('mixed/broken/trip.md', { 'trip-ledger': 'trip', schemaVersion: 2 });
	source.addTrip('duplicates', 'one', 'same');
	source.addTrip('duplicates', 'two', 'same');
	assert.deepEqual(await new LedgerDiscovery(source).list(), [
		{ root: 'mixed', tripIds: ['unique'] },
	]);
});

test('a malformed trip with an ID also invalidates a valid trip with the same ID', async () => {
	const source = new MemoryDiscoverySource();
	source.roots = ['mixed'];
	source.addTrip('mixed', 'valid', 'same');
	source.addTrip('mixed', 'broken', 'same');
	source.files.set('mixed/broken/trip.md', {
		'trip-ledger': 'trip', schemaVersion: 2, id: 'same',
	});
	source.addTrip('mixed', 'available', 'other');
	assert.deepEqual(await new LedgerDiscovery(source).list(), [
		{ root: 'mixed', tripIds: ['other'] },
	]);
});
