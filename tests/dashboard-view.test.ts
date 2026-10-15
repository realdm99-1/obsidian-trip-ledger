import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as nodeSetTimeout } from 'node:timers';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { TripStore } from '../src/storage/trip-store';
import { ExpenseStore } from '../src/storage/expense-store';
import { CategoryStore } from '../src/storage/category-store';
import { TripSelection } from '../src/model/trip-selection';
import { todayLocal } from '../src/model/dates';
import type { Trip } from '../src/model/types';
import { dayPath } from '../src/storage/paths';
import { MemoryLedgerFiles } from './support/memory-ledger-files';

class Element {
	children: Element[] = [];
	value = '';
	disabled = false;
	hidden = false;
	style = { width: '', background: '' };
	attributes = new Map<string, string>();
	listeners = new Map<string, () => void>();
	constructor(readonly tag: string, readonly text = '', readonly cls = '') {}
	empty(): void { this.children = []; }
	addClass(): void {}
	createEl(tag: string, options: { text?: string; cls?: string; value?: string; attr?: Record<string, string> } = {}): Element {
		const child = new Element(tag, options.text ?? '', options.cls ?? '');
		child.value = options.value ?? '';
		for (const [name, value] of Object.entries(options.attr ?? {})) child.setAttribute(name, value);
		this.children.push(child);
		return child;
	}
	createDiv(options: { text?: string; cls?: string; attr?: Record<string, string> } = {}): Element {
		const child = new Element('div', options.text ?? '', options.cls ?? '');
		for (const [name, value] of Object.entries(options.attr ?? {})) child.setAttribute(name, value);
		this.children.push(child);
		return child;
	}
	createSpan(options: { text?: string } = {}): Element {
		const child = new Element('span', options.text ?? '');
		this.children.push(child);
		return child;
	}
	setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
	createTHead(): Element { return this.createEl('thead'); }
	createTBody(): Element { return this.createEl('tbody'); }
	insertRow(): Element { return this.createEl('tr'); }
	insertCell(): Element { return this.createEl('td'); }
	setText(value: string): void { this.children.push(new Element('text', value)); }
	addEventListener(name: string, callback: () => void): void { this.listeners.set(name, callback); }
	find(predicate: (element: Element) => boolean): Element[] {
		return [...(predicate(this) ? [this] : []), ...this.children.flatMap((child) => child.find(predicate))];
	}
	click(): void { this.listeners.get('click')?.(); }
}

async function loadPluginClasses(runtime: { Date?: unknown; window?: object } = {}): Promise<{
	Plugin: new () => { app: unknown; activateLedgerView(): Promise<void> };
	LedgerView: new (leaf: unknown, plugin: unknown) => {
		contentEl: Element; render(): Promise<void>; showDashboard(): Promise<void>; onOpen(): Promise<void>;
	};
	modal: { latest?: { date: string; save: (expense: unknown) => Promise<void> } };
}> {
	const result = await build({
		stdin: { contents: "export { default as Plugin } from './src/main'; export { LedgerView } from './src/ui/ledger-view';", resolveDir: process.cwd() },
		bundle: true, platform: 'node', format: 'cjs', external: ['obsidian'], write: false,
		plugins: [{ name: 'expense-modal-boundary', setup(plugin) {
			plugin.onResolve({ filter: /^\.\/expense-modal$/ }, (args) => args.importer.endsWith('/ledger-view.ts')
				? { path: args.path, namespace: 'expense-boundary' } : undefined);
			plugin.onLoad({ filter: /.*/, namespace: 'expense-boundary' }, () => ({ contents: `
				export class ExpenseModal {
					constructor(app, language, trip, date, categories, categoryStore, onSave) {
						globalThis.__tripLedgerModal.latest = { date, save: onSave };
					}
					open() {}
				}
				export class ConfirmDeleteModal { constructor() {} open() {} }
			` }));
		}}],
	});
	const module = { exports: {} as Record<string, unknown> };
	const modal: { latest?: { date: string; save: (expense: unknown) => Promise<void> } } = {};
	const obsidian = {
		ItemView: class { app: unknown; contentEl: Element; constructor(leaf: { app: unknown; contentEl: Element }) {
			this.app = leaf.app; this.contentEl = leaf.contentEl;
		} registerEvent(): void {} register(): void {} },
		Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Setting: class {},
		Notice: class {}, TFile: class {}, TFolder: class {}, WorkspaceLeaf: class {},
	};
	runInNewContext(result.outputFiles[0]!.text, {
		require: (name: string) => { assert.equal(name, 'obsidian'); return obsidian; },
		module, exports: module.exports, Date: runtime.Date ?? Date,
		window: runtime.window ?? { clearTimeout, setTimeout: (callback: () => void, delay: number) => {
			const timer = nodeSetTimeout(callback, delay);
			timer.unref();
			return timer;
		} }, __tripLedgerModal: modal,
	});
	return { Plugin: module.exports.Plugin as never, LedgerView: module.exports.LedgerView as never, modal };
}

