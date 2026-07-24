import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';

const commands = [
	['node', ['--test', ...globSync('packages/tinyfat-awareness/src/*.test.mjs')], {}],
	['node', ['--test', ...globSync('packages/tinyfat-customer-identity/src/*.test.mjs')], {}],
	['node', ['--test', ...globSync('packages/tinyfat-collaboration/src/*.test.mjs')], {}],
	['node', ['--test', ...globSync('packages/tinyfat-sendly/src/*.test.mjs')], {}],
	['node', ['--test', ...globSync('packages/tinyfat-rocket-projection/src/*.test.mjs')], {}],
	['node', ['scripts/check-foss-tree.mjs'], {}],
];

if (process.env.TINYFAT_VERIFY_ROCKET === '1') {
	for (const name of ['ROCKETCHAT_URL', 'ROCKETCHAT_USER_ID', 'ROCKETCHAT_AUTH_TOKEN']) {
		if (!process.env[name]) throw new Error(`${name} is required when TINYFAT_VERIFY_ROCKET=1`);
	}
	commands.push(['node', ['scripts/spike-local-cross-channel.mjs'], {}]);
}

for (const [command, args, options] of commands) {
	console.log(`\n$ ${command} ${args.join(' ')}`);
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		env: process.env,
		encoding: 'utf8',
		stdio: 'inherit',
		...options,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(JSON.stringify({
	ok: true,
	focusedPackages: 5,
	rocketIntegration: process.env.TINYFAT_VERIFY_ROCKET === '1' ? 'passed' : 'skipped',
}, null, 2));
