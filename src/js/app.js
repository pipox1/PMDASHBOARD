/**
 * App Controller - PM Dashboard
 * Handles auth, navigation, PDF export
 * No popup - auth happens in same window
 */
(function () {
  'use strict';

  var loginScreen = document.getElementById('login-screen');
  var mainScreen = document.getElementById('main-screen');
  var loadingContainer = document.getElementById('loading-container');
  var dashboardContent = document.getElementById('dashboard-content');
  var errorState = document.getElementById('error-state');
  var errorMessage = document.getElementById('error-message');
  var companySelect = document.getElementById('company-select');
  var btnLogin = document.getElementById('btn-login');
  var btnLogout = document.getElementById('btn-logout');
  var btnRefresh = document.getElementById('btn-refresh');
  var btnRetry = document.getElementById('btn-retry');
  var btnExportPDF = document.getElementById('btn-export-pdf');

  var currentCompanyName = '';

  // ========== AUTH ==========

  function checkAuthCallback() {
    var hash = window.location.hash;
    if (hash && hash.indexOf('access_token') > -1) {
      var params = new URLSearchParams(hash.substring(1));
      var accessToken = params.get('access_token');
      var refreshToken = params.get('refresh_token');
      if (accessToken) {
        console.log('[App] Tokens from hash');
        procoreAPI.setTokens(accessToken, refreshToken);
        window.history.replaceState(null, '', window.location.pathname);
        return true;
      }
    }

    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('auth') === 'success') {
      console.log('[App] Auth success via query param');
      window.history.replaceState(null, '', window.location.pathname);
      if (procoreAPI.loadTokens()) {
        return true;
      }
    }

    var error = urlParams.get('error');
    if (error) {
      console.error('[App] Auth error:', error);
      window.history.replaceState(null, '', window.location.pathname);
    }

    return false;
  }

  // Listen for postMessage (backup for iframe)
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'PROCORE_AUTH') {
      console.log('[App] Auth via postMessage');
      procoreAPI.setTokens(event.data.access_token, event.data.refresh_token);
      showMain();
      loadCompanies();
    }
  });

  // ========== UI ==========

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
    if (btnExportPDF) btnExportPDF.style.display = 'none';
    var el = document.getElementById('loading-message');
    if (el) el.innerHTML = message || 'Loading...';
  }

  function hideLoading() {
    loadingContainer.classList.add('hidden');
  }

  function showDashboard() {
    dashboardContent.classList.remove('hidden');
    loadingContainer.classList.add('hidden');
    errorState.classList.add('hidden');
    // Show PDF button only when dashboard has data
    if (btnExportPDF && dashboard && Object.keys(dashboard.pmData).length > 0) {
      btnExportPDF.style.display = 'flex';
    }
  }

  function showError(msg) {
    errorState.classList.remove('hidden');
    loadingContainer.classList.add('hidden');
    dashboardContent.classList.add('hidden');
    if (btnExportPDF) btnExportPDF.style.display = 'none';
    errorMessage.textContent = msg;
  }

  // ========== DATA ==========

  async function loadCompanies() {
    try {
      showLoading('Connecting to Procore...');
      var companies = await procoreAPI.getCompanies();

      if (!companies || companies.length === 0) {
        showError('No companies found.');
        return;
      }

      companySelect.innerHTML = '<option value="">Select a company...</option>';
      for (var i = 0; i < companies.length; i++) {
        var opt = document.createElement('option');
        opt.value = companies[i].id;
        opt.textContent = companies[i].name;
        companySelect.appendChild(opt);
      }

      if (companies.length === 1) {
        companySelect.value = companies[0].id;
        currentCompanyName = companies[0].name;
        await loadDashboardData(companies[0].id);
        return;
      }

      var saved = localStorage.getItem('pm_company_id');
      if (saved) {
        for (var j = 0; j < companies.length; j++) {
          if (String(companies[j].id) === String(saved)) {
            companySelect.value = saved;
            currentCompanyName = companies[j].name;
            await loadDashboardData(saved);
            return;
          }
        }
      }

      hideLoading();
      dashboardContent.innerHTML = '<div class="empty-state"><i class="fas fa-building"></i><h3>Welcome to PM Dashboard</h3><p>Select a company from the dropdown above.</p></div>';
      showDashboard();

    } catch (err) {
      console.error('[App] Error:', err);
      if (err.message.indexOf('401') > -1 || err.message.indexOf('Not authenticated') > -1) {
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

    // Get company name from select
    var selectEl = companySelect;
    for (var i = 0; i < selectEl.options.length; i++) {
      if (selectEl.options[i].value === String(companyId)) {
        currentCompanyName = selectEl.options[i].textContent;
        break;
      }
    }

    try {
      showLoading('Loading PM Dashboard...');
      await dashboard.loadDashboard(companyId);
      dashboard.renderDashboard(dashboardContent);
      showDashboard();
    } catch (err) {
      console.error('[App] Dashboard error:', err);
      if (err.message.indexOf('401') > -1) {
        procoreAPI.clearTokens();
        showLogin();
      } else {
        showError('Failed to load: ' + err.message);
      }
    }
  }

  // ========== EVENTS ==========

  btnLogin.addEventListener('click', function() {
    console.log('[App] Starting OAuth - same window (no popup)');
    // Navigate in the same window - no popup
    window.location.href = '/.netlify/functions/auth';
  });

  btnLogout.addEventListener('click', function() {
    procoreAPI.clearTokens();
    showLogin();
  });

    btnRefresh.addEventListener('click', async function() {
    // Clear cache so fresh data is loaded
    if (procoreAPI && procoreAPI.clearCache) procoreAPI.clearCache();
    var id = companySelect.value;
    if (id) await loadDashboardData(id);
    else await loadCompanies();
  });

  if (btnRetry) {
    btnRetry.addEventListener('click', async function() {
      var id = companySelect.value;
      if (id) await loadDashboardData(id);
      else await loadCompanies();
    });
  }

  companySelect.addEventListener('change', async function(e) {
    if (e.target.value) await loadDashboardData(e.target.value);
  });

  // PDF Export button
  if (btnExportPDF) {
    btnExportPDF.addEventListener('click', function() {
      if (dashboard && Object.keys(dashboard.pmData).length > 0 && pdfReport) {
        console.log('[App] Generating PDF report...');
        try {
          pdfReport.generate(dashboard.pmData, currentCompanyName);
          console.log('[App] PDF generated successfully');
        } catch (err) {
          console.error('[App] PDF error:', err);
          alert('Error generating PDF: ' + err.message);
        }
      } else {
        alert('No data to export. Please wait for the dashboard to load.');
      }
    });
  }

  // ========== INIT ==========

  async function init() {
    console.log('[App] Initializing PM Dashboard...');
    var fromAuth = checkAuthCallback();

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
