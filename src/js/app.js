/**
 * App Controller
 * Handles authentication flow and initialization
 * Works both standalone and embedded in Procore iframe
 */
(function () {
  'use strict';

  // DOM Elements
  const loginScreen = document.getElementById('login-screen');
  const mainScreen = document.getElementById('main-screen');
  const loadingContainer = document.getElementById('loading-container');
  const dashboardContent = document.getElementById('dashboard-content');
  const errorState = document.getElementById('error-state');
  const errorMessage = document.getElementById('error-message');
  const companySelect = document.getElementById('company-select');
  const btnLogin = document.getElementById('btn-login');
  const btnLogout = document.getElementById('btn-logout');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnRetry = document.getElementById('btn-retry');

  // ========== AUTH HANDLING ==========

  function checkAuthCallback() {
    // Method 1: Check URL hash (old method)
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken) {
        console.log('[App] Tokens from hash');
        procoreAPI.setTokens(accessToken, refreshToken);
        window.history.replaceState(null, '', window.location.pathname);
        return true;
      }
    }

    // Method 2: Check query params (new method - from callback HTML page)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('auth') === 'success') {
      console.log('[App] Auth success detected, checking localStorage...');
      window.history.replaceState(null, '', window.location.pathname);
      // Tokens should already be in localStorage from the callback page
      if (procoreAPI.loadTokens()) {
        console.log('[App] Tokens loaded from localStorage');
        return true;
      }
    }

    // Check for errors
    const error = urlParams.get('error');
    if (error) {
      console.error('[App] Auth error:', error);
      window.history.replaceState(null, '', window.location.pathname);
      return false;
    }

    return false;
  }

  // Listen for postMessage from auth callback (iframe support)
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'PROCORE_AUTH') {
      console.log('[App] Received auth tokens via postMessage');
      procoreAPI.setTokens(event.data.access_token, event.data.refresh_token);
      showMain();
      loadCompanies();
    }
  });

  // ========== UI STATE ==========

  function showLogin() {
    loginScreen.classList.remove('hidden');
    mainScreen.classList.add('hidden');
  }

  function showMain() {
    loginScreen.classList.add('hidden');
    mainScreen.classList.remove('hidden');
  }

  function showLoading(message) {
    loadingContainer.classList.remove('hidden');
    dashboardContent.classList.add('hidden');
    errorState.classList.add('hidden');
    const el = document.getElementById('loading-message');
    if (el) el.innerHTML = message || 'Loading...';
  }

  function hideLoading() {
    loadingContainer.classList.add('hidden');
  }

  function showDashboard() {
    dashboardContent.classList.remove('hidden');
    loadingContainer.classList.add('hidden');
    errorState.classList.add('hidden');
  }

  function showError(msg) {
    errorState.classList.remove('hidden');
    loadingContainer.classList.add('hidden');
    dashboardContent.classList.add('hidden');
    errorMessage.textContent = msg;
  }

  // ========== DATA ==========

  async function loadCompanies() {
    try {
      showLoading('Connecting to Procore...');
      const companies = await procoreAPI.getCompanies();

      if (!companies || companies.length === 0) {
        showError('No companies found.');
        return;
      }

      companySelect.innerHTML = '<option value="">Select a company...</option>';
      companies.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        companySelect.appendChild(opt);
      });

      // Auto-select if one company
      if (companies.length === 1) {
        companySelect.value = companies[0].id;
        await loadDashboardData(companies[0].id);
        return;
      }

      // Check saved
      const saved = localStorage.getItem('pm_company_id');
      if (saved && companies.find(c => String(c.id) === String(saved))) {
        companySelect.value = saved;
        await loadDashboardData(saved);
        return;
      }

      hideLoading();
      dashboardContent.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-building"></i>
          <h3>Welcome to PM Dashboard</h3>
          <p>Select a company from the dropdown above.</p>
        </div>
      `;
      showDashboard();

    } catch (err) {
      console.error('[App] Error:', err);
      if (err.message.includes('401') || err.message.includes('Not authenticated')) {
        procoreAPI.clearTokens();
        showLogin();
      } else {
        showError('Failed to connect: ' + err.message);
      }
    }
  }

  async function loadDashboardData(companyId) {
    if (!companyId) return;
    localStorage.setItem('pm_company_id', companyId);

    try {
      showLoading('Loading PM Dashboard...');
      await dashboard.loadDashboard(companyId);
      dashboard.renderDashboard(dashboardContent);
      showDashboard();
    } catch (err) {
      console.error('[App] Dashboard error:', err);
      if (err.message.includes('401')) {
        procoreAPI.clearTokens();
        showLogin();
      } else {
        showError('Failed to load: ' + err.message);
      }
    }
  }

  // ========== EVENTS ==========

  btnLogin.addEventListener('click', () => {
    console.log('[App] Starting OAuth...');
    // Open auth in a new window/tab to avoid iframe issues
    const authWindow = window.open(
      '/.netlify/functions/auth',
      'procore_auth',
      'width=600,height=700,scrollbars=yes'
    );

    // If popup was blocked, redirect directly
    if (!authWindow || authWindow.closed) {
      window.location.href = '/.netlify/functions/auth';
    }
  });

  btnLogout.addEventListener('click', () => {
    procoreAPI.clearTokens();
    showLogin();
  });

  btnRefresh.addEventListener('click', async () => {
    const id = companySelect.value;
    if (id) await loadDashboardData(id);
    else await loadCompanies();
  });

  if (btnRetry) {
    btnRetry.addEventListener('click', async () => {
      const id = companySelect.value;
      if (id) await loadDashboardData(id);
      else await loadCompanies();
    });
  }

  companySelect.addEventListener('change', async (e) => {
    if (e.target.value) await loadDashboardData(e.target.value);
  });

  // ========== INIT ==========

  async function init() {
    console.log('[App] Initializing...');

    const fromAuth = checkAuthCallback();

    if (fromAuth || procoreAPI.loadTokens()) {
      console.log('[App] Authenticated');
      showMain();
      await loadCompanies();
    } else {
      console.log('[App] Not authenticated');
      showLogin();
    }
  }

  init();

})();
