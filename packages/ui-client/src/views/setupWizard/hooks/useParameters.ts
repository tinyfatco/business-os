import type { ISetting } from '@rocket.chat/core-typings';
import { useMethod } from '@rocket.chat/ui-contexts';
import type { UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';

type SetupWizardParameters = {
	settings: ISetting[];
	skipCloudRegistration: boolean;
};

export const useParameters = (): Exclude<UseQueryResult<SetupWizardParameters, Error>, { data: undefined }> => {
	const getSetupWizardParameters = useMethod('getSetupWizardParameters');

	return useQuery({
		queryKey: ['setupWizard/parameters'],
		queryFn: getSetupWizardParameters,
		initialData: {
			settings: [],
			skipCloudRegistration: true,
		},
	}) as Exclude<UseQueryResult<SetupWizardParameters, Error>, { data: undefined }>;
};
