import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const restrictedRoots = ['ee', 'apps/meteor/ee'];
const failures = [];

for (const root of restrictedRoots) {
	if (existsSync(root)) {
		failures.push(`restricted source directory exists: ${root}`);
	}
}

const tracked = spawnSync('git', ['ls-files', '-z'], {
	encoding: 'utf8',
});

if (tracked.status !== 0) {
	failures.push(`unable to inspect tracked files: ${tracked.stderr.trim()}`);
} else {
	const trackedPaths = tracked.stdout.split('\0').filter(Boolean);

	for (const root of restrictedRoots) {
		const prefix = `${root}/`;
		const matchedPath = trackedPaths.find((path) => path === root || path.startsWith(prefix));

		if (matchedPath) {
			failures.push(`restricted source is tracked: ${matchedPath}`);
		}
	}
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const restrictedWorkspace = packageJson.workspaces.find((workspace) => workspace === 'ee' || workspace.startsWith('ee/') || workspace.includes('/ee/'));

if (restrictedWorkspace) {
	failures.push(`restricted workspace pattern remains: ${restrictedWorkspace}`);
}

const startupPath = 'apps/meteor/startRocketChat.ts';

if (!existsSync(startupPath)) {
	failures.push(`FOSS startup module is missing: ${startupPath}`);
} else {
	const startup = readFileSync(startupPath, 'utf8');

	if (!startup.includes('used in FOSS builds')) {
		failures.push('startup module is not the reviewed Rocket.Chat FOSS startup');
	}

	if (startup.includes('@rocket.chat/license') || startup.includes('/ee/')) {
		failures.push('startup module references restricted licensing or source');
	}
}

if (failures.length > 0) {
	for (const failure of failures) {
		console.error(`FOSS boundary failure: ${failure}`);
	}

	process.exit(1);
}

console.log('FOSS boundary verified: restricted source is absent and FOSS startup is active.');
