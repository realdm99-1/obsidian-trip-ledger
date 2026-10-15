import assert from 'node:assert/strict';
import test from 'node:test';
import { renderStatsPanel } from '../src/ui/stats-panel';

class Element {
	children: Element[] = [];
	hidden = false;
	style = { background: '', width: '' };
	attributes = new Map<string, string>();
	listeners = new Map<string, () => void>();
	constructor(readonly tag: string, readonly text = '', readonly cls = '') {}
	createEl(tag: string, options: { text?: string; cls?: string; attr?: Record<string, string> } = {}): Element {
		const child = new Element(tag, options.text ?? '', options.cls ?? '');
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
	addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
	click(): void { this.listeners.get('click')?.(); }
	find(predicate: (element: Element) => boolean): Element[] {
		return [...(predicate(this) ? [this] : []), ...this.children.flatMap((child) => child.find(predicate))];
	}
}

test('statistics tabs show category shares, daily totals, and ranked places without changing trip total', () => {
	const root = new Element('root');
	renderStatsPanel(root as unknown as HTMLElement, [
		{ id: '1', date: '2026-10-14', item: 'Lunch', amountMinor: 1200, place: 'Restaurant', categoryId: 'food' },
		{ id: '2', date: '2026-10-14', item: 'Coffee', amountMinor: 300, place: 'Cafe', categoryId: 'food' },
		{ id: '3', date: '2026-10-15', item: 'Bus', amountMinor: 500, place: 'Station', categoryId: 'transport' },
	], [], 'USD', 'en');
	const tabs = root.find((element) => element.cls === 'trip-ledger-stat-tab');
	assert.deepEqual(tabs.map((tab) => tab.text), ['By category', 'By date', 'By place']);
	const panels = root.find((element) => element.cls === 'trip-ledger-stat-panel');
	assert.equal(panels.length, 3);
	assert.deepEqual(panels.map((panel) => panel.attributes.get('aria-label')),
		['By category', 'By date', 'By place']);
	assert.deepEqual(panels.map((panel) => panel.attributes.get('role')), ['region', 'region', 'region']);
	assert.deepEqual(panels.map((panel) => panel.hidden), [false, true, true]);
	assert.equal(panels[1]!.find((element) => element.cls === 'trip-ledger-stat-row').length, 0);
	assert.equal(panels[2]!.find((element) => element.cls === 'trip-ledger-stat-row').length, 0);
	assert.equal(tabs[0]!.attributes.get('aria-pressed'), 'true');
	assert.equal(root.find((element) => element.tag === 'p' && element.text === '$20.00').length, 1);
	const donut = panels[0]!.find((element) => element.cls === 'trip-ledger-stat-donut')[0]!;
	assert.match(donut.style.background, /conic-gradient\(/);
	assert.match(donut.style.background, /75%/);
	assert.equal(panels[0]!.find((element) => element.text.includes('75.0%')).length, 1);

	tabs[1]!.click();
	assert.deepEqual(panels.map((panel) => panel.hidden), [true, false, true]);
	assert.equal(tabs[1]!.attributes.get('aria-pressed'), 'true');
	assert.deepEqual(panels[1]!.find((element) => element.cls === 'trip-ledger-stat-label').map((label) => label.text),
		['2026-10-14', '2026-10-15']);
	assert.deepEqual(panels[1]!.find((element) => element.cls === 'trip-ledger-stat-bar').map((bar) => bar.style.width),
		['100%', '33.3%']);
	assert.equal(root.find((element) => element.tag === 'p' && element.text === '$20.00').length, 1);

	tabs[2]!.click();
	assert.deepEqual(panels.map((panel) => panel.hidden), [true, true, false]);
	assert.deepEqual(panels[2]!.find((element) => element.cls === 'trip-ledger-stat-label').map((label) => label.text),
		['Restaurant', 'Station', 'Cafe']);
	assert.deepEqual(panels[2]!.find((element) => element.cls === 'trip-ledger-stat-bar').map((bar) => bar.style.width),
		['100%', '41.7%', '25%']);
});

test('empty statistics show guidance without charts', () => {
	const root = new Element('root');
	renderStatsPanel(root as unknown as HTMLElement, [], [], 'USD', 'en');
	assert.equal(root.find((element) => element.text === 'Add expenses to see statistics.').length, 1);
	assert.equal(root.find((element) => element.cls === 'trip-ledger-stat-tab').length, 0);
});
