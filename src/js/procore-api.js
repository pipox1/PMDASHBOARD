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
  try {
    var response = await fetch('/.netlify/functions/token-refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.refreshToken })
    });
    if (!response.ok) throw new Error('Refresh failed');
    var data = await response.json();
    this.setTokens(data.access_token, data.refresh_token || this.refreshToken);
    return data;
  } catch (e) {
    this.clearTokens();
    throw e;
  }
};

ProcoreAPI.prototype.apiCall = async function(endpoint, companyId, retried) {
  if (!this.accessToken) throw new Error('Not authenticated');

  var params = new URLSearchParams({ endpoint: endpoint });
  if (companyId) params.append('company_id', companyId);

  try {
    var response = await fetch(this.proxyUrl + '?' + params.toString(), {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + this.accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401 && !retried && this.refreshToken) {
      console.log('[API] Token expired, refreshing...');
      await this.refreshAccessToken();
      return this.apiCall(endpoint, companyId, true);
    }

    if (!response.ok) {
      var errText = await response.text();
      throw new Error('API Error ' + response.status + ': ' + errText.substring(0, 200));
    }

    return response.json();
  } catch (e) {
    if (e.message.indexOf('401') > -1 && !retried) this.clearTokens();
    throw e;
  }
};

ProcoreAPI.prototype.getCompanies = function() {
  console.log('[API] Getting companies...');
  return this.apiCall('/rest/v1.0/companies');
};

ProcoreAPI.prototype.getProjects = function(companyId) {
  console.log('[API] Getting projects...');
  return this.apiCall('/rest/v1.0/projects?company_id=' + companyId + '&per_page=300', companyId);
};

// KEY FIX: Get project detail with custom_fields to find PM
ProcoreAPI.prototype.getProjectDetail = function(companyId, projectId) {
  console.log('[API] Getting project detail ' + projectId + '...');
  return this.apiCall(
    '/rest/v1.0/projects/' + projectId + '?company_id=' + companyId,
    companyId
  );
};

// NEW: Get project users/roles to find who is the PM
ProcoreAPI.prototype.getProjectRoles = function(companyId, projectId) {
  console.log('[API] Getting project roles for ' + projectId + '...');
  return this.apiCall(
    '/rest/v1.1/projects/' + projectId + '/project_roles?company_id=' + companyId + '&per_page=100',
    companyId
  );
};

// NEW: Alternative - get project assignments 
ProcoreAPI.prototype.getProjectAssignments = function(companyId, projectId) {
  return this.apiCall(
    '/rest/v1.0/projects/' + projectId + '/users?per_page=300',
    companyId
  );
};

// NEW: Get custom fields for a project (PM might be in custom_fields)
ProcoreAPI.prototype.getProjectCustomFields = function(companyId, projectId) {
  return this.apiCall(
    '/rest/v1.0/projects/' + projectId + '/custom_field_values?company_id=' + companyId,
    companyId
  );
};

ProcoreAPI.prototype.getMe = function() {
  return this.apiCall('/rest/v1.0/me');
};

ProcoreAPI.prototype.getUser = function(companyId, userId) {
  console.log('[API] Getting user ' + userId + '...');
  return this.apiCall('/rest/v1.0/companies/' + companyId + '/users/' + userId, companyId);
};

ProcoreAPI.prototype.getScheduleTasks = function(companyId, projectId) {
  console.log('[API] Getting schedule tasks for ' + projectId + '...');
  return this.apiCall(
    '/rest/v1.0/projects/' + projectId + '/schedule/tasks?per_page=10000',
    companyId
  );
};

procoreAPI = new ProcoreAPI();

})();
