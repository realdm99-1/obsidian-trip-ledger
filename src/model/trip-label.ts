import type { Trip } from './types';

export function tripListLabel(trip: Trip, trips: Trip[]): string {
	const label = `${trip.name} · ${trip.currency}`;
	const duplicated = trips.some((other) => other.id !== trip.id &&
		other.name === trip.name && other.currency === trip.currency);
	return duplicated ? `${label} · ${trip.id.slice(0, 8)}` : label;
}
