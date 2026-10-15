import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDashboard } from '../src/ui/dashboard';

class Element {
	children: Element[] = [];
	value = '';
	listeners = new Map<string, () => void>();
	constructor(readonly tag: string, readonly text = '', readonly cls = '') {}
	createEl(tag: string, options: { text?: string; cls?: string; type?: string } = {}): Element {
		const child = new Element(tag, options.text ?? '', options.cls ?? '');
		this.children.push(child);
		return child;
	}
	createDiv(options: { text?: string; cls?: string } = {}): Element {
		const child = new Element('div', options.text ?? '', options.cls ?? '');
		this.children.push(child);
		return child;
	}
	addEventListener(name: string, callback: () => void): void { this.listeners.set(name, callback); }
	find(predicate: (element: Element) => boolean): Element[] {
		return [...(predicate(this) ? [this] : []), ...this.children.flatMap((child) => child.find(predicate))];
	}
	click(): void { this.listeners.get('click')?.(); }
	change(): void { this.listeners.get('change')?.(); }
}

test('dashboard opens recorded and valid arbitrary dates from visible controls', () => {
	const root = new Element('div');
	const opened: string[] = [];
	renderDashboard(root as unknown as HTMLElement, {
		trip: { id: 'trip', name: '일본', currency: 'JPY', currencyLocked: true, folderPath: 'Trip Ledger/일본' },
		language: 'ko', today: '2026-10-15', todayRows: [], categories: [], showStats: false,
		summaries: [
			{ date: '2026-10-16', count: 1, totalMinor: 300 },
			{ date: '2026-10-15', count: 1, totalMinor: 100 },
			{ date: '2026-10-14', count: 2, totalMinor: 1500 },
		],
	}, {
		onAdd: () => {}, onEdit: () => {}, onDelete: () => {},
		onOpenDate: (date) => opened.push(date), onToggleStats: () => {},
	});
	assert.equal(root.find((element) => element.tag === 'h3' && element.text === '오늘').length, 1);
	assert.equal(root.find((element) => element.tag === 'h3' && element.text === '기록된 날짜').length, 1);
	const dateButtons = root.find((element) => element.tag === 'button' && /^2026-10-1[46]/.test(element.text));
	assert.equal(dateButtons.length, 2);
	assert.match(dateButtons[0]!.text, /1건/);
	assert.match(dateButtons[1]!.text, /2건/);
	dateButtons[1]!.click();
	assert.deepEqual(opened, ['2026-10-14']);
	const input = root.find((element) => element.tag === 'input')[0]!;
	input.value = '2026-02-30';
	input.change();
	const openDate = root.find((element) => element.tag === 'button' && element.text === '날짜 열기')[0]!;
	openDate.click();
	assert.deepEqual(opened, ['2026-10-14']);
	input.value = '2026-12-01';
	input.change();
	assert.deepEqual(opened, ['2026-10-14'], 'Native date fields can emit change before entry is finished');
	input.value = '2026-12-12';
	openDate.click();
	assert.deepEqual(opened, ['2026-10-14', '2026-12-12']);
});

test('dashboard statistics control describes its expanded state', () => {
	const root = new Element('div');
	renderDashboard(root as unknown as HTMLElement, {
		trip: { id: 'trip', name: '일본', currency: 'JPY', currencyLocked: true, folderPath: 'Trip Ledger/일본' },
		language: 'ko', today: '2026-10-15', todayRows: [], categories: [], summaries: [], showStats: true,
	}, {
		onAdd: () => {}, onEdit: () => {}, onDelete: () => {}, onOpenDate: () => {}, onToggleStats: () => {},
	});
	assert.equal(root.find((element) => element.tag === 'button' && element.text === '통계 닫기').length, 1);
});
