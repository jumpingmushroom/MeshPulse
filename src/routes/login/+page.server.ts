import { fail } from '@sveltejs/kit';
import { getAuth } from '../../lib/server/auth';
import { appRedirect } from '../../lib/server/ingress';
import { loginLimiter } from '../../lib/server/login-limit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) appRedirect(event, 303, '/');
};

export const actions: Actions = {
	login: async (event) => {
		const { request, getClientAddress } = event;
		const form = await request.formData();
		const email = String(form.get('email') ?? '');
		const ip = getClientAddress();
		// signInEmail called directly skips Better Auth's HTTP rate limiter
		if (loginLimiter.blocked(ip, Date.now())) return fail(429, { email, error: 'Too many attempts, try again later' });
		try {
			await getAuth().api.signInEmail({ body: { email, password: String(form.get('password') ?? '') }, headers: request.headers });
		} catch {
			loginLimiter.fail(ip, Date.now());
			return fail(400, { email, error: 'Wrong email or password.' });
		}
		loginLimiter.reset(ip);
		appRedirect(event, 303, '/');
	},
	logout: async (event) => {
		await getAuth().api.signOut({ headers: event.request.headers });
		appRedirect(event, 303, '/login');
	}
};
