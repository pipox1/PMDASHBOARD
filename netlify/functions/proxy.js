const fetch = require('node-fetch');

const BASE_URL = process.env.PROCORE_BASE_URL || 'https://api.procore.com';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'No authorization token provided' })
    };
  }

  const { endpoint, company_id } = event.queryStringParameters || {};
  if (!endpoint) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'No endpoint specified' })
    };
  }

  try {
    // Build URL - handle both cases where endpoint might include query params
    let url;
    if (endpoint.startsWith('http')) {
      url = endpoint;
    } else {
      url = `${BASE_URL}${endpoint}`;
    }
    
    console.log(`[Proxy] ${event.httpMethod} → ${url}`);

    const requestHeaders = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    if (company_id) {
      requestHeaders['Procore-Company-Id'] = company_id;
    }

    const response = await fetch(url, {
      method: event.httpMethod === 'POST' ? 'POST' : 'GET',
      headers: requestHeaders,
      body: event.httpMethod === 'POST' ? event.body : undefined
    });

    const responseText = await response.text();
    let responseData;

    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { raw: responseText };
    }

    if (!response.ok) {
      console.error(`[Proxy] Error ${response.status}:`, responseText.substring(0, 500));
    } else {
      console.log(`[Proxy] Success ${response.status}`);
    }

    return {
      statusCode: response.status,
      headers,
      body: JSON.stringify(responseData)
    };

  } catch (error) {
    console.error('[Proxy] Error:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: `Proxy error: ${error.message}` })
    };
  }
};
