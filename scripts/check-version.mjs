import { readFileSync } from 'node:fs';

const tag = process.argv[2];
const pkg = JSON.parse(readFileSync('package.json', 'utf8')).version;
const addon = readFileSync('addon/meshpulse/config.yaml', 'utf8').match(/^version:\s*["']?([^"'\s]+)/m)?.[1];
if (!tag || tag !== pkg || tag !== addon) {
	console.error(`Version mismatch: tag ${tag}, package.json ${pkg}, config.yaml ${addon}`);
	process.exit(1);
}
