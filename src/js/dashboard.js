/**
 * PM Dashboard
 * Processes Procore data and renders the interactive dashboard
 */
class PMDashboard {
  constructor() {
    this.companyId = null;
    this.projects = [];
    this.pmData = {};
    this.isLoading = false;
  }

  /**
   * Main method: Load all dashboard data
   */
  async loadDashboard(companyId) {
    this.companyId = companyId;
    this.pmData = {};
    this.isLoading = true;

    try {
      // Step 1: Get all projects
      this.updateLoadingMessage('Loading projects...');
      const allProjects = await procoreAPI.getProjects(companyId);

      // Filter only active projects (or show all - you can adjust)
      this.projects = allProjects;
      console.log(`[Dashboard] Found ${this.projects.length} projects`);

      // Step 2: For each project, get details and schedule
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
          console.warn(`[Dashboard] Error processing project ${project.id}:`, err.message);
        }

        // Small delay to avoid API rate limiting
        if (processed % 5 === 0) {
          await this.sleep(200);
        }
      }

      this.isLoading = false;
      console.log('[Dashboard] Data loaded. PMs found:', Object.keys(this.pmData).length);
      return this.pmData;

    } catch (error) {
      this.isLoading = false;
      throw error;
    }
  }

  /**
   * Process a single project: get PM info and schedule progress
   */
  async processProject(project, companyId) {
    // Get project detail to find project_manager
    let detail;
    try {
      detail = await procoreAPI.getProjectDetail(companyId, project.id);
    } catch (e) {
      console.warn(`[Dashboard] Cannot get detail for project ${project.id}`);
      return;
    }

    // Check if project has a project_manager assigned
    const pm = detail.project_manager;
    if (!pm || !pm.id) {
      console.log(`[Dashboard] Project ${project.name} has no PM assigned, skipping`);
      return;
    }

    const pmId = pm.id;
    const pmName = pm.name || 'Unknown PM';

    // Initialize PM entry if new
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

      // Fetch user details for avatar and email
      await this.loadPMDetails(companyId, pmId);
    }

    // Get schedule tasks for progress calculation
    let totalTasks = 0;
    let completedTasks = 0;
    let progressPercent = 0;

    try {
      const tasks = await procoreAPI.getScheduleTasks(companyId, project.id);

      if (tasks && Array.isArray(tasks) && tasks.length > 0) {
        // Filter to get only leaf tasks (actual work items, not summary lines)
        const workTasks = tasks.filter(t => {
          // Exclude WBS/summary tasks - keep only actual tasks
          const isTask = (t.type === 'task' || t.task_type === 'task' || !t.has_children);
          // Exclude milestones with 0 duration if desired
          return isTask;
        });

        totalTasks = workTasks.length;
        completedTasks = workTasks.filter(t => {
          const pct = t.percentage || t.percent_complete || 0;
          const status = (t.status || '').toLowerCase();
          return pct >= 100 || status === 'completed' || status === 'complete';
        }).length;

        progressPercent = totalTasks > 0
          ? Math.round((completedTasks / totalTasks) * 100)
          : 0;
      }
    } catch (e) {
      console.warn(`[Dashboard] No schedule data for project ${project.id}, using date estimation`);
      progressPercent = this.estimateProgressByDates(detail);
    }

    // Determine project stage
    const stage = detail.stage || project.stage || 'Not Set';

    // Determine project status
    const status = this.determineStatus(detail);

    // Add project to PM's list
    const projectData = {
      id: project.id,
      name: detail.name || project.name || 'Unnamed Project',
      number: detail.project_number || project.project_number || '',
      description: detail.description || '',
      stage: stage,
      status: status,
      startDate: detail.start_date || null,
      completionDate: detail.completion_date || null,
      actualStartDate: detail.actual_start_date || null,
      projectedFinishDate: detail.projected_finish_date || null,
      totalTasks: totalTasks,
      completedTasks: completedTasks,
      progressPercent: progressPercent,
      active: detail.active !== false
    };

    this.pmData[pmId].projects.push(projectData);
    this.pmData[pmId].totalTasks += totalTasks;
    this.pmData[pmId].completedTasks += completedTasks;
  }

  /**
   * Load PM user details (avatar, email)
   */
  async loadPMDetails(companyId, pmId) {
    try {
      const user = await procoreAPI.getUser(companyId, pmId);

      if (user) {
        this.pmData[pmId].email = user.email_address || user.email || '';

        // Handle avatar - Procore can return it in different formats
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

        // Only set if it's a real URL (not a default/placeholder)
        if (avatarUrl && !avatarUrl.includes('default') && !avatarUrl.includes('missing')) {
          this.pmData[pmId].avatar = avatarUrl;
        }

        // Update name with cleaner version if available
        if (user.name) {
          this.pmData[pmId].name = this.cleanName(user.name);
          this.pmData[pmId].initials = this.getInitials(user.name);
        }
      }
    } catch (e) {
      console.warn(`[Dashboard] Could not load details for PM ${pmId}:`, e.message);
    }
  }

  /**
   * Determine project status based on available data
   */
  determineStatus(project) {
    if (project.active === false) return 'Inactive';

    const now = new Date();
    const start = project.start_date ? new Date(project.start_date) : null;
    const end = project.completion_date ? new Date(project.completion_date) : null;

    if (end && now > new Date(end.getTime() + 86400000)) {
      // Past completion date
      return 'Overdue';
    }
    if (start && now < start) return 'Not Started';
    if (start && end && now >= start && now <= end) return 'Active';
    if (!start && !end) return 'Active';

    return 'Active';
  }

  /**
   * Fallback: estimate progress based on project dates
   */
  estimateProgressByDates(project) {
    const now = new Date();
    const start = project.start_date ? new Date(project.start_date) : null;
    const end = project.completion_date ? new Date(project.completion_date) : null;

    if (!start || !end) return 0;
    if (now >= end) return 100;
    if (now <= start) return 0;

    const totalMs = end - start;
    const elapsedMs = now - start;
    return Math.min(100, Math.max(0, Math.round((elapsedMs / totalMs) * 100)));
  }

  /**
   * Clean name: remove company suffix like "(COMPANY NAME)"
   */
  cleanName(name) {
    if (!name) return 'Unknown';
    // Remove everything in parentheses at the end
    return name.replace(/\s*\(.*\)\s*$/, '').trim();
  }

  /**
   * Get initials from name
   */
  getInitials(name) {
    if (!name) return '??';
    const clean = this.cleanName(name);
    const parts = clean.split(/\s+/).filter(p => p.length > 0);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return clean.substring(0, 2).toUpperCase();
  }

  /**
   * Get color based on progress percentage
   */
  getProgressColor(percent) {
    if (percent >= 75) return '#4CAF50';
    if (percent >= 50) return '#F47E25';
    if (percent >= 25) return '#FFC107';
    return '#F44336';
  }

  /**
   * Get color for project status badge
   */
  getStatusColor(status) {
    const colors = {
      'Active': '#4CAF50',
      'Completed': '#2196F3',
      'Not Started': '#9E9E9E',
      'Inactive': '#F44336',
      'Overdue': '#F44336'
    };
    return colors[status] || '#6B7280';
  }

  /**
   * Get icon for project stage
   */
  getStageIcon(stage) {
    const s = (stage || '').toLowerCase();
    if (s.includes('ejecuc') || s.includes('construc') || s.includes('course')) return 'fa-hard-hat';
    if (s.includes('pre') || s.includes('diseñ') || s.includes('design') || s.includes('plann')) return 'fa-drafting-compass';
    if (s.includes('post') || s.includes('cierre') || s.includes('close')) return 'fa-flag-checkered';
    if (s.includes('warrant') || s.includes('garant')) return 'fa-shield-alt';
    if (s.includes('cotiza') || s.includes('bid') || s.includes('propu')) return 'fa-file-invoice-dollar';
    if (s.includes('complet') || s.includes('termin')) return 'fa-check-double';
    return 'fa-folder-open';
  }

  /**
   * Format date string
   */
  formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  /**
   * Sleep utility for rate limiting
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update loading message in UI
   */
  updateLoadingMessage(message) {
    const el = document.getElementById('loading-message');
    if (el) el.innerHTML = message;
  }

  // ========================================
  // RENDER METHODS
  // ========================================

  /**
   * Render the full dashboard into a container
   */
  renderDashboard(container) {
    const pmList = Object.values(this.pmData);

    // Empty state
    if (pmList.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-user-slash"></i>
          <h3>No Project Managers Found</h3>
          <p>No projects with assigned Project Managers were found in this company. 
             Make sure projects have a Project Manager set in the Admin settings.</p>
        </div>
      `;
      return;
    }

    // Calculate global totals
    const totalProjects = pmList.reduce((sum, pm) => sum + pm.projects.length, 0);
    const activeProjects = pmList.reduce((sum, pm) =>
      sum + pm.projects.filter(p => p.status === 'Active').length, 0);
    const completedProjects = pmList.reduce((sum, pm) =>
      sum + pm.projects.filter(p => p.progressPercent >= 100).length, 0);
    const avgProgress = totalProjects > 0
      ? Math.round(pmList.reduce((sum, pm) =>
          sum + pm.projects.reduce((s, p) => s + p.progressPercent, 0), 0) / totalProjects)
      : 0;

    let html = '';

    // ---- SUMMARY CARDS ----
    html += `
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
    `;

    // ---- PM CARDS ----
    html += '<div class="pm-cards-container">';

    // Sort PMs alphabetically
    pmList.sort((a, b) => a.name.localeCompare(b.name));

    for (const pm of pmList) {
      // Calculate PM-level stats
      const pmActiveCount = pm.projects.filter(p => p.status === 'Active').length;
      const pmAvgProgress = pm.projects.length > 0
        ? Math.round(pm.projects.reduce((s, p) => s + p.progressPercent, 0) / pm.projects.length)
        : 0;
      const pmProgressColor = this.getProgressColor(pmAvgProgress);

      html += `
        <div class="pm-card" id="pm-card-${pm.id}">
          <!-- PM Header (clickable) -->
          <div class="pm-header" onclick="dashboard.togglePMCard('${pm.id}')">
            <div class="pm-profile">
              <div class="pm-avatar-wrapper">
                ${pm.avatar
                  ? `<img src="${pm.avatar}" alt="${pm.name}" class="pm-avatar"
                       onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                     <div class="pm-avatar-initials" style="display:none;">${pm.initials}</div>`
                  : `<div class="pm-avatar-initials">${pm.initials}</div>`
                }
              </div>
              <div class="pm-info">
                <h3 class="pm-name">${pm.name}</h3>
                ${pm.email ? `<span class="pm-email"><i class="fas fa-envelope"></i> ${pm.email}</span>` : ''}
                <div class="pm-stats-inline">
                  <span class="pm-stat-badge">
                    <i class="fas fa-folder-open"></i> ${pm.projects.length} project${pm.projects.length !== 1 ? 's' : ''}
                  </span>
                  <span class="pm-stat-badge active">
                    <i class="fas fa-bolt"></i> ${pmActiveCount} active
                  </span>
                </div>
              </div>
            </div>
            <div class="pm-summary-right">
              <div class="pm-circular-progress">
                <svg viewBox="0 0 36 36" class="circular-progress">
                  <path class="circle-bg"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                  <path class="circle-fill" stroke="${pmProgressColor}"
                    stroke-dasharray="${pmAvgProgress}, 100"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                  <text x="18" y="20.35" class="progress-text">${pmAvgProgress}%</text>
                </svg>
              </div>
              <i class="fas fa-chevron-down pm-toggle-icon" id="toggle-icon-${pm.id}"></i>
            </div>
          </div>

          <!-- PM Projects List (collapsed by default) -->
          <div class="pm-projects-list" id="pm-projects-${pm.id}" style="display:none;">
            <div class="pm-projects-header">
              <span><i class="fas fa-list"></i> Assigned Projects</span>
              <span class="pm-tasks-total">
                <i class="fas fa-tasks"></i> ${pm.completedTasks}/${pm.totalTasks} total tasks
              </span>
            </div>
      `;

      // Sort projects: active first, then by progress
      pm.projects.sort((a, b) => {
        if (a.status === 'Active' && b.status !== 'Active') return -1;
        if (a.status !== 'Active' && b.status === 'Active') return 1;
        return b.progressPercent - a.progressPercent;
      });

      // Render each project
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
                <span class="project-status-badge" style="background:${sColor}15;color:${sColor};border:1px solid ${sColor}30;">
                  ${proj.status}
                </span>
              </div>

              <div class="project-meta">
                <span class="project-stage">
                  <i class="fas ${stageIcon}"></i> ${proj.stage}
                </span>
                <span class="project-tasks-count">
                  <i class="fas fa-check-circle"></i> ${proj.completedTasks}/${proj.totalTasks} tasks
                </span>
              </div>

              <div class="project-dates">
                ${proj.startDate
                  ? `<span class="date-tag"><i class="fas fa-play"></i> ${this.formatDate(proj.startDate)}</span>`
                  : ''}
                ${proj.completionDate
                  ? `<span class="date-tag"><i class="fas fa-flag-checkered"></i> ${this.formatDate(proj.completionDate)}</span>`
                  : ''}
              </div>

              <div class="project-progress-bar">
                <div class="progress-track">
                  <div class="progress-fill" style="width:${proj.progressPercent}%;background:${pColor};">
                  </div>
                </div>
                <span class="progress-percent" style="color:${pColor};">${proj.progressPercent}%</span>
              </div>
            </div>
        `;
      }

      html += `
          </div>
        </div>
      `;
    }

    html += '</div>';

    // Set the HTML
    container.innerHTML = html;

    // Animate progress bars after a small delay
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.querySelectorAll('.progress-fill').forEach(bar => {
          bar.style.transition = 'width 1s cubic-bezier(0.4, 0, 0.2, 1)';
        });
      }, 50);
    });
  }

  /**
   * Toggle expand/collapse of a PM's project list
   */
  togglePMCard(pmId) {
    const projectsList = document.getElementById(`pm-projects-${pmId}`);
    const toggleIcon = document.getElementById(`toggle-icon-${pmId}`);
    const card = document.getElementById(`pm-card-${pmId}`);

    if (!projectsList || !toggleIcon) return;

    const isHidden = projectsList.style.display === 'none';

    if (isHidden) {
      projectsList.style.display = 'block';
      toggleIcon.classList.remove('fa-chevron-down');
      toggleIcon.classList.add('fa-chevron-up');
      if (card) card.classList.add('pm-card-expanded');

      // Animate progress bars inside this card
      projectsList.querySelectorAll('.progress-fill').forEach(bar => {
        const width = bar.style.width;
        bar.style.width = '0%';
        bar.style.transition = 'none';
        requestAnimationFrame(() => {
          bar.style.transition = 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
          bar.style.width = width;
        });
      });
    } else {
      projectsList.style.display = 'none';
      toggleIcon.classList.remove('fa-chevron-up');
      toggleIcon.classList.add('fa-chevron-down');
      if (card) card.classList.remove('pm-card-expanded');
    }
  }
}

// Create global instance
const dashboard = new PMDashboard();