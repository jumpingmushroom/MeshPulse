// adapter-node assumes https unless PROTOCOL_HEADER names a header; direct http://host:3000
// access sends none, so SvelteKit's CSRF origin check rejects every form post. Default it to http.
// A TLS proxy that sends x-forwarded-proto still wins.
// Not a custom server around build/handler.js: that would lose adapter-node's graceful
// shutdown, SHUTDOWN_TIMEOUT and socket activation.
import http from 'node:http';

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, ...rest) {
	if (event === 'request') req.headers['x-forwarded-proto'] ??= 'http';
	return emit.call(this, event, req, ...rest);
};
