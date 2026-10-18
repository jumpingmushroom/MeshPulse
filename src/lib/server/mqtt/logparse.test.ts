import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../../tests/helpers/fixtures';
import { parseRouteError } from './logparse';

const log = (message: string, level = 'error') => ({ level, message });
const OPTS = '{"timeout":10000,"disableResponse":false}';

describe('parseRouteError', () => {
	it('parses a failed publish with a Z-Stack status', () => {
		expect(parseRouteError(log(`Publish 'set' 'state' to '0xa4c1381504f7ffff' failed: 'Error: ZCL command 0xa4c1381504f7ffff/1 genOnOff.on({}, ${OPTS}) failed (Data request failed with error: 'MAC_TRANSACTION_EXPIRED' (0xf0))'`)))
			.toEqual({ kind: 'command_failed', code: 'MAC_TRANSACTION_EXPIRED', ieee: '0xa4c1381504f7ffff', name: '0xa4c1381504f7ffff', final: true });
	});

	it('parses a failed publish with a timeout', () => {
		expect(parseRouteError(log(`z2m: Publish 'set' 'identify' to 'Window Slaapkamer 2' failed: 'Error: ZCL command 0x00158d000202bb70/1 genIdentify.identify({"identifytime":3}, ${OPTS}) failed (Timeout after 10000ms [address=40756 endpoint=1 clusterId=3 cmdId=11 tsn=29])'`)))
			.toEqual({ kind: 'command_failed', code: 'TIMEOUT', ieee: '0x00158d000202bb70', name: 'Window Slaapkamer 2', final: true });
	});

	it('parses ping attempts; only n/n is final', () => {
		const ping = (i: number) => log(`Failed to ping 'Office desk right' (attempt ${i}/2, ZCL command 0x001788010c65c66c/11 genBasic.read(["zclVersion"], ${OPTS}) failed (Data request failed with error: 'MAC_NO_ACK' (0xe9)))`, 'warning');
		expect(parseRouteError(ping(1))).toEqual({ kind: 'ping_failed', code: 'MAC_NO_ACK', ieee: '0x001788010c65c66c', name: 'Office desk right', final: false });
		expect(parseRouteError(ping(2))).toMatchObject({ final: true });
	});

	it('keeps the name when the IEEE is missing', () => {
		expect(parseRouteError(log(`Failed to ping 'it's mine' (attempt 1/1, something else failed)`, 'warning')))
			.toEqual({ kind: 'ping_failed', code: null, ieee: null, name: "it's mine", final: true });
	});

	it('ignores other lines and non-log payloads', () => {
		expect(parseRouteError(log('Failed to execute LQI for \'lamp\''))).toBeNull();
		expect(parseRouteError(log("No converter available for 'x' 'y' (1)"))).toBeNull();
		expect(parseRouteError('Failed to ping')).toBeNull();
		expect(parseRouteError(null)).toBeNull();
		expect(parseRouteError({ level: 'info' })).toBeNull();
	});

	describe('real fixture', () => {
		const lines = loadFixture('z2m-logging').map((m) => m.payload as { level: string; message: string });
		const failures = lines.filter((l) => l.message.startsWith('z2m: Failed to ping'));
		const echoes = lines.filter((l) => l.message.startsWith('z2m:mqtt:'));

		it('has the expected shapes', () => {
			expect([failures.length, echoes.length, lines.length]).toEqual([10, 25, 35]);
			expect(echoes.filter((l) => /fail|error/i.test(l.message)).length).toBeGreaterThanOrEqual(5);
		});

		it('parses every real failure', () => {
			for (const l of failures) {
				const r = parseRouteError(l);
				expect(r, l.message).toMatchObject({ kind: 'ping_failed', ieee: expect.stringMatching(/^0x[0-9a-f]{16}$/) });
				expect(['TIMEOUT', 'MAC_NO_ACK', 'NWK_NO_ROUTE']).toContain(r!.code);
				expect(r!.final).toBe(/attempt (\d)\/\1,/.test(l.message));
			}
		});

		it('never treats MQTT publish echoes as route errors', () => {
			for (const l of echoes) expect(parseRouteError(l), l.message).toBeNull();
		});
	});
});