test('ribbon reentry shows the dashboard and saved expenses follow their dates', async () => {
	const { Plugin, LedgerView, modal } = await loadPluginClasses();
	const files = new MemoryLedgerFiles();
	const tripStore = new TripStore(files);
	const trip = await tripStore.createTrip('일본', 'JPY');
	const expenseStore = new ExpenseStore(files);
	await expenseStore.upsert(trip, { id: 'old', date: '2026-10-14', item: '점심', amountMinor: 1000, place: '식당', categoryId: 'food' });
	const settings = { language: 'ko', lastSelectedTripId: trip.id };
	const contentEl = new Element('root');
	const leaf = { contentEl, app: null as unknown, view: null as unknown, setViewState: async () => {} };
	const app = { vault: { getAbstractFileByPath: () => null }, workspace: {
		getLeavesOfType: () => [leaf], revealLeaf: async () => {},
	} };
	leaf.app = app;
	const plugin = Object.assign(new Plugin(), {
		app, settings, files, tripStore, expenseStore, categoryStore: new CategoryStore(files),
		tripSelection: new TripSelection(settings, async () => {}, files),
	});
	const view = new LedgerView(leaf, plugin);
	leaf.view = view;
	await view.render();
	assert.equal(contentEl.find((element) => element.tag === 'h3' && element.text === '오늘').length, 1);
	const oldDate = contentEl.find((element) => element.tag === 'button' && element.text.startsWith('2026-10-14'))[0]!;
	oldDate.click();
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(contentEl.find((element) => element.tag === 'input' && element.value === '2026-10-14').length, 1);
	await plugin.activateLedgerView();
	assert.equal(contentEl.find((element) => element.tag === 'h3' && element.text === '오늘').length, 1);
	assert.equal(contentEl.find((element) => element.tag === 'input' && element.value === '2026-10-14').length, 0);

	contentEl.find((element) => element.tag === 'button' && element.text === '지출 추가')[0]!.click();
	assert.equal(modal.latest?.date, todayLocal());
	const firstModal = modal.latest;
	assert.ok(firstModal);
	await firstModal.save({ id: 'new', date: todayLocal(), item: '커피', amountMinor: 500, place: '카페', categoryId: 'food' });
	assert.equal(contentEl.find((element) => element.tag === 'h3' && element.text === '오늘').length, 1);
	contentEl.find((element) => element.tag === 'button' && element.text === '지출 추가')[0]!.click();
	const secondModal = modal.latest;
	assert.ok(secondModal);
	await secondModal.save({ id: 'past', date: '2026-10-13', item: '교통', amountMinor: 200, place: '역', categoryId: 'transport' });
	assert.equal(contentEl.find((element) => element.tag === 'input' && element.value === '2026-10-13').length, 1);
});

test('saving an expense keeps the selected statistics tab open', async () => {
	const { LedgerView, modal } = await loadPluginClasses();
	const files = new MemoryLedgerFiles();
	const tripStore = new TripStore(files);
	const trip = await tripStore.createTrip('일본', 'JPY');
	const expenseStore = new ExpenseStore(files);
	await expenseStore.upsert(trip, { id: 'old', date: '2026-10-14', item: '점심', amountMinor: 1000, place: '식당', categoryId: 'food' });
	const settings = { language: 'ko', lastSelectedTripId: trip.id };
	const root = new Element('root');
	const app = { vault: { getAbstractFileByPath: () => null } };
	const plugin = { app, settings, files, tripStore, expenseStore,
		categoryStore: new CategoryStore(files), tripSelection: new TripSelection(settings, async () => {}, files) };
	const view = new LedgerView({ app, contentEl: root }, plugin);
	await view.render();
	root.find((element) => element.tag === 'button' && element.text === '통계 보기')[0]!.click();
	await new Promise<void>((resolve) => setImmediate(resolve));
	root.find((element) => element.tag === 'button' && element.text === '날짜별 지출')[0]!.click();
	assert.equal(root.find((element) => element.tag === 'button' && element.text === '날짜별 지출')[0]!
		.attributes.get('aria-pressed'), 'true');
	root.find((element) => element.tag === 'button' && element.text === '지출 추가')[0]!.click();
	await modal.latest!.save({ id: 'new', date: todayLocal(), item: '커피', amountMinor: 500, place: '카페', categoryId: 'food' });
	assert.equal(root.find((element) => element.tag === 'button' && element.text === '날짜별 지출')[0]!
		.attributes.get('aria-pressed'), 'true');
});

