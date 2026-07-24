import { OmnichannelSourceType } from '@rocket.chat/core-typings';
import { LivechatContacts, LivechatRooms } from '@rocket.chat/models';
import { registerGuest } from '@rocket.chat/omni-core';
import { check, Match } from 'meteor/check';
import { Meteor } from 'meteor/meteor';

import { API } from '../../../../api/server';
import { settings } from '../../../../settings/server';
import { createRoom } from '../../lib/rooms';
import { findAgent } from '../lib/livechat';

const sourceTypes = new Set<string>([OmnichannelSourceType.EMAIL, OmnichannelSourceType.SMS, OmnichannelSourceType.API]);

/**
 * Host-only ingress seam for TinyFat provider adapters.
 *
 * Rocket's public Livechat room route intentionally labels every non-widget
 * integration as `api`. TinyFat hostd has already authenticated and journaled
 * provider ingress, so this authenticated endpoint preserves the real source
 * (email or SMS) while delegating contact creation, room routing, analytics,
 * and agent assignment to Rocket's native Omnichannel implementation.
 */
API.v1.addRoute(
	'tinyfat/omnichannel/conversation',
	{
		authRequired: true,
		permissionsRequired: ['manage-livechat-agents'],
	},
	{
		async post() {
			check(this.bodyParams, {
				visitor: {
					token: String,
					name: String,
					username: String,
					email: Match.Maybe(String),
					phone: Match.Maybe(String),
				},
				source: {
					type: String,
					id: String,
					label: String,
					destination: String,
				},
				agentId: String,
				verified: Boolean,
			});

			const { visitor: visitorInput, source, agentId, verified } = this.bodyParams;
			if (!sourceTypes.has(source.type)) {
				throw new Meteor.Error('error-invalid-source', 'TinyFat Omnichannel source must be email, sms, or api');
			}
			if (source.type === OmnichannelSourceType.EMAIL && !visitorInput.email) {
				throw new Meteor.Error('error-invalid-email', 'TinyFat email ingress requires a visitor email');
			}
			if (source.type === OmnichannelSourceType.SMS && !visitorInput.phone) {
				throw new Meteor.Error('error-invalid-phone', 'TinyFat SMS ingress requires a visitor phone');
			}

			const visitor = await registerGuest(
				{
					token: visitorInput.token,
					name: visitorInput.name,
					username: visitorInput.username,
					...(visitorInput.email ? { email: visitorInput.email } : {}),
					...(visitorInput.phone ? { phone: { number: visitorInput.phone } } : {}),
				},
				{
					shouldConsiderIdleAgent: settings.get<boolean>('Livechat_enabled_when_agent_idle'),
					shouldConsiderOfflineAgent: settings.get<boolean>('Livechat_accept_chats_with_no_agents'),
				},
			);
			if (!visitor) {
				throw new Meteor.Error('error-livechat-visitor-registration', 'Error registering TinyFat visitor');
			}

			const sourceDetails = {
				type: source.type as OmnichannelSourceType,
				id: source.id,
				alias: source.label,
				label: source.label,
				destination: source.destination,
			};
			const verifyRoom = async <TRoom extends { _id: string; verified?: boolean }>(room: TRoom): Promise<TRoom> => {
				if (!verified) {
					return room;
				}
				await Promise.all([
					LivechatContacts.setChannelVerifiedStatus(
						{
							visitorId: visitor._id,
							source: {
								type: sourceDetails.type,
								id: sourceDetails.id,
							},
						},
						true,
					),
					LivechatRooms.updateOne({ _id: room._id }, { $set: { verified: true } }),
				]);
				return { ...room, verified: true };
			};

			const existing = await LivechatRooms.findOneOpenByVisitorToken(visitor.token, {});
			if (existing) {
				return API.v1.success({ visitor, room: await verifyRoom(existing), newRoom: false });
			}

			const agentInfo = await findAgent(agentId);
			const agent = agentInfo && !('hiddenInfo' in agentInfo) ? { agentId, username: agentInfo.username } : { agentId };
			const room = await createRoom({
				visitor,
				roomInfo: {
					source: sourceDetails,
				},
				agent,
			});

			return API.v1.success({ visitor, room: await verifyRoom(room), newRoom: true });
		},
	},
);
