import { describe, expect, it } from 'vitest';
import { openDb } from '../db/index';
import { settings } from '../db/schema';
import { getWifiConfig, getWifiForm, saveWifiConfig } from './config';

const input = { url: 'https://192.168.1.1', site: 'default', user: 'meshpulse', password: 'hunter2' };

describe('wifi config', () => {
	it('round-trips and encrypts the password at rest', () => {
		const db = openDb(':memory:');
		expect(getWifiConfig(db, 'k')).toBeNull();
		saveWifiConfig(db, 'k', input);
		expect(getWifiConfig(db, 'k')).toEqual(input);
		expect(JSON.stringify(db.select().from(settings).all())).not.toContain('hunter2');
	});
	it('an empty password keeps the stored one', () => {
		const db = openDb(':memory:');
		saveWifiConfig(db, 'k', input);
		saveWifiConfig(db, 'k', { ...input, user: 'other', password: '' });
		expect(getWifiConfig(db, 'k')).toEqual({ ...input, user: 'other' });
		saveWifiConfig(db, 'k', { ...input, url: 'http://new', password: '' }); // another controller: never reused
		expect(getWifiForm(db).passwordSet).toBe(false);
	});
	it('the page form never carries the password', () => {
		const db = openDb(':memory:');
		saveWifiConfig(db, 'k', input);
		const f = getWifiForm(db);
		expect(f.passwordSet).toBe(true);
		expect(JSON.stringify(f)).not.toContain('hunter2');
		expect(Object.keys(f)).not.toContain('password');
	});
	it('a wrong SECRET_KEY reads as not configured', () => {
		const db = openDb(':memory:');
		saveWifiConfig(db, 'k', input);
		expect(getWifiConfig(db, 'other')).toBeNull();
	});
});
