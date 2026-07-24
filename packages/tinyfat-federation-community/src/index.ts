import { randomBytes } from 'node:crypto';

const federatedUsernamePattern = /^@[^:\s]+:[^:\s]+$/;

export const validateFederatedUsername = (username: string): boolean => federatedUsernamePattern.test(username);

export const generateEd25519RandomSecretKey = (): Buffer => randomBytes(32);
