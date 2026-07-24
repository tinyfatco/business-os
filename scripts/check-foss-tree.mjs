import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const restrictedRoots = ['ee', 'apps/meteor/ee'];
const removedWorkspacePackages = [
	'@rocket.chat/abac',
	'@rocket.chat/federation-matrix',
	'@rocket.chat/license',
	'@rocket.chat/media-calls',
	'@rocket.chat/network-broker',
	'@rocket.chat/omni-core-ee',
	'@rocket.chat/omnichannel-services',
	'@rocket.chat/pdf-worker',
	'@rocket.chat/presence',
];
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
const restrictedWorkspace = packageJson.workspaces.find(
	(workspace) => workspace === 'ee' || workspace.startsWith('ee/') || workspace.includes('/ee/'),
);

if (restrictedWorkspace) {
	failures.push(`restricted workspace pattern remains: ${restrictedWorkspace}`);
}

const workspaceManifests = packageJson.workspaces.flatMap((pattern) => {
	const root = pattern.replace(/\/\*$/, '');

	if (!existsSync(root)) {
		return [];
	}

	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(root, entry.name, 'package.json'))
		.filter(existsSync)
		.map((file) => ({ file, manifest: JSON.parse(readFileSync(file, 'utf8')) }));
});
const workspaceNames = new Set(workspaceManifests.map(({ manifest }) => manifest.name).filter(Boolean));
const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

for (const { file, manifest } of workspaceManifests) {
	for (const section of dependencySections) {
		for (const [name, range] of Object.entries(manifest[section] ?? {})) {
			if (removedWorkspacePackages.includes(name)) {
				failures.push(`removed workspace package ${name} remains in ${file}`);
			}

			if (typeof range === 'string' && range.startsWith('workspace:') && !workspaceNames.has(name)) {
				failures.push(`unresolved workspace dependency ${name} remains in ${file}`);
			}
		}
	}
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

const setupParametersPath = 'apps/meteor/server/methods/getSetupWizardParameters.ts';
const cloudStartupPath = 'apps/meteor/server/startup/cloudRegistration.ts';

if (!existsSync(setupParametersPath) || !readFileSync(setupParametersPath, 'utf8').includes('skipCloudRegistration: true')) {
	failures.push('self-managed setup does not explicitly skip Rocket.Chat Cloud registration');
}

if (!existsSync(cloudStartupPath) || readFileSync(cloudStartupPath, 'utf8').includes('Settings.updateValueById')) {
	failures.push('startup can still force Rocket.Chat Cloud registration');
}

if (failures.length > 0) {
	for (const failure of failures) {
		console.error(`FOSS boundary failure: ${failure}`);
	}

	process.exit(1);
}

console.log('FOSS boundary verified: restricted source is absent, FOSS startup is active, and setup is self-managed.');
