type Callback = () => void | Promise<void>;

export type CommunityPolicyTag = {
	name: string;
};

export type CommunityLicenseState = {
	information: {
		trial: boolean;
	};
	supportedVersions?: {
		timestamp: number;
		[key: string]: unknown;
	};
};

const noSubscription = (): void => undefined;

export const CommunityPolicy = Object.freeze({
	hasValidLicense: (): boolean => false,
	hasModule: (_module: string): boolean => false,
	getModules: (): string[] => [],
	getTags: (): CommunityPolicyTag[] => [],
	getLicense: (): CommunityLicenseState | undefined => undefined,
	getWorkspaceUrl: (): string => '',
	getHashedWorkspaceUrl: (): string => '',
	getGuestPermissions: async (): Promise<string[]> => [],
	shouldPreventAction: async (_limit: string, _increment?: number): Promise<boolean> => false,
	onLimitReached: (_limit: string, _callback: Callback): (() => void) => noSubscription,
	onValidateLicense: (_callback: Callback): (() => void) => noSubscription,
	onInvalidateLicense: (_callback: Callback): (() => void) => noSubscription,
	onValidFeature: (_feature: string, _callback: Callback): (() => void) => noSubscription,
});

// Temporary compatibility name while surviving community code is migrated to
// the explicit CommunityPolicy vocabulary.
export const License = CommunityPolicy;

export const AirGappedRestriction = Object.freeze({
	computeRestriction: async (_token: string | undefined): Promise<void> => undefined,
});

export const applyLicense = async (_license: string, _force?: boolean): Promise<void> => undefined;

export class DuplicatedLicenseError extends Error {
	constructor(message = 'Commercial licenses are not used by TinyFat Business OS') {
		super(message);
		this.name = 'DuplicatedLicenseError';
	}
}
