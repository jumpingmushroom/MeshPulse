import { fail, redirect } from '@sveltejs/kit';
import { getAuth } from '../../lib/server/auth';
import { getDb } from '../../lib/server/db/index';
import { createFirstAdmin, validateSetup } from '../../lib/server/setup';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const invalid = validateSetup(email, password, String(form.get('confirm') ?? ''));
		if (invalid) return fail(400, { email, field: invalid.field, error: invalid.message });
		const auth = getAuth();
		if ((await createFirstAdmin(auth, getDb(), email, password)) === 'done') return fail(409, { email, error: 'Setup is already done. Sign in instead.' });
		await auth.api.signInEmail({ body: { email, password }, headers: request.headers });
		redirect(303, '/');
	}
};
