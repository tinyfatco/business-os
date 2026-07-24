import { License } from '@tinyfat/community-policy';

import { ContactImporter } from './ContactImporter';
import { Importers } from '../../importer/server';

License.onValidFeature('contact-id-verification', () => {
	Importers.add({
		key: 'omnichannel_contact',
		name: 'omnichannel_contacts_importer',
		importer: ContactImporter,
	});
});
