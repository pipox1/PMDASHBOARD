/**
 * PM Dashboard - Updated with better PM detection
 */
class PMDashboard {
  constructor() {
    this.companyId = null;
    this.projects = [];
    this.pmData = {};
    this.isLoading = false;
    this.errors = [];
  }

  async loadDashboard(companyId) {
    this.companyId = companyId;
    this.pmData = {};
    this.errors = [];
    this.isLoading = true;

    try {
      // Step 1: Get all projects
      this.updateLoadingMessage('Loading projects...');
      const allProjects = await procoreAPI.getProjects(companyId);
      this.projects = allProjects;
      console.log('[Dashboard] Found', this.projects.length, 'projects');

      // Step 2: Log first project to see structure
      if (this.projects.length > 0) {
        console.log('[Dashboard] Sample project data:', JSON.stringify(this.projects[0]).substring(0, 1000));
      }

      // Step 3: Process each project
      let processed = 0;
      const total = this.projects.length;

      for (const project of this.projects) {
        processed++;
        this.updateLoadingMessage(
          `Analyzing project ${processed}/${total}:<br><strong>${project.name || 'Unknown'}</strong>`
        );

        try {
          await this.processProject(project, companyId);
        } catch (err) {
          console.warn('[Dashboard] Error on project', project.id, ':', err.message);
          this.errors.push({ project: project.name, error: err.message });
        }

        // Rate limiting
        if (processed % 3 === 0) {
          await this.sleep(300);
        }
      }

      this.isLoading = false;
      console.log('[Dashboard] PMs found:', Object.keys(this.pmData).length);
      console.log('[Dashboard] PM data:', JSON.stringify(Object.keys(this.pmData)));
      console.log('[Dashboard] Errors:', this.errors.length);

      return this.pmData;

    } catch (error) {
      this.isLoading = false;
      throw error;
    }
  }

