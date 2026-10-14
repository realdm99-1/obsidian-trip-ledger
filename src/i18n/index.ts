import { en } from './en';
import { ko } from './ko';

export type Language = 'ko' | 'en';
export type TranslationKey = keyof typeof ko;

export function t(key: TranslationKey, language: Language): string {
	return (language === 'en' ? en[key] : ko[key]) ?? ko[key];
}
