import type { ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { startRuntime } from './lib/server/runtime';

export const init: ServerInit = async () => {
	if (!building) startRuntime();
};
