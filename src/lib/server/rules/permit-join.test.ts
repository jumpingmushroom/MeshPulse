import { describe, expect, it } from 'vitest';
import { ctx, MIN, NOW } from '../../../../tests/helpers/ctx';
import { permitJoinOpen } from './permit-join';

const open = (sinceAgo: number) => {
	const c = ctx();
	c.state.bridge.permitJoin = true;
	c.state.bridge.permitJoinSince = NOW - sinceAgo;
	return c;
};

describe('bridge.permit_join_open', () => {
	it('warns when permit_join has been open for 10 min + 1 s', () => {
		const [f] = permitJoinOpen(open(10 * MIN + 1000));
		expect(f).toMatchObject({ rule: 'bridge.permit_join_open', ieee: null, severity: 'warning' });
	});

	it('is nothing at 9 min', () => {
		expect(permitJoinOpen(open(9 * MIN))).toEqual([]);
	});

	it('is nothing when permit_join is false', () => {
		const c = open(60 * MIN);
		c.state.bridge.permitJoin = false;
		expect(permitJoinOpen(c)).toEqual([]);
	});
});
