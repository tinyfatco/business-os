import { api } from '@rocket.chat/core-services';

import { AuthorizationLivechat } from '../../app/livechat/server/roomAccessValidator.internalService';
import { isRunningMs } from '../lib/isRunningMs';
import { AnalyticsService } from './analytics/service';
import { AppsEngineService } from './apps-engine/service';
import { BannerService } from './banner/service';
import { CalendarService } from './calendar/service';
import { CallHistoryService } from './call-history/service';
import { DeviceManagementService } from './device-management/service';
import { MediaService } from './image/service';
import { ImportService } from './import/service';
import { LDAPService } from './ldap/service';
import { MessageService } from './messages/service';
import { MeteorService } from './meteor/service';
import { NPSService } from './nps/service';
import { OmnichannelService } from './omnichannel/service';
import { OmnichannelAnalyticsService } from './omnichannel-analytics/service';
import { OmnichannelIntegrationService } from './omnichannel-integrations/service';
import { PushService } from './push/service';
import { RoomService } from './room/service';
import { SAUMonitorService } from './sauMonitor/service';
import { SettingsService } from './settings/service';
import { TeamService } from './team/service';
import { UiKitCoreAppService } from './uikit-core-app/service';
import { UploadService } from './upload/service';
import { UserService } from './user/service';
import { VideoConfService } from './video-conference/service';

export const registerServices = async (): Promise<void> => {
	api.registerService(new AppsEngineService());
	api.registerService(new AnalyticsService());
	api.registerService(new AuthorizationLivechat());
	api.registerService(new BannerService());
	api.registerService(new CalendarService());
	api.registerService(new LDAPService());
	api.registerService(new MediaService());
	api.registerService(new MeteorService());
	api.registerService(new NPSService());
	api.registerService(new RoomService());
	api.registerService(new SAUMonitorService());
	api.registerService(new OmnichannelService());
	api.registerService(new TeamService());
	api.registerService(new UiKitCoreAppService());
	api.registerService(new PushService());
	api.registerService(new DeviceManagementService());
	api.registerService(new VideoConfService());
	api.registerService(new UploadService());
	api.registerService(new MessageService());
	api.registerService(new SettingsService());
	api.registerService(new OmnichannelIntegrationService());
	api.registerService(new ImportService());
	api.registerService(new OmnichannelAnalyticsService());
	api.registerService(new UserService());
	api.registerService(new CallHistoryService());

	// if the process is running in micro services mode we don't need to register services that will run separately
	if (!isRunningMs()) {
		const { Authorization } = await import('./authorization/service');

		api.registerService(new Authorization());
	}
};