test('a vault change cannot let an older summary load keep the dashboard stale', async () => {
	const { LedgerView } = await loadPluginClasses();
	const files = new MemoryLedgerFiles();
	const tripStore = new TripStore(files);
	const trip = await tripStore.createTrip('일본', 'JPY');
	let signalSnapshot!: () => void;
	let resumeSnapshot!: () => void;
	const snapshotReady = new Promise<void>((resolve) => { signalSnapshot = resolve; });
	const heldSnapshot = new Promise<void>((resolve) => { resumeSnapshot = resolve; });
	class DelayedExpenseStore extends ExpenseStore {
		private first = true;
		override async listDaySummaries(selectedTrip: Trip) {
			const snapshot = await super.listDaySummaries(selectedTrip);
			if (this.first) {
				this.first = false;
				signalSnapshot();
				await heldSnapshot;
			}
			return snapshot;
		}
	}
	const expenseStore = new DelayedExpenseStore(files);
	await expenseStore.upsert(trip, { id: 'old', date: '2026-10-14', item: '점심', amountMinor: 1000, place: '식당', categoryId: 'food' });
	const listeners = new Map<string, (file: { path: string }) => void>();
	const app = { vault: {
		getAbstractFileByPath: () => null,
		on: (name: string, callback: (file: { path: string }) => void) => { listeners.set(name, callback); return {}; },
	} };
	const settings = { language: 'ko', lastSelectedTripId: trip.id };
	const root = new Element('root');
	const plugin = { app, settings, files, tripStore, expenseStore,
		categoryStore: new CategoryStore(files), tripSelection: new TripSelection(settings, async () => {}, files) };
	const view = new LedgerView({ app, contentEl: root }, plugin);
	const opening = view.onOpen();
	await snapshotReady;
	await expenseStore.upsert(trip, { id: 'new', date: '2026-10-13', item: '교통', amountMinor: 300, place: '역', categoryId: 'transport' });
	listeners.get('modify')?.({ path: dayPath(trip.folderPath, '2026-10-13') });
	resumeSnapshot();
	await opening;
	await new Promise<void>((resolve) => nodeSetTimeout(resolve, 200));
	assert.equal(root.find((element) => element.tag === 'button' && element.text.startsWith('2026-10-13')).length, 1);
});

test('an open dashboard changes its today date and add target after local midnight', async () => {
	let currentTime = new Date(2026, 9, 15, 23, 59, 59, 900).getTime();
	class TestDate extends Date {
		constructor(value?: number) { super(value ?? currentTime); }
		static override now(): number { return currentTime; }
	}
	const timers = new Map<number, { callback: () => void; delay: number }>();
	let nextTimerId = 0;
	const timerWindow = {
		setTimeout(callback: () => void, delay: number): number {
			const id = ++nextTimerId;
			timers.set(id, { callback, delay });
			return id;
		},
		clearTimeout(id: number): void { timers.delete(id); },
	};
	const { LedgerView, modal } = await loadPluginClasses({ Date: TestDate, window: timerWindow });
	const files = new MemoryLedgerFiles();
	const tripStore = new TripStore(files);
	const trip = await tripStore.createTrip('일본', 'JPY');
	const expenseStore = new ExpenseStore(files);
	const settings = { language: 'ko', lastSelectedTripId: trip.id };
	const root = new Element('root');
	const app = { vault: {
		getAbstractFileByPath: () => null,
		on: () => ({}),
	} };
	const plugin = { app, settings, files, tripStore, expenseStore,
		categoryStore: new CategoryStore(files), tripSelection: new TripSelection(settings, async () => {}, files) };
	const view = new LedgerView({ app, contentEl: root }, plugin);
	await view.onOpen();
	assert.equal(root.find((element) => element.tag === 'p' && element.text === '2026-10-15').length, 1);
	const midnightTimer = [...timers.values()][0];
	assert.ok(midnightTimer);
	assert.ok(midnightTimer.delay > 0 && midnightTimer.delay <= 200);
	currentTime = new Date(2026, 9, 16, 0, 0, 0, 100).getTime();
	midnightTimer.callback();
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(root.find((element) => element.tag === 'p' && element.text === '2026-10-16').length, 1);
	root.find((element) => element.tag === 'button' && element.text === '지출 추가')[0]!.click();
	assert.equal(modal.latest?.date, '2026-10-16');
});
