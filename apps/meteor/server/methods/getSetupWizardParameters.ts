import type { ISetting } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Settings } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		getSetupWizardParameters(): Promise<{
			settings: ISetting[];
			skipCloudRegistration: boolean;
		}>;
	}
}

Meteor.methods<ServerMethods>({
	async getSetupWizardParameters() {
		const setupWizardSettings = await Settings.findSetupWizardSettings().toArray();

		return {
			settings: setupWizardSettings,
			// TinyFat Business OS is self-managed. Initial setup must never
			// create a Rocket.Chat Cloud registration intent.
			skipCloudRegistration: true,
		};
	},
});
