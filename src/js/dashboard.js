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

  async loadDashboard(companyId) {
    this.companyId = companyId;
    this.pmData = {};
    this.isLoading = true;

    try {
      this.updateLoadingMessage('Loading projects...');
      var allProjects = await procoreAPI.getProjects(companyId);
      this.projects = allProjects;
      console.log('[Dashboard] Found ' + this.projects.length + ' projects');

      var processed = 0;
      var total = this.projects.length;

      for (var i = 0; i < this.projects.length; i++) {
        var project = this.projects[i];
        processed++;
        this.updateLoadingMessage(
          'Analyzing project ' + processed + '/' + total + ':<br><strong>' + (project.name || 'Unknown') + '</strong>'
        );

        try {
          await this.processProject(project, companyId);
        } catch (err) {
          console.warn('[Dashboard] Error processing project ' + project.id + ':', err.message);
        }

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

  async processProject(project, companyId) {
    var detail;
    try {
      detail = await procoreAPI.getProjectDetail(companyId, project.id);
    } catch (e) {
      console.warn('[Dashboard] Cannot get detail for project ' + project.id);
      return;
    }

    var pm = detail.project_manager;
    if (!pm || !pm.id) {
      console.log('[Dashboard] Project ' + project.name + ' has no PM assigned');
      return;
    }

    var pmId = pm.id;
    var pmName = pm.name || 'Unknown PM';

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

      await this.loadPMDetails(companyId, pmId);
    }

    var totalTasks = 0;
    var completedTasks = 0;
    var progressPercent = 0;

    try {
      var tasks = await procoreAPI.getScheduleTasks(companyId, project.id);

      if (tasks && Array.isArray(tasks) && tasks.length > 0) {
        var workTasks = tasks.filter(function(t) {
          return (t.type === 'task' || t.task_type === 'task' || !t.has_children);
        });

        totalTasks = workTasks.length;
        completedTasks = workTasks.filter(function(t) {
          var pct = t.percentage || t.percent_complete || 0;
          var status = (t.status || '').toLowerCase();
          return pct >= 100 || status === 'completed' || status === 'complete';
        }).length;

        progressPercent = totalTasks > 0
          ? Math.round((completedTasks / totalTasks) * 100)
          : 0;
      }
    } catch (e) {
      console.warn('[Dashboard] No schedule data for project ' + project.id);
      progressPercent = this.estimateProgressByDates(detail);
    }

    var stage = detail.stage || project.stage || 'Not Set';
    var status = this.determineStatus(detail);

    var projectData = {
      id: project.id,
      name: detail.name || project.name || 'Unnamed Project',
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
    };

    this.pmData[pmId].projects.push(projectData);
    this.pmData[pmId].totalTasks += totalTasks;
    this.pmData[pmId].completedTasks += completedTasks;
  }

  async loadPMDetails(companyId, pmId) {
    try {
      var user = await procoreAPI.getUser(companyId, pmId);

      if (user) {
        this.pmData[pmId].email = user.email_address || user.email || '';

        var avatarUrl = null;
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

        if (avatarUrl && avatarUrl.indexOf('default') === -1 && avatarUrl.indexOf('missing') === -1) {
          this.pmData[pmId].avatar = avatarUrl;
        }

        if (user.name) {
          this.pmData[pmId].name = this.cleanName(user.name);
          this.pmData[pmId].initials = this.getInitials(user.name);
        }
      }
    } catch (e) {
      console.warn('[Dashboard] Could not load details for PM ' + pmId);
    }
  }

  determineStatus(project) {
    if (project.active === false) return 'Inactive';
    var now = new Date();
    var start = project.start_date ? new Date(project.start_date) : null;
    var end = project.completion_date ? new Date(project.completion_date) : null;

    if (end && now > new Date(end.getTime() + 86400000)) return 'Overdue';
    if (start && now < start) return 'Not Started';
    return 'Active';
  }

  estimateProgressByDates(project) {
    var now = new Date();
    var start = project.start_date ? new Date(project.start_date) : null;
    var end = project.completion_date ? new Date(project.completion_date) : null;

    if (!start || !end) return 0;
    if (now >= end) return 100;
    if (now <= start) return 0;

    var totalMs = end - start;
    var elapsedMs = now - start;
    return Math.min(100, Math.max(0, Math.round((elapsedMs / totalMs) * 100)));
  }

  cleanName(name) {
    if (!name) return 'Unknown';
    return name.replace(/\s*\(.*\)\s*$/, '').trim();
  }

  getInitials(name) {
    if (!name) return '??';
    var clean = this.cleanName(name);
    var parts = clean.split(/\s+/).filter(function(p) { return p.length > 0; });
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return clean.substring(0, 2).toUpperCase();
  }

  getProgressColor(percent) {
    if (percent >= 75) return '#4CAF50';
    if (percent >= 50) return '#F47E25';
    if (percent >= 25) return '#FFC107';
    return '#F44336';
  }

  getStatusColor(status) {
    var colors = {
      'Active': '#4CAF50',
      'Completed': '#2196F3',
      'Not Started': '#9E9E9E',
      'Inactive': '#F44336',
      'Overdue': '#F44336'
    };
    return colors[status] || '#6B7280';
  }

  getStageIcon(stage) {
    var s = (stage || '').toLowerCase();
    if (s.indexOf('ejecuc') > -1 || s.indexOf('construc') > -1 || s.indexOf('course') > -1) return 'fa-hard-hat';
    if (s.indexOf('pre') > -1 || s.indexOf('dise') > -1 || s.indexOf('design') > -1) return 'fa-drafting-compass';
    if (s.indexOf('post') > -1 || s.indexOf('cierre') > -1 || s.indexOf('close') > -1) return 'fa-flag-checkered';
    if (s.indexOf('warrant') > -1 || s.indexOf('garant') > -1) return 'fa-shield-alt';
    if (s.indexOf('cotiza') > -1 || s.indexOf('bid') > -1) return 'fa-file-invoice-dollar';
    if (s.indexOf('complet') > -1 || s.indexOf('termin') > -1) return 'fa-check-double';
    return 'fa-folder-open';
  }

  formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    var date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  updateLoadingMessage(message) {
    var el = document.getElementById('loading-message');
    if (el) el.innerHTML = message;
  }

  renderDashboard(container) {
    var pmList = [];
    var keys = Object.keys(this.pmData);
    for (var k = 0; k < keys.length; k++) {
      pmList.push(this.pmData[keys[k]]);
    }

    if (pmList.length === 0) {
      container.innerHTML = '<div class="empty-state">' +
        '<i class="fas fa-user-slash"></i>' +
        '<h3>No Project Managers Found</h3>' +
        '<p>No projects with assigned Project Managers were found. Make sure projects have a PM set in Admin settings.</p>' +
        '</div>';
      return;
    }

    var totalProjects = 0;
    var activeProjects = 0;
    var totalProgress = 0;

    for (var i = 0; i < pmList.length; i++) {
      totalProjects += pmList[i].projects.length;
      for (var j = 0; j < pmList[i].projects.length; j++) {
        if (pmList[i].projects[j].status === 'Active') activeProjects++;
        totalProgress += pmList[i].projects[j].progressPercent;
      }
    }

    var avgProgress = totalProjects > 0 ? Math.round(totalProgress / totalProjects) : 0;

    var html = '';

    // Summary Cards
    html += '<div class="dashboard-summary">';
    html += '<div class="summary-card summary-total"><i class="fas fa-project-diagram"></i><div class="summary-info"><span class="summary-value">' + totalProjects + '</span><span class="summary-label">Total Projects</span></div></div>';
    html += '<div class="summary-card summary-active"><i class="fas fa-play-circle"></i><div class="summary-info"><span class="summary-value">' + activeProjects + '</span><span class="summary-label">Active</span></div></div>';
    html += '<div class="summary-card summary-pms"><i class="fas fa-users"></i><div class="summary-info"><span class="summary-value">' + pmList.length + '</span><span class="summary-label">Project Managers</span></div></div>';
    html += '<div class="summary-card summary-avg"><i class="fas fa-chart-line"></i><div class="summary-info"><span class="summary-value">' + avgProgress + '%</span><span class="summary-label">Avg. Progress</span></div></div>';
    html += '</div>';

    // PM Cards
    html += '<div class="pm-cards-container">';

    pmList.sort(function(a, b) { return a.name.localeCompare(b.name); });

    for (var p = 0; p < pmList.length; p++) {
      var pm = pmList[p];
      var pmActiveCount = 0;
      var pmTotalProgress = 0;

      for (var q = 0; q < pm.projects.length; q++) {
        if (pm.projects[q].status === 'Active') pmActiveCount++;
        pmTotalProgress += pm.projects[q].progressPercent;
      }

      var pmAvgProgress = pm.projects.length > 0 ? Math.round(pmTotalProgress / pm.projects.length) : 0;
      var pmProgressColor = this.getProgressColor(pmAvgProgress);

      html += '<div class="pm-card" id="pm-card-' + pm.id + '">';

      // PM Header
      html += '<div class="pm-header" onclick="dashboard.togglePMCard(\'' + pm.id + '\')">';
      html += '<div class="pm-profile">';
      html += '<div class="pm-avatar-wrapper">';

      if (pm.avatar) {
        html += '<img src="' + pm.avatar + '" alt="' + pm.name + '" class="pm-avatar" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">';
        html += '<div class="pm-avatar-initials" style="display:none;">' + pm.initials + '</div>';
      } else {
        html += '<div class="pm-avatar-initials">' + pm.initials + '</div>';
      }

      html += '</div>'; // avatar-wrapper
      html += '<div class="pm-info">';
      html += '<h3 class="pm-name">' + pm.name + '</h3>';
      if (pm.email) {
        html += '<span class="pm-email"><i class="fas fa-envelope"></i> ' + pm.email + '</span>';
      }
      html += '<div class="pm-stats-inline">';
      html += '<span class="pm-stat-badge"><i class="fas fa-folder-open"></i> ' + pm.projects.length + ' project' + (pm.projects.length !== 1 ? 's' : '') + '</span>';
      html += '<span class="pm-stat-badge active"><i class="fas fa-bolt"></i> ' + pmActiveCount + ' active</span>';
      html += '</div>';
      html += '</div>'; // pm-info
      html += '</div>'; // pm-profile

      // Circular Progress
      html += '<div class="pm-summary-right">';
      html += '<div class="pm-circular-progress">';
      html += '<svg viewBox="0 0 36 36" class="circular-progress">';
      html += '<path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>';
      html += '<path class="circle-fill" stroke="' + pmProgressColor + '" stroke-dasharray="' + pmAvgProgress + ', 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>';
      html += '<text x="18" y="20.35" class="progress-text">' + pmAvgProgress + '%</text>';
      html += '</svg>';
      html += '</div>';
      html += '<i class="fas fa-chevron-down pm-toggle-icon" id="toggle-icon-' + pm.id + '"></i>';
      html += '</div>'; // pm-summary-right

      html += '</div>'; // pm-header

      // Projects List (hidden by default)
      html += '<div class="pm-projects-list" id="pm-projects-' + pm.id + '" style="display:none;">';
      html += '<div class="pm-projects-header"><span><i class="fas fa-list"></i> Assigned Projects</span>';
      html += '<span class="pm-tasks-total"><i class="fas fa-tasks"></i> ' + pm.completedTasks + '/' + pm.totalTasks + ' total tasks</span></div>';

      // Sort projects
      pm.projects.sort(function(a, b) {
        if (a.status === 'Active' && b.status !== 'Active') return -1;
        if (a.status !== 'Active' && b.status === 'Active') return 1;
        return b.progressPercent - a.progressPercent;
      });

      for (var r = 0; r < pm.projects.length; r++) {
        var proj = pm.projects[r];
        var pColor = this.getProgressColor(proj.progressPercent);
        var sColor = this.getStatusColor(proj.status);
        var stageIcon = this.getStageIcon(proj.stage);

        html += '<div class="project-item' + (proj.status === 'Overdue' ? ' project-overdue' : '') + '">';

        // Header Row
        html += '<div class="project-header-row">';
        html += '<div class="project-name-group">';
        if (proj.number) html += '<span class="project-number">#' + proj.number + '</span>';
        html += '<span class="project-name">' + proj.name + '</span>';
        html += '</div>';
        html += '<span class="project-status-badge" style="background:' + sColor + '15;color:' + sColor + ';border:1px solid ' + sColor + '30;">' + proj.status + '</span>';
        html += '</div>';

        // Meta
        html += '<div class="project-meta">';
        html += '<span class="project-stage"><i class="fas ' + stageIcon + '"></i> ' + proj.stage + '</span>';
        html += '<span class="project-tasks-count"><i class="fas fa-check-circle"></i> ' + proj.completedTasks + '/' + proj.totalTasks + ' tasks</span>';
        html += '</div>';

        // Dates
        html += '<div class="project-dates">';
        if (proj.startDate) html += '<span class="date-tag"><i class="fas fa-play"></i> ' + this.formatDate(proj.startDate) + '</span>';
        if (proj.completionDate) html += '<span class="date-tag"><i class="fas fa-flag-checkered"></i> ' + this.formatDate(proj.completionDate) + '</span>';
        html += '</div>';

        // Progress Bar
        html += '<div class="project-progress-bar">';
        html += '<div class="progress-track"><div class="progress-fill" style="width:' + proj.progressPercent + '%;background:' + pColor + ';"></div></div>';
        html += '<span class="progress-percent" style="color:' + pColor + ';">' + proj.progressPercent + '%</span>';
        html += '</div>';

        html += '</div>'; // project-item
      }

      html += '</div>'; // pm-projects-list
      html += '</div>'; // pm-card
    }

    html += '</div>'; // pm-cards-container

    container.innerHTML = html;

    // Animate progress bars
    setTimeout(function() {
      var bars = document.querySelectorAll('.progress-fill');
      for (var b = 0; b < bars.length; b++) {
        bars[b].style.transition = 'width 1s cubic-bezier(0.4, 0, 0.2, 1)';
      }
    }, 50);
  }

  togglePMCard(pmId) {
    var projectsList = document.getElementById('pm-projects-' + pmId);
    var toggleIcon = document.getElementById('toggle-icon-' + pmId);
    var card = document.getElementById('pm-card-' + pmId);

    if (!projectsList || !toggleIcon) return;

    var isHidden = projectsList.style.display === 'none';

    if (isHidden) {
      projectsList.style.display = 'block';
      toggleIcon.classList.remove('fa-chevron-down');
      toggleIcon.classList.add('fa-chevron-up');
      if (card) card.classList.add('pm-card-expanded');

      var fills = projectsList.querySelectorAll('.progress-fill');
      for (var i = 0; i < fills.length; i++) {
        var w = fills[i].style.width;
        fills[i].style.width = '0%';
        fills[i].style.transition = 'none';
        (function(bar, width) {
          requestAnimationFrame(function() {
            bar.style.transition = 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
            bar.style.width = width;
          });
        })(fills[i], w);
      }
    } else {
      projectsList.style.display = 'none';
      toggleIcon.classList.remove('fa-chevron-up');
      toggleIcon.classList.add('fa-chevron-down');
      if (card) card.classList.remove('pm-card-expanded');
    }
  }
}

var dashboard = new PMDashboard();
