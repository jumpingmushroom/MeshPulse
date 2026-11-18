import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { devices } from './db/schema';
import { getRuntime } from './runtime';
import { muteUntil } from './store';
import type { DeviceState } from './types';

/** The issue and device pages' mute form action: `duration` from the form, or a 400. */
export async function muteDevice(device: DeviceState | undefined, request: Request) {
	const mutedUntil = muteUntil(String((await request.formData()).get('duration')), Date.now());
	if (!device || mutedUntil === undefined) return fail(400, { error: 'Cannot mute: unknown device or duration.' });
	getRuntime().db.update(devices).set({ mutedUntil }).where(eq(devices.ieee, device.ieee)).run();
	device.mutedUntil = mutedUntil; // the lifecycle reads memory, not the DB
}
