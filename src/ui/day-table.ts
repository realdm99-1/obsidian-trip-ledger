import { categoryName } from '../model/categories';
import { formatAmountMinor } from '../model/money';
import type { CustomCategory, Expense } from '../model/types';
import { t, type Language } from '../i18n';

export function renderDayTable(
	container: HTMLElement,
	rows: Expense[],
	currency: string,
	language: Language,
	categories: CustomCategory[],
	onEdit: (expense: Expense) => void,
	onDelete: (expense: Expense) => void,
): void {
	if (rows.length === 0) {
		container.createEl('p', { text: t('noExpenses', language) });
		return;
	}
	const wrapper = container.createDiv({ cls: 'trip-ledger-table-wrap' });
	const table = wrapper.createEl('table', { cls: 'trip-ledger-table' });
	const header = table.createTHead().insertRow();
	for (const key of ['item', 'amount', 'place', 'category', 'edit'] as const) {
		header.createEl('th', { text: t(key, language) });
	}
	const body = table.createTBody();
	for (const row of rows) {
		const tr = body.insertRow();
		tr.insertCell().setText(row.item);
		tr.insertCell().setText(formatAmountMinor(row.amountMinor, currency, language));
		tr.insertCell().setText(row.place);
		tr.insertCell().setText(categoryName(row.categoryId, categories, language));
		const actions = tr.insertCell();
		const edit = actions.createEl('button', { text: t('edit', language) });
		edit.addEventListener('click', () => onEdit(row));
		const remove = actions.createEl('button', { text: t('delete', language) });
		remove.addEventListener('click', () => onDelete(row));
	}
}