  async processProject(project, companyId) {
    // Get project detail
    let detail;
    try {
      detail = await procoreAPI.getProjectDetail(companyId, project.id);
    } catch (e) {
      console.warn('[Dashboard] Cannot get detail for', project.id, ':', e.message);
      return;
    }

    // DEBUG: Log the PM-related fields for first few projects
    if (Object.keys(this.pmData).length === 0 || Math.random() < 0.1) {
      console.log('[Dashboard] Project:', detail.name);
      console.log('[Dashboard] project_manager:', JSON.stringify(detail.project_manager));
      console.log('[Dashboard] project_manager_id:', detail.project_manager_id);
      console.log('[Dashboard] pm_id:', detail.pm_id);
      console.log('[Dashboard] roles:', JSON.stringify(detail.roles));

      // Log all keys that might contain PM info
      const pmKeys = Object.keys(detail).filter(k =>
        k.toLowerCase().includes('manager') ||
        k.toLowerCase().includes('pm') ||
        k.toLowerCase().includes('superintendent') ||
        k.toLowerCase().includes('admin')
      );
      console.log('[Dashboard] PM-related keys:', pmKeys);
      if (pmKeys.length > 0) {
        pmKeys.forEach(k => console.log(`  ${k}:`, JSON.stringify(detail[k])));
      }
    }

    // Try multiple methods to find the PM
    let pmId = null;
    let pmName = null;

    // Method 1: project_manager object
    if (detail.project_manager && detail.project_manager.id) {
      pmId = detail.project_manager.id;
      pmName = detail.project_manager.name || detail.project_manager.login;
      console.log('[Dashboard] PM found via project_manager object:', pmName);
    }

    // Method 2: project_manager as just an ID
    if (!pmId && detail.project_manager && typeof detail.project_manager === 'number') {
      pmId = detail.project_manager;
      pmName = 'PM #' + pmId;
      console.log('[Dashboard] PM found as ID:', pmId);
    }

    // Method 3: project_manager_id field
    if (!pmId && detail.project_manager_id) {
      pmId = detail.project_manager_id;
      pmName = 'PM #' + pmId;
      console.log('[Dashboard] PM found via project_manager_id:', pmId);
    }

    // Method 4: Check in project roles
    if (!pmId && detail.project_roles) {
      const pmRole = detail.project_roles.find(r =>
        r.role === 'Project Manager' ||
        r.role === 'Administrador de Proyectos' ||
        (r.role && r.role.toLowerCase().includes('manager'))
      );
      if (pmRole && pmRole.user) {
        pmId = pmRole.user.id;
        pmName = pmRole.user.name;
        console.log('[Dashboard] PM found via project_roles:', pmName);
      }
    }

    // Method 5: Check in the "roles" array  
    if (!pmId && detail.roles) {
      const pmRole = detail.roles.find(r =>
        (r.name && r.name.toLowerCase().includes('manager')) ||
        (r.name && r.name.toLowerCase().includes('administrador'))
      );
      if (pmRole) {
        pmId = pmRole.id || pmRole.user_id;
        pmName = pmRole.user_name || pmRole.name;
        console.log('[Dashboard] PM found via roles:', pmName);
      }
    }

    // Method 6: Check in project.project_manager from list endpoint (sometimes different from detail)
    if (!pmId && project.project_manager && project.project_manager.id) {
      pmId = project.project_manager.id;
      pmName = project.project_manager.name;
      console.log('[Dashboard] PM found via list project_manager:', pmName);
    }

    if (!pmId && project.project_manager_id) {
      pmId = project.project_manager_id;
      pmName = 'PM #' + pmId;
      console.log('[Dashboard] PM found via list project_manager_id:', pmId);
    }

    // If still no PM found, skip this project
    if (!pmId) {
      console.log('[Dashboard] No PM for project:', detail.name);
      return;
    }

    // Initialize PM entry
    if (!this.pmData[pmId]) {
      this.pmData[pmId] = {
        id: pmId,
        name: this.cleanName(pmName),
        email: '',
        avatar: null,
        initials: this.getInitials(pmName),
        projects: [],
        totalTasks: 0,
        completedTasks: 0
      };

      // Get user details
      await this.loadPMDetails(companyId, pmId);
    }

    // Get schedule tasks for progress
    let totalTasks = 0;
    let completedTasks = 0;
    let progressPercent = 0;

    try {
      const tasks = await procoreAPI.getScheduleTasks(companyId, project.id);
      if (tasks && Array.isArray(tasks) && tasks.length > 0) {
        const workTasks = tasks.filter(t => {
          const isTask = !t.has_children;
          return isTask;
        });
        totalTasks = workTasks.length;
        completedTasks = workTasks.filter(t => {
          const pct = t.percentage || t.percent_complete || 0;
          const status = (t.status || '').toLowerCase();
          return pct >= 100 || status === 'completed' || status === 'complete';
        }).length;
        progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      }
    } catch (e) {
      console.warn('[Dashboard] No schedule for', project.id);
      progressPercent = this.estimateProgressByDates(detail);
    }

    // Add project
    const stage = detail.stage || project.stage || 'Not Set';
    const status = this.determineStatus(detail);

    this.pmData[pmId].projects.push({
      id: project.id,
      name: detail.name || project.name || 'Unnamed',
      number: detail.project_number || project.project_number || '',
      description: detail.description || '',
      stage: stage,
      status: status,
      startDate: detail.start_date || null,
      completionDate: detail.completion_date || null,
      totalTasks: totalTasks,
      completedTasks: completedTasks,
      progressPercent: progressPercent,
      active: detail.active !== false
    });

    this.pmData[pmId].totalTasks += totalTasks;
    this.pmData[pmId].completedTasks += completedTasks;
  }

  async loadPMDetails(companyId, pmId) {
    try {
      const user = await procoreAPI.getUser(companyId, pmId);
      if (user) {
        this.pmData[pmId].email = user.email_address || user.email || '';
        
        let avatarUrl = null;
        if (user.avatar && typeof user.avatar === 'string' && user.avatar.startsWith('http')) {
          avatarUrl = user.avatar;
        } else if (user.avatar && user.avatar.url) {
          avatarUrl = user.avatar.url;
        } else if (user.avatar && user.avatar.compact) {
          avatarUrl = user.avatar.compact;
        } else if (user.avatar_url) {
          avatarUrl = user.avatar_url;
        } else if (user.profile_image && user.profile_image.url) {
          avatarUrl = user.profile_image.url;
        }

        if (avatarUrl && !avatarUrl.includes('default') && !avatarUrl.includes('missing')) {
          this.pmData[pmId].avatar = avatarUrl;
        }

        if (user.name) {
          this.pmData[pmId].name = this.cleanName(user.name);
          this.pmData[pmId].initials = this.getInitials(user.name);
        }
      }
    } catch (e) {
      console.warn('[Dashboard] Could not load PM details for', pmId, ':', e.message);
    }
  }

  determineStatus(project) {
    if (project.active === false) return 'Inactive';
    const now = new Date();
    const start = project.start_date ? new Date(project.start_date) : null;
    const end = project.completion_date ? new Date(project.completion_date) : null;
    if (end && now > new Date(end.getTime() + 86400000)) return 'Overdue';
    if (start && now < start) return 'Not Started';
    return 'Active';
  }

