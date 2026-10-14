import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

class FakeContainer {
	rows: FakeSetting[] = [];
	isConnected = true;
	empty(): void { this.rows = []; }
	createDiv(): this { return this; }
	createEl(): this { return this; }
}

class FakeSetting {
	settingEl = { isConnected: true };
	name = '';
	desc = '';
	controls = 0;
	options: string[] = [];
	dropdownChange?: (value: string) => void | Promise<void>;
	constructor(container?: FakeContainer) { container?.rows.push(this); }
	setName(name: string): this { this.name = name; return this; }
	setDesc(desc: string): this { this.desc = desc; return this; }
	setHeading(): this { return this; }
	clear(): this { this.controls = 0; this.options = []; return this; }
	addButton(configure?: (button: { setCta: () => unknown; setButtonText: (text: string) => unknown; onClick: (callback: () => void) => unknown }) => void): this {
		this.controls++;
		const button = {
			setCta() { return this; },
			setButtonText() { return this; },
			onClick() { return this; },
		};
		configure?.(button);
		return this;
	}
	addDropdown(configure: (dropdown: { addOption: (value: string, label: string) => unknown; setValue: (value: string) => unknown; onChange: (callback: (value: string) => void) => unknown }) => void): this {
		this.controls++;
		const dropdown = {
			addOption: (value: string) => { this.options.push(value); return dropdown; },
			setValue: () => dropdown,
			onChange: (callback: (value: string) => void | Promise<void>) => { this.dropdownChange = callback; return dropdown; },
		};
		configure(dropdown);
		return this;
	}
	addText(configure: (text: { setValue: (value: string) => unknown; onChange: (callback: (value: string) => void) => unknown }) => void): this {
		const text = { setValue: () => text, onChange: () => text };
		configure(text);
		return this;
	}
}

async function loadSettingTab(modern = true): Promise<new (app: unknown, plugin: unknown) => {
	getSettingDefinitions(): Array<Record<string, unknown>>;
	updates: number;
	display(): void;
	containerEl: FakeContainer;
}> {
	const result = await build({
		entryPoints: ['src/settings.ts'],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		external: ['obsidian'],
		write: false,
	});
	const module = { exports: {} as { TripLedgerSettingTab?: new (app: unknown, plugin: unknown) => {
		getSettingDefinitions(): Array<Record<string, unknown>>;
		updates: number;
		display(): void;
		containerEl: FakeContainer;
	} } };
	const obsidian = {
		PluginSettingTab: modern ? class {
			containerEl = new FakeContainer();
			updates = 0;
			update(): void { this.updates++; }
		} : class {
			containerEl = new FakeContainer();
			updates = 0;
		},
		Modal: class {},
		Notice: class {},
		Setting: FakeSetting,
	};
	const requireModule = (name: string): unknown => {
		assert.equal(name, 'obsidian');
		return obsidian;
	};
	runInNewContext(result.outputFiles[0]!.text, { require: requireModule, module, exports: module.exports });
	assert.ok(module.exports.TripLedgerSettingTab);
	return module.exports.TripLedgerSettingTab;
}

function categoryGroup(tab: { getSettingDefinitions(): Array<Record<string, unknown>> }): {
	items: Array<{ name: string; render: (setting: FakeSetting) => void }>;
} {
	const groups = tab.getSettingDefinitions().filter((item) => item.type === 'group');
	return groups.at(-1) as { items: Array<{ name: string; render: (setting: FakeSetting) => void }> };
}

test('modern settings load categories once and refresh searchable rows', async () => {
	const SettingTab = await loadSettingTab();
	let loads = 0;
	const plugin = {
		settings: { language: 'ko', ledgerRoot: 'Ledger', lastSelectedTripId: null },
		files: { root: 'Ledger' },
		rootRecoveryWarning: null,
		categoryStore: { list: async () => { loads++; return [{ id: 'food', name: 'Food', archived: false }]; } },
	};
	const tab = new SettingTab({}, plugin);
	const row = categoryGroup(tab).items[0]!;
	row.render(new FakeSetting());
	row.render(new FakeSetting());
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(loads, 1);
	assert.equal(tab.updates, 1);
	assert.ok(categoryGroup(tab).items.some((item) => item.name === 'Food'));
});

