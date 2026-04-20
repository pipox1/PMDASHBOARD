/**
 * Procore API Service
 * Handles all API communication through Netlify Functions proxy
 */
class ProcoreAPI {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.companyId = null;
    this.proxyUrl = '/.netlify/functions/proxy';
  }

  // Store tokens
  setTokens(accessToken, refreshToken) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    localStorage.setItem('pm_access_token', accessToken);
    if (refreshToken) {
      localStorage.setItem('pm_refresh_token', refreshToken);
    }
  }

  // Load tokens from storage
  loadTokens() {
    this.accessToken = localStorage.getItem('pm_access_token');
    this.refreshToken = localStorage.getItem('pm_refresh_token');
    return !!this.accessToken;
  }

  // Clear all auth data
  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    this.companyId = null;
    localStorage.removeItem('pm_access_token');
    localStorage.removeItem('pm_refresh_token');
    localStorage.removeItem('pm_company_id');
  }

  // Refresh expired token
  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available. Please login again.');
    }

    try {
      const response = await fetch('/.netlify/functions/token-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.refreshToken })
      });

      if (!response.ok) {
        throw new Error('Token refresh failed');
      }

      const data = await response.json();
      this.setTokens(data.access_token, data.refresh_token || this.refreshToken);
      console.log('[API] Token refreshed successfully');
      return data;
    } catch (error) {
      console.error('[API] Token refresh error:', error);
      this.clearTokens();
      throw error;
    }
  }

  // Generic API call through proxy
  async apiCall(endpoint, companyId = null, retried = false) {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Please login.');
    }

    // Build proxy URL with query params
    const params = new URLSearchParams({ endpoint });
    if (companyId) {
      params.append('company_id', companyId);
    }

    try {
      const response = await fetch(`${this.proxyUrl}?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      // If 401, try refresh token once
      if (response.status === 401 && !retried && this.refreshToken) {
        console.log('[API] Token expired, attempting refresh...');
        await this.refreshAccessToken();
        return this.apiCall(endpoint, companyId, true);
      }

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[API] Error ${response.status}:`, errorBody);
        throw new Error(`API Error ${response.status}: ${errorBody.substring(0, 200)}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      if (error.message.includes('401') && !retried) {
        this.clearTokens();
      }
      throw error;
    }
  }

  // ========== SPECIFIC API METHODS ==========

  // Get list of companies
  async getCompanies() {
    console.log('[API] Getting companies...');
    return this.apiCall('/rest/v1.0/companies');
  }

  // Get all projects for a company
  async getProjects(companyId) {
    console.log(`[API] Getting projects for company ${companyId}...`);
    return this.apiCall(
      `/rest/v1.0/projects?company_id=${companyId}&per_page=300`,
      companyId
    );
  }

  // Get single project detail (includes project_manager field)
  async getProjectDetail(companyId, projectId) {
    console.log(`[API] Getting project detail ${projectId}...`);
    return this.apiCall(
      `/rest/v1.0/projects/${projectId}?company_id=${companyId}`,
      companyId
    );
  }

  // Get current authenticated user
  async getMe() {
    console.log('[API] Getting current user...');
    return this.apiCall('/rest/v1.0/me');
  }

  // Get user details from company directory (for avatar)
  async getUser(companyId, userId) {
    console.log(`[API] Getting user ${userId}...`);
    return this.apiCall(
      `/rest/v1.0/companies/${companyId}/users/${userId}`,
      companyId
    );
  }

  // Get schedule tasks for a project (to calculate progress)
  async getScheduleTasks(companyId, projectId) {
    console.log(`[API] Getting schedule tasks for project ${projectId}...`);
    return this.apiCall(
      `/rest/v1.0/projects/${projectId}/schedule/tasks?per_page=10000`,
      companyId
    );
  }
}

// Create global instance
const procoreAPI = new ProcoreAPI();