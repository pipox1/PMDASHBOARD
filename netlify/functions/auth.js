const fetch = require('node-fetch');

const CLIENT_ID = process.env.PROCORE_CLIENT_ID;
const CLIENT_SECRET = process.env.PROCORE_CLIENT_SECRET;
const AUTH_URL = process.env.PROCORE_AUTH_URL || 'https://login.procore.com';
const SITE_URL = process.env.SITE_URL || 'https://pmdashboardflutec.netlify.app';
const REDIRECT_URI = `${SITE_URL}/.netlify/functions/auth/callback`;

exports.handler = async (event, context) => {
  const path = event.path.replace('/.netlify/functions/auth', '');

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Step 1: Redirect to Procore login
  if (path === '' || path === '/') {
    const authUrl = `${AUTH_URL}/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    console.log('Redirecting to:', authUrl);
    console.log('Redirect URI:', REDIRECT_URI);
    return {
      statusCode: 302,
      headers: { Location: authUrl },
      body: ''
    };
  }

  // Step 2: Handle callback from Procore
  if (path === '/callback') {
    const code = event.queryStringParameters?.code;
    const error = event.queryStringParameters?.error;

    if (error) {
      console.error('OAuth error:', error);
      return {
        statusCode: 302,
        headers: { Location: `${SITE_URL}?error=${error}` },
        body: ''
      };
    }

    if (!code) {
      console.error('No authorization code received');
      return {
        statusCode: 302,
        headers: { Location: `${SITE_URL}?error=no_code` },
        body: ''
      };
    }

    try {
      console.log('Exchanging code for token...');
      console.log('Using redirect URI:', REDIRECT_URI);

      const tokenResponse = await fetch(`${AUTH_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI
        })
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error('Token exchange failed:', JSON.stringify(tokenData));
        return {
          statusCode: 302,
          headers: { Location: `${SITE_URL}?error=token_failed` },
          body: ''
        };
      }

      console.log('Token obtained successfully');

      // Redirect back to app with tokens in URL hash
      const redirectUrl = `${SITE_URL}/#access_token=${tokenData.access_token}&refresh_token=${tokenData.refresh_token || ''}&expires_in=${tokenData.expires_in || 7200}&token_type=${tokenData.token_type || 'Bearer'}`;

      return {
        statusCode: 302,
        headers: { Location: redirectUrl },
        body: ''
      };

    } catch (error) {
      console.error('Auth callback error:', error.message);
      return {
        statusCode: 302,
        headers: { Location: `${SITE_URL}?error=server_error` },
        body: ''
      };
    }
  }

  // Status endpoint for testing
  if (path === '/status') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        redirect_uri: REDIRECT_URI,
        client_id_set: !!CLIENT_ID,
        client_secret_set: !!CLIENT_SECRET
      })
    };
  }

  return {
    statusCode: 404,
    headers,
    body: JSON.stringify({ error: 'Not found' })
  };
};