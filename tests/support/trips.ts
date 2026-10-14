import type { Trip } from '../../src/model/types';
import type { TripStore } from '../../src/storage/trip-store';

export async function readValidTrips(store: TripStore): Promise<Trip[]> {
	return (await store.listTripCandidates()).flatMap((candidate) => candidate.trip ? [candidate.trip] : []);
}
