var procoreAPI = null;

(function() {

function ProcoreAPI() {
  this.accessToken = null;
  this.refreshToken = null;
  this.proxyUrl = '/.netlify/functions/proxy';
  this.cache = {};
  this.cacheExpiry = 5 * 60 * 1000;
}

ProcoreAPI.prototype.setTokens = function(at, rt) {
  this.accessToken = at;
  this.refreshToken = rt;
  localStorage.setItem('pm_access_token', at);
  if (rt) localStorage.setItem('pm_refresh_token', rt);
};

ProcoreAPI.prototype.loadTokens = function() {
  this.accessToken = localStorage.getItem('pm_access_token');
  this.refreshToken = localStorage.getItem('pm_refresh_token');
  return !!this.accessToken;
};

ProcoreAPI.prototype.clearTokens = function() {
  this.accessToken = null;
  this.refreshToken = null;
  this.cache = {};
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

ProcoreAPI.prototype.sleep = function(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
};

ProcoreAPI.prototype.apiCall = async function(endpoint, companyId, retryCount) {
  if (!this.accessToken) throw new Error('Not authenticated');
  if (!retryCount) retryCount = 0;

  // Check cache
  var cacheKey = endpoint + '|' + (companyId || '');
  var cached = this.cache[cacheKey];
  if (cached && (Date.now() - cached.time) < this.cacheExpiry) {
    return cached.data;
  }

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

    // Rate limit - auto retry with exponential backoff
    if (response.status === 429) {
      if (retryCount < 4) {
        var waitTime = Math.pow(2, retryCount + 1) * 2000;
        console.log('[API] Rate limited! Waiting ' + (waitTime / 1000) + 's... (retry ' + (retryCount + 1) + '/4)');
        await this.sleep(waitTime);
        return this.apiCall(endpoint, companyId, retryCount + 1);
      }
      throw new Error('Rate limit exceeded. Please wait a few minutes and click Retry.');
    }

    // Auth expired
    if (response.status === 401 && retryCount === 0 && this.refreshToken) {
      await this.refreshAccessToken();
      return this.apiCall(endpoint, companyId, 1);
    }

    if (!response.ok) {
      var errorBody = await response.text();
      throw new Error('API Error ' + response.status + ': ' + errorBody.substring(0, 200));
    }

    var data = await response.json();
    this.cache[cacheKey] = { data: data, time: Date.now() };
    return data;

  } catch (error) {
    if (error.message.indexOf('429') > -1 && retryCount < 4) {
      var w = Math.pow(2, retryCount + 1) * 2000;
      await this.sleep(w);
      return this.apiCall(endpoint, companyId, retryCount + 1);
    }
    throw error;
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

ProcoreAPI.prototype.getProjectDetail = function(companyId, projectId) {
  return this.apiCall('/rest/v1.0/projects/' + projectId + '?company_id=' + companyId, companyId);
};

ProcoreAPI.prototype.getMe = function() {
  return this.apiCall('/rest/v1.0/me');
};

ProcoreAPI.prototype.getUser = function(companyId, userId) {
  return this.apiCall('/rest/v1.0/companies/' + companyId + '/users/' + userId, companyId);
};

ProcoreAPI.prototype.getScheduleTasks = async function(companyId, projectId) {
  try {
    var r1 = await this.apiCall('/rest/v1.0/projects/' + projectId + '/schedule/tasks?per_page=10000', companyId);
    if (r1 && Array.isArray(r1) && r1.length > 0) return r1;
  } catch (e) {}

  try {
    var r2 = await this.apiCall('/rest/v1.0/schedule_tasks?project_id=' + projectId + '&per_page=10000', companyId);
    if (r2 && Array.isArray(r2) && r2.length > 0) return r2;
  } catch (e2) {}

  try {
    var r3 = await this.apiCall('/rest/v1.1/projects/' + projectId + '/schedule/tasks?per_page=10000', companyId);
    if (r3 && Array.isArray(r3) && r3.length > 0) return r3;
  } catch (e3) {}

  return [];
};

ProcoreAPI.prototype.getProxiedImageUrl = function(originalUrl) {
  if (!originalUrl) return null;
  return '/.netlify/functions/image-proxy?url=' + encodeURIComponent(originalUrl);
};

ProcoreAPI.prototype.clearCache = function() {
  this.cache = {};
  console.log('[API] Cache cleared');
};

procoreAPI = new ProcoreAPI();
console.log('[API] Module loaded with cache + rate limit protection.');

})();
