import { isDateKey } from '../model/dates';

export const DEFAULT_LEDGER_ROOT = 'Trip Ledger';

export function validateLedgerRootName(raw: string): string {
	const name = raw.trim();
	if (!name || name.length > 80 || name === '.' || name === '..' || name.endsWith('.') ||
		/[\\/:*?"<>|\p{Cc}]/u.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name)) {
		throw new Error('Invalid ledger folder name');
	}
	return name;
}

export function categoriesPath(root: string): string {
	return `${validateLedgerRootName(root)}/categories.md`;
}

export function assertLedgerPath(path: string, root = DEFAULT_LEDGER_ROOT): void {
	const cleanRoot = validateLedgerRootName(root);
	if (path !== cleanRoot && !path.startsWith(`${cleanRoot}/`)) {
		throw new Error(`Path outside ledger: ${path}`);
	}
	if (path.split('/').some((part) => part === '..' || part === '.' || part === '')) {
		throw new Error(`Invalid ledger path: ${path}`);
	}
}

export function plainTripFolderPath(name: string, root = DEFAULT_LEDGER_ROOT): string {
	const cleanRoot = validateLedgerRootName(root);
	const readable = name.trim().replace(/[^\p{L}\p{N} _-]/gu, '-').replace(/\s+/g, ' ').slice(0, 50).trim();
	if (!readable) throw new Error('Invalid trip name or ID');
	return `${cleanRoot}/${readable}`;
}

export function tripFolderPath(name: string, id: string, root = DEFAULT_LEDGER_ROOT): string {
	const suffix = id.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
	if (!suffix) throw new Error('Invalid trip name or ID');
	return `${plainTripFolderPath(name, root)}--${suffix}`;
}

export function tripFilePath(folderPath: string, root = DEFAULT_LEDGER_ROOT): string {
	assertLedgerPath(folderPath, root);
	return `${folderPath}/trip.md`;
}

export function datesFolderPath(folderPath: string, root = DEFAULT_LEDGER_ROOT): string {
	assertLedgerPath(folderPath, root);
	return `${folderPath}/dates`;
}

export function dayPath(folderPath: string, date: string, root = DEFAULT_LEDGER_ROOT): string {
	if (!isDateKey(date)) throw new Error('Invalid date');
	return `${datesFolderPath(folderPath, root)}/${date}.md`;
}
