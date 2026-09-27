/**
 * The OAuth apps Axon signs in with. These are public identifiers, not secrets:
 * - GitHub: an OAuth App (github.com/settings/developers) with "Enable Device Flow" ticked. No secret is used.
 * - Google: a Google Cloud OAuth client of type "Desktop app". Google documents a Desktop client's
 *   secret as not confidential (it ships inside every installed app); it is required only by the token call.
 * Empty means "not configured": Settings says so instead of offering a sign-in that can't work.
 * The environment overrides them for development builds.
 */
export const GITHUB_CLIENT_ID = process.env.AXON_GITHUB_CLIENT_ID || '';
export const GOOGLE_CLIENT_ID = process.env.AXON_GOOGLE_CLIENT_ID || '';
export const GOOGLE_CLIENT_SECRET = process.env.AXON_GOOGLE_CLIENT_SECRET || '';

/** A connector's OAuth app from the environment (`AXON_SLACK_CLIENT_ID` and so on), when this build has one. */
export function clientFromEnv(idVar?: string, secretVar?: string, env: NodeJS.ProcessEnv = process.env): { clientId: string; clientSecret?: string } | undefined {
  const clientId = idVar ? env[idVar]?.trim() : '';
  if (!clientId) return undefined;
  const clientSecret = secretVar ? env[secretVar]?.trim() : '';
  return clientSecret ? { clientId, clientSecret } : { clientId };
}