test('switching ledgers discards categories loaded from the previous ledger', async () => {
	const SettingTab = await loadSettingTab();
	let resolveOld!: (categories: Array<{ id: string; name: string; archived: boolean }>) => void;
	const oldLoad = new Promise<Array<{ id: string; name: string; archived: boolean }>>((resolve) => { resolveOld = resolve; });
	const plugin = {
		settings: { language: 'ko', ledgerRoot: 'Old', lastSelectedTripId: null },
		files: { root: 'Old' },
		rootRecoveryWarning: null,
		categoryStore: { list: () => plugin.files.root === 'Old'
			? oldLoad : Promise.resolve([{ id: 'new', name: 'New category', archived: false }]) },
	};
	const tab = new SettingTab({}, plugin);
	categoryGroup(tab).items[0]!.render(new FakeSetting());
	plugin.files.root = 'New';
	categoryGroup(tab).items[0]!.render(new FakeSetting());
	resolveOld([{ id: 'old', name: 'Old category', archived: false }]);
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	const names = categoryGroup(tab).items.map((item) => item.name);
	assert.ok(names.includes('New category'));
	assert.ok(!names.includes('Old category'));
});

test('re-rendering async settings rows does not duplicate their controls', async () => {
	const SettingTab = await loadSettingTab();
	const plugin = {
		settings: { language: 'ko', ledgerRoot: 'Ledger', lastSelectedTripId: null },
		files: { root: 'Ledger' },
		rootRecoveryWarning: null,
		ledgerDiscovery: { list: async () => [{ root: 'Ledger' }] },
		tripStore: { listTripCandidates: async () => [] },
	};
	const tab = new SettingTab({}, plugin);
	const groups = tab.getSettingDefinitions().filter((item) => item.type === 'group') as Array<{
		items: Array<{ render: (setting: FakeSetting) => void }>;
	}>;
	const ledgerRow = groups[0]!.items[0]!;
	const tripRow = groups[1]!.items[1]!;
	const ledgerSetting = new FakeSetting();
	const tripSetting = new FakeSetting();
	ledgerRow.render(ledgerSetting);
	tripRow.render(tripSetting);
	ledgerRow.render(ledgerSetting);
	tripRow.render(tripSetting);
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(ledgerSetting.controls, 2);
	assert.equal(tripSetting.controls, 1);
});

test('a slower ledger scan cannot replace newer choices in the same row', async () => {
	const SettingTab = await loadSettingTab();
	let resolveOld!: (candidates: Array<{ root: string }>) => void;
	const oldLoad = new Promise<Array<{ root: string }>>((resolve) => { resolveOld = resolve; });
	let calls = 0;
	const plugin = {
		settings: { language: 'ko', ledgerRoot: 'Ledger', lastSelectedTripId: null },
		files: { root: 'Ledger' },
		rootRecoveryWarning: null,
		ledgerDiscovery: { list: () => ++calls === 1 ? oldLoad : Promise.resolve([{ root: 'New' }]) },
	};
	const tab = new SettingTab({}, plugin);
	const groups = tab.getSettingDefinitions().filter((item) => item.type === 'group') as Array<{
		items: Array<{ render: (setting: FakeSetting) => void }>;
	}>;
	const ledgerRow = groups[0]!.items[0]!;
	const setting = new FakeSetting();
	ledgerRow.render(setting);
	ledgerRow.render(setting);
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	resolveOld([{ root: 'Old' }]);
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.deepEqual(setting.options, ['New']);
});

test('legacy Obsidian redisplays settings after changing language without update()', async () => {
	const SettingTab = await loadSettingTab(false);
	const plugin = {
		settings: { language: 'ko', ledgerRoot: 'Ledger', lastSelectedTripId: null },
		files: { root: 'Ledger' },
		rootRecoveryWarning: null,
		ledgerDiscovery: { list: async () => [] },
		tripStore: { listTripCandidates: async () => [] },
		categoryStore: { list: async () => [] },
		updateSettings: async (next: { language: 'ko' | 'en' }) => { plugin.settings.language = next.language; },
		refreshViews: () => undefined,
	};
	const tab = new SettingTab({}, plugin);
	tab.display();
	assert.ok(tab.containerEl.rows.some((row) => row.name === '선택'));
	const languageRow = tab.containerEl.rows.find((row) => row.name === '언어');
	assert.ok(languageRow?.dropdownChange);
	await languageRow.dropdownChange('en');
	assert.ok(tab.containerEl.rows.some((row) => row.name === 'Language'));
	assert.equal(tab.updates, 0);
});
