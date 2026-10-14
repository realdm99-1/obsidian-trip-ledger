import type { Setting } from 'obsidian';

const latestRequests = new WeakMap<HTMLElement, object>();

export function beginSettingRequest(setting: Setting): () => boolean {
	const element = setting.settingEl;
	const request = {};
	latestRequests.set(element, request);
	return () => element.isConnected && latestRequests.get(element) === request;
}
