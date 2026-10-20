import { error, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { isAddon } from './addon';

export const INGRESS_PROXY = '172.30.32.2';

/** Add-on only: /api/health is open for the Supervisor watchdog; everything else needs the ingress proxy's address. */
export const addonAccess = (path: string, clientAddress: string): 'allow' | 'forbid' =>
	path === '/api/health' || clientAddress === INGRESS_PROXY ? 'allow' : 'forbid';

/** redirect() that keeps the Home Assistant ingress prefix (X-Ingress-Path) in add-on mode. */
export function appRedirect(event: { request: Request }, status: 301 | 302 | 303 | 307 | 308, path: string): never {
	redirect(status, ingressPrefix(event.request) + path);
}

/** The request's X-Ingress-Path in add-on mode, '' when absent or not a Supervisor-style ingress path. */
function ingressPrefix(request: Request): string {
	const prefix = isAddon() ? (request.headers.get('x-ingress-path') ?? '') : '';
	return /^\/api\/hassio_ingress\/[\w-]+$/.test(prefix) ? prefix : '';
}

const needsPrefix = (l: unknown, prefix: string): l is string => typeof l === 'string' && l.startsWith('/') && !l.startsWith('//') && !l.startsWith(prefix);

/** Home Assistant strips the ingress prefix, so SvelteKit's own redirects and action `location`s lack it. */
export async function prefixResponse(response: Response, prefix: string, isAction: boolean): Promise<Response> {
	const loc = response.headers.get('location');
	if (response.status >= 300 && response.status < 400 && needsPrefix(loc, prefix)) {
		const headers = new Headers(response.headers);
		headers.set('location', prefix + loc);
		return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
	}
	if (!isAction || !response.headers.get('content-type')?.startsWith('application/json')) return response;
	const body = await response.json();
	if (needsPrefix(body?.location, prefix)) body.location = prefix + body.location;
	const headers = new Headers(response.headers);
	headers.delete('content-length');
	return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

/** getClientAddress() would trust a header when ADDRESS_HEADER is set, so refuse to start. */
export function assertAddonEnv(env: Record<string, string | undefined> = process.env): void {
	if (isAddon(env) && env.ADDRESS_HEADER) throw new Error('ADDRESS_HEADER must not be set in add-on mode: it would let a forwarded header spoof the ingress proxy address');
}

/**
 * Add-on mode answers every request itself and never reaches Better Auth, setup or login.
 * The address comes from getClientAddress() only; the add-on never sets ADDRESS_HEADER/XFF_DEPTH,
 * so a forwarded header cannot spoof the proxy address.
 */
export const addonHandle: Handle = async ({ event, resolve }) => {
	if (!isAddon()) return resolve(event);
	const path = event.url.pathname;
	if (addonAccess(path, event.getClientAddress()) === 'forbid') error(403);
	const name = event.request.headers.get('x-remote-user-name');
	event.locals.user = { email: name || 'Home Assistant' } as App.Locals['user'];
	event.locals.session = null;
	if (path === '/login' || path === '/setup') appRedirect(event, 303, '/');
	const response = await resolve(event);
	const prefix = ingressPrefix(event.request);
	return prefix ? prefixResponse(response, prefix, event.request.headers.get('x-sveltekit-action') === 'true') : response;
};
