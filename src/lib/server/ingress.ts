import { error, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { isAddon } from './addon';

export const INGRESS_PROXY = '172.30.32.2';

/** Add-on only: /api/health is open for the Supervisor watchdog; everything else needs the ingress proxy's address. */
export const addonAccess = (path: string, clientAddress: string): 'allow' | 'forbid' =>
	path === '/api/health' || clientAddress === INGRESS_PROXY ? 'allow' : 'forbid';

/** redirect() that keeps the Home Assistant ingress prefix (X-Ingress-Path) in add-on mode. */
export function appRedirect(event: { request: Request }, status: 301 | 302 | 303 | 307 | 308, path: string): never {
	const prefix = isAddon() ? (event.request.headers.get('x-ingress-path') ?? '') : '';
	// only a Supervisor-style ingress path is accepted as prefix
	redirect(status, (/^\/api\/hassio_ingress\/[\w-]+$/.test(prefix) ? prefix : '') + path);
}

/**
 * Add-on mode answers every request itself and never reaches Better Auth, setup or login.
 * The address comes from getClientAddress() only; the add-on never sets ADDRESS_HEADER/XFF_DEPTH,
 * so a forwarded header cannot spoof the proxy address.
 */
export const addonHandle: Handle = ({ event, resolve }) => {
	if (!isAddon()) return resolve(event);
	const path = event.url.pathname;
	if (addonAccess(path, event.getClientAddress()) === 'forbid') error(403);
	const name = event.request.headers.get('x-remote-user-name');
	event.locals.user = { email: name || 'Home Assistant' } as App.Locals['user'];
	event.locals.session = null;
	if (path === '/login' || path === '/setup') appRedirect(event, 303, '/');
	return resolve(event);
};
