var procoreAPI = null;

(function() {

function ProcoreAPI() {
  this.accessToken = null;
  this.refreshToken = null;
  this.proxyUrl = '/.netlify/functions/proxy';
}

ProcoreAPI.prototype.setTokens = function(accessToken, refreshToken) {
  this.accessToken = accessToken;
  this.refreshToken = refreshToken;
  localStorage.setItem('pm_access_token', accessToken);
  if (refreshToken) localStorage.setItem('pm_refresh_token', refreshToken);
};

ProcoreAPI.prototype.loadTokens = function() {
  this.accessToken = localStorage.getItem('pm_access_token');
  this.refreshToken = localStorage.getItem('pm_refresh_token');
  return !!this.accessToken;
};

ProcoreAPI.prototype.clearTokens = function() {
  this.accessToken = null;
  this.refreshToken = null;
  localStorage.removeItem('pm_access_token');
  localStorage.removeItem('pm_refresh_token');
  localStorage.removeItem('pm_company_id');
};

ProcoreAPI.prototype.refreshAccessToken = async function() {
  if (!this.refreshToken) throw new Error('No refresh token');
  var response = await fetch('/.netlify/functions/token-refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: this.refreshToken })
  });
  if (!response.ok) throw new Error('Token refresh failed');
  var data = await response.json();
  this.setTokens(data.access_token, data.refresh_token || this.refreshToken);
  return data;
};

ProcoreAPI.prototype.apiCall = async function(endpoint, companyId, retried) {
  if (!this.accessToken) throw new Error('Not authenticated');

  var params = new URLSearchParams({ endpoint: endpoint });
  if (companyId) params.append('company_id', companyId);

  var response = await fetch(this.proxyUrl + '?' + params.toString(), {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + this.accessToken,
      'Content-Type': 'application/json'
    }
  });

  if (response.status === 401 && !retried && this.refreshToken) {
    await this.refreshAccessToken();
    return this.apiCall(endpoint, companyId, true);
  }

  if (!response.ok) {
    var errorBody = await response.text();
    throw new Error('API Error ' + response.status + ': ' + errorBody.substring(0, 200));
  }

  return response.json();
};

ProcoreAPI.prototype.getCompanies = function() {
  console.log('[API] Getting companies...');
  return this.apiCall('/rest/v1.0/companies');
};

ProcoreAPI.prototype.getProjects = function(companyId) {
  console.log('[API] Getting projects...');
  return this.apiCall('/rest/v1.0/projects?company_id=' + companyId + '&per_page=300', companyId);
};

ProcoreAPI.prototype.getProjectDetail = function(companyId, projectId) {
  console.log('[API] Getting project detail ' + projectId + '...');
  return this.apiCall('/rest/v1.0/projects/' + projectId + '?company_id=' + companyId, companyId);
};

ProcoreAPI.prototype.getMe = function() {
  return this.apiCall('/rest/v1.0/me');
};

ProcoreAPI.prototype.getUser = function(companyId, userId) {
  console.log('[API] Getting user ' + userId + '...');
  return this.apiCall('/rest/v1.0/companies/' + companyId + '/users/' + userId, companyId);
};

// Try multiple schedule endpoints
ProcoreAPI.prototype.getScheduleTasks = async function(companyId, projectId) {
  console.log('[API] Getting schedule tasks for ' + projectId + '...');
  
  // Try new Schedule API first
  try {
    var result = await this.apiCall(
      '/rest/v1.0/projects/' + projectId + '/schedule/tasks?per_page=10000',
      companyId
    );
    if (result && Array.isArray(result) && result.length > 0) {
      console.log('[API] Schedule tasks found (new API): ' + result.length);
      return result;
    }
  } catch (e) {
    console.log('[API] New schedule API failed, trying legacy...');
  }

  // Try Legacy Schedule API
  try {
    var result2 = await this.apiCall(
      '/rest/v1.0/schedule_tasks?project_id=' + projectId + '&per_page=10000',
      companyId
    );
    if (result2 && Array.isArray(result2) && result2.length > 0) {
      console.log('[API] Schedule tasks found (legacy): ' + result2.length);
      return result2;
    }
  } catch (e2) {
    console.log('[API] Legacy schedule API also failed');
  }

  // Try v1.1 API
  try {
    var result3 = await this.apiCall(
      '/rest/v1.1/projects/' + projectId + '/schedule/tasks?per_page=10000',
      companyId
    );
    if (result3 && Array.isArray(result3) && result3.length > 0) {
      console.log('[API] Schedule tasks found (v1.1): ' + result3.length);
      return result3;
    }
  } catch (e3) {
    console.log('[API] v1.1 schedule API also failed');
  }

  // Return empty array if all fail
  return [];
};

// Proxy image URL to avoid CORS issues
ProcoreAPI.prototype.getProxiedImageUrl = function(originalUrl) {
  if (!originalUrl) return null;
  return '/.netlify/functions/image-proxy?url=' + encodeURIComponent(originalUrl);
};

procoreAPI = new ProcoreAPI();
console.log('[API] Module loaded.');

})();
