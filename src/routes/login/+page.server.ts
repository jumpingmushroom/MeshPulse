import { fail, redirect } from '@sveltejs/kit';
import { getAuth } from '../../lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/');
};

export const actions: Actions = {
	login: async ({ request }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '');
		try {
			await getAuth().api.signInEmail({ body: { email, password: String(form.get('password') ?? '') }, headers: request.headers });
		} catch {
			return fail(400, { email, error: 'Wrong email or password.' });
		}
		redirect(303, '/');
	},
	logout: async ({ request }) => {
		await getAuth().api.signOut({ headers: request.headers });
		redirect(303, '/login');
	}
};
