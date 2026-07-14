import 'dotenv/config';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { google } from 'googleapis';

/**
 * One-time local helper to obtain a Google OAuth2 refresh token for the Calendar provider.
 * Google only returns a refresh token on the *first* consent grant with `access_type: offline`
 * (or if the app is re-authorized after being revoked), so this needs to run interactively once,
 * not as part of the sync pipeline itself.
 *
 * Usage: npx tsx scripts/google-oauth-init.ts
 * (requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI already set in .env,
 * with GOOGLE_REDIRECT_URI pointing at this script's local callback, e.g.
 * http://localhost:3000/oauth/google/callback)
 */
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

async function main(): Promise<void> {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const redirectUri = process.env['GOOGLE_REDIRECT_URI'];

  if (!clientId || !clientSecret || !redirectUri) {
    console.error(
      'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env first.',
    );
    process.exitCode = 1;
    return;
  }

  const redirectUrl = new URL(redirectUri);
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const consentUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces Google to reissue a refresh token even on repeat runs
    scope: SCOPES,
  });

  console.log('\n1. Open this URL in a browser and approve access:\n');
  console.log(consentUrl);
  console.log(`\n2. Waiting for the redirect back to ${redirectUri} ...\n`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url) return;
      const url = new URL(req.url, `http://${redirectUrl.host}`);
      const authCode = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400).end(`Authorization failed: ${error}. You can close this tab.`);
        server.close();
        reject(new Error(`Google returned an error: ${error}`));
        return;
      }
      if (authCode) {
        res
          .writeHead(200)
          .end('Authorization received — you can close this tab and return to the terminal.');
        server.close();
        resolve(authCode);
      }
    });
    server.listen(Number(redirectUrl.port) || 80);
  });

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      '\nGoogle did not return a refresh token. This happens if the app was already authorized ' +
        'before; revoke access at https://myaccount.google.com/permissions and run this script again.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('\nSuccess. Add this to your .env:\n');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((error: unknown) => {
  console.error('Google OAuth init failed:', error);
  process.exitCode = 1;
});
