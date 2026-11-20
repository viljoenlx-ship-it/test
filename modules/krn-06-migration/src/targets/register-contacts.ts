import { krn02PartyDirectory } from '../bridge/krn02-party';
import { createContactsTarget } from './contacts';

/**
 * Contacts are stored by KRN-02.
 * This file is the only place that chooses that directory.
 */
export const contactsTarget = createContactsTarget(krn02PartyDirectory);
