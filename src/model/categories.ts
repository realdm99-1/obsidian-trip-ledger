import type { CustomCategory } from './types';

export const BUILT_IN_CATEGORIES = [
	'food', 'transport', 'lodging', 'shopping', 'activities', 'other',
] as const;

export type BuiltInCategoryId = typeof BUILT_IN_CATEGORIES[number];

export const BUILT_IN_LABELS: Record<BuiltInCategoryId, { ko: string; en: string }> = {
	food: { ko: '식비', en: 'Food' },
	transport: { ko: '교통', en: 'Transport' },
	lodging: { ko: '숙박', en: 'Lodging' },
	shopping: { ko: '쇼핑', en: 'Shopping' },
	activities: { ko: '관광·활동', en: 'Activities' },
	other: { ko: '기타', en: 'Other' },
};

export function validateCategoryName(name: string, existing: CustomCategory[]): string {
	const cleaned = name.trim();
	if (!cleaned) throw new Error('Category name is required');
	if (cleaned.length > 60) throw new Error('Category name is too long');
	const candidate = cleaned.toLocaleLowerCase();
	const names = [
		...Object.values(BUILT_IN_LABELS).flatMap((labels) => [labels.ko, labels.en]),
		...existing.map((category) => category.name),
	];
	if (names.some((value) => value.toLocaleLowerCase() === candidate)) {
		throw new Error('Category already exists');
	}
	return cleaned;
}

export function categoryName(id: string, categories: CustomCategory[], language: 'ko' | 'en'): string {
	if (id in BUILT_IN_LABELS) return BUILT_IN_LABELS[id as BuiltInCategoryId][language];
	const custom = categories.find((entry) => entry.id === id);
	return custom?.name ?? `${language === 'ko' ? '알 수 없는 종류' : 'Unknown category'} (${id})`;
}