  estimateProgressByDates(project) {
    const now = new Date();
    const start = project.start_date ? new Date(project.start_date) : null;
    const end = project.completion_date ? new Date(project.completion_date) : null;
    if (!start || !end) return 0;
    if (now >= end) return 100;
    if (now <= start) return 0;
    return Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
  }

  cleanName(name) {
    if (!name) return 'Unknown';
    return name.replace(/\s*\(.*\)\s*$/, '').trim();
  }

  getInitials(name) {
    if (!name) return '??';
    const clean = this.cleanName(name);
    const parts = clean.split(/\s+/).filter(p => p.length > 0);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return clean.substring(0, 2).toUpperCase();
  }

  getProgressColor(p) {
    if (p >= 75) return '#4CAF50';
    if (p >= 50) return '#F47E25';
    if (p >= 25) return '#FFC107';
    return '#F44336';
  }

  getStatusColor(s) {
    return { 'Active': '#4CAF50', 'Completed': '#2196F3', 'Not Started': '#9E9E9E', 'Inactive': '#F44336', 'Overdue': '#F44336' }[s] || '#6B7280';
  }

  getStageIcon(stage) {
    const s = (stage || '').toLowerCase();
    if (s.includes('ejecuc') || s.includes('construc') || s.includes('course')) return 'fa-hard-hat';
    if (s.includes('pre') || s.includes('diseñ') || s.includes('design')) return 'fa-drafting-compass';
    if (s.includes('post') || s.includes('cierre')) return 'fa-flag-checkered';
    if (s.includes('warrant') || s.includes('garant')) return 'fa-shield-alt';
    if (s.includes('cotiza') || s.includes('bid')) return 'fa-file-invoice-dollar';
    return 'fa-folder-open';
  }

