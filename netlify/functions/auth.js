const fetch = require('node-fetch');

const CLIENT_ID = process.env.PROCORE_CLIENT_ID;
const CLIENT_SECRET = process.env.PROCORE_CLIENT_SECRET;
const AUTH_URL = process.env.PROCORE_AUTH_URL || 'https://login.procore.com';
const SITE_URL = process.env.SITE_URL || 'https://pmdashboardflutec.netlify.app';
const REDIRECT_URI = `${SITE_URL}/.netlify/functions/auth/callback`;

exports.handler = async (event, context) => {
  const path = event.path.replace('/.netlify/functions/auth', '');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Step 1: Redirect to Procore login
  if (path === '' || path === '/') {
    const authUrl = `${AUTH_URL}/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    console.log('[Auth] Redirecting to:', authUrl);
    return {
      statusCode: 302,
      headers: { Location: authUrl },
      body: ''
    };
  }

  // Step 2: Handle callback - return HTML page that posts message to parent
  if (path === '/callback') {
    const code = event.queryStringParameters?.code;
    const error = event.queryStringParameters?.error;

    if (error) {
      console.error('[Auth] OAuth error:', error);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: `
          <html><body>
          <script>
            window.location.href = '${SITE_URL}?error=${error}';
          </script>
          </body></html>
        `
      };
    }

    if (!code) {
      console.error('[Auth] No code received');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: `
          <html><body>
          <script>
            window.location.href = '${SITE_URL}?error=no_code';
          </script>
          </body></html>
        `
      };
    }

    try {
      console.log('[Auth] Exchanging code for token...');
      
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
        console.error('[Auth] Token exchange failed:', JSON.stringify(tokenData));
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: `
            <html><body>
            <script>
              window.location.href = '${SITE_URL}?error=token_failed';
            </script>
            </body></html>
          `
        };
      }

      console.log('[Auth] Token obtained successfully!');

      // Return an HTML page that stores the token and redirects
      // This works even inside iframes
      return {
        statusCode: 200,
        headers: { 
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        },
        body: `
          <!DOCTYPE html>
          <html>
          <head><title>Authenticating...</title></head>
          <body>
            <p>Authenticating... Please wait.</p>
            <script>
              try {
                // Store tokens in localStorage
                localStorage.setItem('pm_access_token', '${tokenData.access_token}');
                ${tokenData.refresh_token ? `localStorage.setItem('pm_refresh_token', '${tokenData.refresh_token}');` : ''}
                
                // Redirect to main app
                window.location.replace('${SITE_URL}?auth=success');
              } catch(e) {
                // If localStorage fails (iframe restrictions), try parent window
                try {
                  window.top.postMessage({
                    type: 'PROCORE_AUTH',
                    access_token: '${tokenData.access_token}',
                    refresh_token: '${tokenData.refresh_token || ''}'
                  }, '*');
                } catch(e2) {
                  document.body.innerHTML = '<p>Auth error. Please try again.</p>';
                }
              }
            </script>
          </body>
          </html>
        `
      };

    } catch (error) {
      console.error('[Auth] Error:', error.message);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: `
          <html><body>
          <script>
            window.location.href = '${SITE_URL}?error=server_error';
          </script>
          </body></html>
        `
      };
    }
  }

  // Status check endpoint
  if (path === '/status') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        redirect_uri: REDIRECT_URI,
        site_url: SITE_URL,
        client_id_configured: !!CLIENT_ID,
        client_secret_configured: !!CLIENT_SECRET
      })
    };
  }

  return {
    statusCode: 404,
    headers,
    body: JSON.stringify({ error: 'Not found' })
  };
};
