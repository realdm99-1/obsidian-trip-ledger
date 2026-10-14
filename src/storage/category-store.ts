import { validateCategoryName } from '../model/categories';
import type { CustomCategory } from '../model/types';
import type { LedgerFiles } from './obsidian-files';
import { categoriesPath } from './paths';
import { parseCategories } from './schema';
import { withFilePath } from './errors';
import { withTripWriteLock } from './trip-write-lock';

export class CategoryStore {
	constructor(private files: LedgerFiles) {}

	async list(): Promise<CustomCategory[]> {
		const path = categoriesPath(this.files.root);
		const raw = await this.files.readFrontmatter(path);
		return raw === null ? [] : withFilePath(path, () => parseCategories(raw));
	}

	private async ensureFile(): Promise<void> {
		const path = categoriesPath(this.files.root);
		if (await this.files.readFrontmatter(path) !== null) return;
		await this.files.createManagedFile(path, 'categories', { categories: [] });
	}

	async add(name: string): Promise<CustomCategory> {
		return withTripWriteLock(this.files, 'categories', async () => {
			await this.ensureFile();
			const path = categoriesPath(this.files.root);
			let added: CustomCategory | undefined;
			await this.files.mutateFrontmatter(path, (data) => {
				const current = parseCategories(data);
				added = { id: crypto.randomUUID().replace(/-/g, ''), name: validateCategoryName(name, current), archived: false };
				data.categories = [...current, added];
			});
			if (!added) throw new Error('Category was not saved');
			return added;
		});
	}

	async rename(id: string, name: string): Promise<void> {
		await this.files.mutateFrontmatter(categoriesPath(this.files.root), (data) => {
			const current = parseCategories(data);
			if (!current.some((entry) => entry.id === id)) throw new Error('Category not found');
			const clean = validateCategoryName(name, current.filter((entry) => entry.id !== id));
			data.categories = current.map((entry) => entry.id === id ? { ...entry, name: clean } : entry);
		});
	}

	async setArchived(id: string, archived: boolean): Promise<void> {
		await this.files.mutateFrontmatter(categoriesPath(this.files.root), (data) => {
			const current = parseCategories(data);
			if (!current.some((entry) => entry.id === id)) throw new Error('Category not found');
			data.categories = current.map((entry) => entry.id === id ? { ...entry, archived } : entry);
		});
	}
}
