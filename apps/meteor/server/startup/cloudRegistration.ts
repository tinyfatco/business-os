export async function ensureCloudWorkspaceRegistered(): Promise<void> {
	// TinyFat Business OS is self-managed and deliberately has no automatic
	// Rocket.Chat Cloud registration lifecycle. Keep this migration hook as a
	// no-op so existing startup sequencing remains stable.
}
