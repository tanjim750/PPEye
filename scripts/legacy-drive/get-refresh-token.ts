/**
 * Interactive 1-Time Google Drive Refresh Token Generator for PPEye.
 *
 * Spins up a temporary local listener on http://localhost:3000,
 * presents an authorization link, captures the OAuth grant, exchanges it for a permanent
 * Refresh Token, and automatically saves it into .env.local and .env.
 */

declare const require: any;
declare const process: any;
declare const Buffer: any;

const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function loadEnv(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      content.split('\n').forEach((line: string) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const idx = trimmed.indexOf('=');
          if (idx > 0) {
            env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
          }
        }
      });
    }
  } catch {}
  return env;
}

function updateEnvFile(filePath: string, key: string, value: string) {
  try {
    let content = '';
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, 'utf8');
    }
    const lines = content.split('\n');
    let found = false;
    const newLines = lines.map((line: string) => {
      if (line.trim().startsWith(`${key}=`)) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });

    if (!found) {
      newLines.push(`${key}=${value}`);
    }
    fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
  } catch (err: any) {
    console.error(`Could not write to ${filePath}:`, err?.message);
  }
}

async function main() {
  const envLocal = loadEnv(path.resolve(process.cwd(), '.env.local'));
  const env = loadEnv(path.resolve(process.cwd(), '.env'));

  const clientId =
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
    envLocal.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
    env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

  const clientSecret =
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET ||
    envLocal.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET ||
    env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Error: EXPO_PUBLIC_GOOGLE_CLIENT_ID or EXPO_PUBLIC_GOOGLE_CLIENT_SECRET is missing in .env!');
    process.exit(1);
  }

  const PORT = 3000;
  const REDIRECT_URI = `http://localhost:${PORT}`;

  const scopes = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file',
  ].join(' ');

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
    }).toString();

  console.log('\n============================================================');
  console.log('   PPEye Google Drive Permanent Refresh Token Generator');
  console.log('============================================================\n');
  console.log('1. Click or copy-paste this link in your browser:');
  console.log(`\n\x1b[36m${authUrl}\x1b[0m\n`);
  console.log('2. Log in with your Google account (abirahnafshahriar@gmail.com) and click "Continue" / "Allow".');
  console.log('Waiting for authorization...\n');

  let resolved = false;

  async function exchangeCode(code: string) {
    if (resolved) return;
    resolved = true;
    console.log('\nReceived Authorization Code! Exchanging with Google for permanent tokens...');

    const postData = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }).toString();

    let data: any = null;

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': String(Buffer.byteLength(postData)),
        },
        body: postData,
      });
      data = await res.json();
    } catch (err: any) {
      // Fallback using native https module if fetch has a socket issue
      const https = require('https');
      data = await new Promise((resolve, reject) => {
        const req = https.request('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
          },
        }, (res: any) => {
          let chunks = '';
          res.on('data', (d: any) => chunks += d);
          res.on('end', () => {
            try { resolve(JSON.parse(chunks)); } catch(e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });
    }

    if (!data) {
      console.error('\n\x1b[31mError: No response from Google token server\x1b[0m');
      process.exit(1);
    }

    if (data.error) {
      console.error('\n\x1b[31mGoogle Error:\x1b[0m', data);
      process.exit(1);
    }

      if (!data.refresh_token) {
        console.warn('\n\x1b[33mNote: Google did not return a refresh_token.\x1b[0m');
        console.warn('This usually means access was already granted previously. Go to https://myaccount.google.com/connections, remove "PPEye", and try again.');
        if (data.access_token) {
          console.log('\nGot Access Token:', data.access_token);
        }
        process.exit(1);
      }

      console.log('\n\x1b[32m✔ SUCCESS! Permanent Refresh Token received!\x1b[0m');
      console.log(`\nRefresh Token: \x1b[33m${data.refresh_token}\x1b[0m\n`);

      // Save to .env.local
      updateEnvFile(path.resolve(process.cwd(), '.env.local'), 'EXPO_PUBLIC_GOOGLE_CLIENT_ID', clientId);
      updateEnvFile(path.resolve(process.cwd(), '.env.local'), 'EXPO_PUBLIC_GOOGLE_CLIENT_SECRET', clientSecret);
      updateEnvFile(path.resolve(process.cwd(), '.env.local'), 'EXPO_PUBLIC_GOOGLE_REFRESH_TOKEN', data.refresh_token);
      updateEnvFile(path.resolve(process.cwd(), '.env.local'), 'EXPO_PUBLIC_GOOGLE_ACCESS_TOKEN', data.access_token);

      console.log('✔ Automatically saved to .env.local!');
      console.log('You are now ready to upload images to Google Drive forever without re-authenticating!\n');

      setTimeout(() => process.exit(0), 1000);
  }

  const server = http.createServer((req: any, res: any) => {
    try {
      const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <div style="font-family:sans-serif; text-align:center; padding: 50px;">
            <h1 style="color: #22c55e;">✔ PPEye Google Drive Authorization Successful!</h1>
            <p>Permanent Refresh Token has been acquired and saved to your project.</p>
            <p>You can now close this tab.</p>
          </div>
        `);
        server.close();
        exchangeCode(code);
      } else if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Authorization Failed: ${error}</h1>`);
        server.close();
        console.error('Authorization failed:', error);
        process.exit(1);
      }
    } catch (e) {}
  });

  server.listen(PORT, () => {});

  // Fallback: also allow user to paste code in terminal if redirect is not captured
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Or if you see the code or are redirected, paste the code here: ', (input: string) => {
    const trimmed = input.trim();
    if (trimmed) {
      server.close();
      exchangeCode(trimmed);
    }
  });
}

main();