  formatDate(d) {
    if (!d) return 'N/A';
    const date = new Date(d);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  updateLoadingMessage(msg) {
    const el = document.getElementById('loading-message');
    if (el) el.innerHTML = msg;
  }

  // ========= RENDER =========

  renderDashboard(container) {
    const pmList = Object.values(this.pmData);

    if (pmList.length === 0) {
      // Show debug info to help diagnose
      let debugInfo = '';
      if (this.errors.length > 0) {
        debugInfo = `<p style="font-size:10px;color:#999;margin-top:12px;">
          Debug: ${this.projects.length} projects analyzed, ${this.errors.length} errors.
          <br>First error: ${this.errors[0]?.error || 'none'}
        </p>`;
      }

      // Check if we have projects but no PMs - show suggestion
      if (this.projects.length > 0) {
        debugInfo += `<p style="font-size:10px;color:#999;margin-top:8px;">
          Tip: Open browser console (F12) to see detailed API response logs.
          <br>The project_manager field might use a different format in your Procore setup.
        </p>`;
      }

      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-user-slash"></i>
          <h3>No Project Managers Found</h3>
          <p>Analyzed ${this.projects.length} projects but couldn't find Project Manager assignments.
             Make sure projects have a Project Manager set in Admin → Additional Information.</p>
          ${debugInfo}
        </div>
      `;
      return;
    }

    // Calculate totals
    const totalProjects = pmList.reduce((s, pm) => s + pm.projects.length, 0);
    const activeProjects = pmList.reduce((s, pm) => s + pm.projects.filter(p => p.status === 'Active').length, 0);
    const avgProgress = totalProjects > 0 ? Math.round(pmList.reduce((s, pm) => s + pm.projects.reduce((ss, p) => ss + p.progressPercent, 0), 0) / totalProjects) : 0;

    let html = `
      <div class="dashboard-summary">
        <div class="summary-card summary-total">
          <i class="fas fa-project-diagram"></i>
          <div class="summary-info">
            <span class="summary-value">${totalProjects}</span>
            <span class="summary-label">Total Projects</span>
          </div>
        </div>
        <div class="summary-card summary-active">
          <i class="fas fa-play-circle"></i>
          <div class="summary-info">
            <span class="summary-value">${activeProjects}</span>
            <span class="summary-label">Active</span>
          </div>
        </div>
        <div class="summary-card summary-pms">
          <i class="fas fa-users"></i>
          <div class="summary-info">
            <span class="summary-value">${pmList.length}</span>
            <span class="summary-label">Project Managers</span>
          </div>
        </div>
        <div class="summary-card summary-avg">
          <i class="fas fa-chart-line"></i>
          <div class="summary-info">
            <span class="summary-value">${avgProgress}%</span>
            <span class="summary-label">Avg. Progress</span>
          </div>
        </div>
      </div>
      <div class="pm-cards-container">
    `;

    pmList.sort((a, b) => a.name.localeCompare(b.name));

    for (const pm of pmList) {
      const pmActive = pm.projects.filter(p => p.status === 'Active').length;
      const pmAvg = pm.projects.length > 0 ? Math.round(pm.projects.reduce((s, p) => s + p.progressPercent, 0) / pm.projects.length) : 0;
      const pmColor = this.getProgressColor(pmAvg);

      html += `
        <div class="pm-card" id="pm-card-${pm.id}">
          <div class="pm-header" onclick="dashboard.togglePMCard('${pm.id}')">
            <div class="pm-profile">
              <div class="pm-avatar-wrapper">
                ${pm.avatar
                  ? `<img src="${pm.avatar}" alt="${pm.name}" class="pm-avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                     <div class="pm-avatar-initials" style="display:none;">${pm.initials}</div>`
                  : `<div class="pm-avatar-initials">${pm.initials}</div>`}
              </div>
              <div class="pm-info">
                <h3 class="pm-name">${pm.name}</h3>
                ${pm.email ? `<span class="pm-email"><i class="fas fa-envelope"></i> ${pm.email}</span>` : ''}
                <div class="pm-stats-inline">
                  <span class="pm-stat-badge"><i class="fas fa-folder-open"></i> ${pm.projects.length} project${pm.projects.length !== 1 ? 's' : ''}</span>
                  <span class="pm-stat-badge active"><i class="fas fa-bolt"></i> ${pmActive} active</span>
                </div>
              </div>
            </div>
            <div class="pm-summary-right">
              <div class="pm-circular-progress">
                <svg viewBox="0 0 36 36" class="circular-progress">
                  <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                  <path class="circle-fill" stroke="${pmColor}" stroke-dasharray="${pmAvg}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                  <text x="18" y="20.35" class="progress-text">${pmAvg}%</text>
                </svg>
              </div>
              <i class="fas fa-chevron-down pm-toggle-icon" id="toggle-icon-${pm.id}"></i>
            </div>
          </div>
          <div class="pm-projects-list" id="pm-projects-${pm.id}" style="display:none;">
            <div class="pm-projects-header">
              <span><i class="fas fa-list"></i> Assigned Projects</span>
              <span class="pm-tasks-total"><i class="fas fa-tasks"></i> ${pm.completedTasks}/${pm.totalTasks} total tasks</span>
            </div>
      `;

      pm.projects.sort((a, b) => {
        if (a.status === 'Active' && b.status !== 'Active') return -1;
        if (a.status !== 'Active' && b.status === 'Active') return 1;
        return b.progressPercent - a.progressPercent;
      });

      for (const proj of pm.projects) {
        const pColor = this.getProgressColor(proj.progressPercent);
        const sColor = this.getStatusColor(proj.status);
        const stageIcon = this.getStageIcon(proj.stage);

        html += `
            <div class="project-item ${proj.status === 'Overdue' ? 'project-overdue' : ''}">
              <div class="project-header-row">
                <div class="project-name-group">
                  ${proj.number ? `<span class="project-number">#${proj.number}</span>` : ''}
                  <span class="project-name">${proj.name}</span>
                </div>
                <span class="project-status-badge" style="background:${sColor}15;color:${sColor};border:1px solid ${sColor}30;">${proj.status}</span>
              </div>
              <div class="project-meta">
                <span class="project-stage"><i class="fas ${stageIcon}"></i> ${proj.stage}</span>
                <span class="project-tasks-count"><i class="fas fa-check-circle"></i> ${proj.completedTasks}/${proj.totalTasks} tasks</span>
              </div>
              <div class="project-dates">
                ${proj.startDate ? `<span class="date-tag"><i class="fas fa-play"></i> ${this.formatDate(proj.startDate)}</span>` : ''}
                ${proj.completionDate ? `<span class="date-tag"><i class="fas fa-flag-checkered"></i> ${this.formatDate(proj.completionDate)}</span>` : ''}
              </div>
              <div class="project-progress-bar">
                <div class="progress-track">
                  <div class="progress-fill" style="width:${proj.progressPercent}%;background:${pColor};"></div>
                </div>
                <span class="progress-percent" style="color:${pColor};">${proj.progressPercent}%</span>
              </div>
            </div>
        `;
      }

      html += '</div></div>';
    }

    html += '</div>';
    container.innerHTML = html;

    requestAnimationFrame(() => {
      
