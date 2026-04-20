/**
 * App Controller
 * Handles authentication flow, navigation, and initialization
 */
(function () {
  'use strict';

  // ========== DOM ELEMENTS ==========
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

  /**
   * Check URL hash for tokens (after OAuth redirect)
   */
  function checkAuthCallback() {
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (accessToken) {
        console.log('[App] Tokens received from OAuth callback');
        procoreAPI.setTokens(accessToken, refreshToken);
        // Clean the URL
        window.history.replaceState(null, '', window.location.pathname);
        return true;
      }
    }

    // Check for errors in query params
    const urlParams = new URLSearchParams(window.location.search);
    const error = urlParams.get('error');
    if (error) {
      console.error('[App] Auth error:', error);
      window.history.replaceState(null, '', window.location.pathname);
      return false;
    }

    return false;
  }

  // ========== UI STATE MANAGEMENT ==========

  function showLogin() {
    loginScreen.classList.remove('hidden');
    mainScreen.classList.add('hidden');
  }

  function showMain() {
    loginScreen.classList.add('hidden');
    mainScreen.classList.remove('hidden');
  }

  function showLoading(message = 'Loading...') {
    loadingContainer.classList.remove('hidden');
    dashboardContent.classList.add('hidden');
    errorState.classList.add('hidden');
    const msgEl = document.getElementById('loading-message');
    if (msgEl) msgEl.innerHTML = message;
  }

  function hideLoading() {
    loadingContainer.classList.add('hidden');
  }

  function showDashboardContent() {
    dashboardContent.classList.remove('hidden');
    loadingContainer.classList.add('hidden');
    errorState.classList.add('hidden');
  }

  function showError(message) {
    errorState.classList.remove('hidden');
    loadingContainer.classList.add('hidden');
    dashboardContent.classList.add('hidden');
    errorMessage.textContent = message;
  }

  // ========== DATA LOADING ==========

  async function loadCompanies() {
    try {
      showLoading('Connecting to Procore...');
      const companies = await procoreAPI.getCompanies();

      if (!companies || companies.length === 0) {
        showError('No companies found. Check your Procore permissions.');
        return;
      }

      // Populate dropdown
      companySelect.innerHTML = '<option value="">Select a company...</option>';
      companies.forEach(company => {
        const opt = document.createElement('option');
        opt.value = company.id;
        opt.textContent = company.name;
        companySelect.appendChild(opt);
      });

      // Auto-select if only one company
      if (companies.length === 1) {
        companySelect.value = companies[0].id;
        await loadDashboard(companies[0].id);
        return;
      }

      // Check for saved company preference
      const savedCompanyId = localStorage.getItem('pm_company_id');
      if (savedCompanyId) {
        const exists = companies.find(c => String(c.id) === String(savedCompanyId));
        if (exists) {
          companySelect.value = savedCompanyId;
          await loadDashboard(savedCompanyId);
          return;
        }
      }

      // Show prompt to select
      hideLoading();
      dashboardContent.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-building"></i>
          <h3>Welcome to PM Dashboard</h3>
          <p>Select a company from the dropdown above to view your Project Managers and their portfolios.</p>
        </div>
      `;
      showDashboardContent();

    } catch (error) {
      console.error('[App] Error loading companies:', error);

      if (error.message.includes('401') || error.message.includes('Not authenticated')) {
        procoreAPI.clearTokens();
        showLogin();
        return;
      }

      showError('Failed to connect to Procore: ' + error.message);
    }
  }

  async function loadDashboard(companyId) {
    if (!companyId) return;

    localStorage.setItem('pm_company_id', companyId);

    try {
      showLoading('Loading PM Dashboard...');

      await dashboard.loadDashboard(companyId);
      dashboard.renderDashboard(dashboardContent);
      showDashboardContent();

    } catch (error) {
      console.error('[App] Dashboard error:', error);

      if (error.message.includes('401')) {
        procoreAPI.clearTokens();
        showLogin();
        return;
      }

      showError('Failed to load dashboard: ' + error.message);
    }
  }

  // ========== EVENT LISTENERS ==========

  btnLogin.addEventListener('click', () => {
    console.log('[App] Starting OAuth login...');
    window.location.href = '/.netlify/functions/auth';
  });

  btnLogout.addEventListener('click', () => {
    console.log('[App] Logging out...');
    procoreAPI.clearTokens();
    showLogin();
  });

  btnRefresh.addEventListener('click', async () => {
    const companyId = companySelect.value;
    if (companyId) {
      await loadDashboard(companyId);
    } else {
      await loadCompanies();
    }
  });

  if (btnRetry) {
    btnRetry.addEventListener('click', async () => {
      const companyId = companySelect.value;
      if (companyId) {
        await loadDashboard(companyId);
      } else {
        await loadCompanies();
      }
    });
  }

  companySelect.addEventListener('change', async (e) => {
    const companyId = e.target.value;
    if (companyId) {
      await loadDashboard(companyId);
    }
  });

  // ========== INITIALIZE APP ==========

  async function init() {
    console.log('[App] Initializing PM Dashboard...');

    // Check for OAuth callback tokens
    const fromAuth = checkAuthCallback();

    // Check for existing tokens
    if (fromAuth || procoreAPI.loadTokens()) {
      console.log('[App] User authenticated, loading main screen...');
      showMain();
      await loadCompanies();
    } else {
      console.log('[App] No tokens found, showing login...');
      showLogin();
    }
  }

  // Start the app
  init();

})();