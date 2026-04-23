var dashboard = null;

(function() {

function PMDashboard() {
  this.companyId = null;
  this.projects = [];
  this.pmData = {};
  this.isLoading = false;
}

PMDashboard.prototype.loadDashboard = async function(companyId) {
  this.companyId = companyId;
  this.pmData = {};
  this.isLoading = true;

  try {
    this.updateLoadingMessage('Loading projects...');
    var allProjects = await procoreAPI.getProjects(companyId);
    this.projects = allProjects;
    console.log('[Dashboard] Found ' + this.projects.length + ' total projects');

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

      if (processed % 2 === 0) {
        await this.sleep(500);
      }
    }

    this.isLoading = false;
    var pmCount = Object.keys(this.pmData).length;
    var projCount = 0;
    var keys = Object.keys(this.pmData);
    for (var k = 0; k < keys.length; k++) {
      projCount += this.pmData[keys[k]].projects.length;
    }
    console.log('[Dashboard] Done. PMs: ' + pmCount + ', Projects with PM: ' + projCount);
    return this.pmData;

  } catch (error) {
    this.isLoading = false;
    throw error;
  }
};

PMDashboard.prototype.processProject = async function(project, companyId) {
  var detail;
  try {
    detail = await procoreAPI.getProjectDetail(companyId, project.id);
  } catch (e) {
    console.warn('[Dashboard] Cannot get detail for project ' + project.id);
    return;
  }

  var pm = this.findPM(detail, project);

  if (!pm) {
    console.log('[DEBUG] No PM for: ' + (detail.name || project.name));
    return;
  }

  var pmId = pm.id;
  var pmName = pm.name;

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

  var scheduleResult = await this.getProjectProgress(companyId, project.id, detail);

  // Get stage name
  var stageName = 'Not Set';
  if (detail.project_stage && detail.project_stage.name) {
    stageName = detail.project_stage.name;
  } else if (detail.stage && typeof detail.stage === 'string') {
    stageName = detail.stage;
  } else if (detail.stage && detail.stage.name) {
    stageName = detail.stage.name;
  }

  // Determine status based on STAGE, not dates
  var status = this.getStatus(detail, stageName);

  this.pmData[pmId].projects.push({
    id: project.id,
    name: detail.name || project.name || 'Unnamed',
    number: detail.project_number || project.project_number || '',
    stage: stageName,
    status: status,
    startDate: detail.start_date || null,
    completionDate: detail.completion_date || null,
    totalTasks: scheduleResult.totalTasks,
    completedTasks: scheduleResult.completedTasks,
    progressPercent: scheduleResult.progressPercent,
    progressSource: scheduleResult.source
  });

  this.pmData[pmId].totalTasks += scheduleResult.totalTasks;
  this.pmData[pmId].completedTasks += scheduleResult.completedTasks;
};

PMDashboard.prototype.findPM = function(detail, project) {
  if (detail.project_manager && detail.project_manager.id) {
    return { id: detail.project_manager.id, name: detail.project_manager.name || 'Unknown' };
  }

  if (detail.project_manager && typeof detail.project_manager === 'number') {
    return { id: detail.project_manager, name: 'PM #' + detail.project_manager };
  }

  if (detail.project_manager_id) {
    return { id: detail.project_manager_id, name: 'PM #' + detail.project_manager_id };
  }

  if (detail.custom_fields) {
    var cfKeys = Object.keys(detail.custom_fields);
    for (var ci = 0; ci < cfKeys.length; ci++) {
      var cf = detail.custom_fields[cfKeys[ci]];
      if (cf && cf.data_type === 'login_informations' && cf.value) {
        var vals = cf.value;
        if (Array.isArray(vals) && vals.length > 0) {
          var pmData = vals[0];
          if (pmData && pmData.id) {
            return { id: pmData.id, name: pmData.label || pmData.name || 'Unknown' };
          }
        }
        if (!Array.isArray(vals) && vals.id) {
          return { id: vals.id, name: vals.label || vals.name || 'Unknown' };
        }
      }
    }
  }

  if (detail.superintendent && detail.superintendent.id) {
    return { id: detail.superintendent.id, name: detail.superintendent.name || 'Unknown' };
  }

  if (detail.project_owner && detail.project_owner.id) {
    return { id: detail.project_owner.id, name: detail.project_owner.name || 'Unknown' };
  }

  if (detail.created_by && detail.created_by.id && detail.created_by.name) {
    var cn = detail.created_by.name.toLowerCase();
    if (cn.indexOf('barajas') > -1 || cn.indexOf('mora') > -1 ||
        cn.indexOf('munoz') > -1 || cn.indexOf('muñoz') > -1 ||
        cn.indexOf('gallegos') > -1) {
      return { id: detail.created_by.id, name: detail.created_by.name };
    }
  }

  return null;
};

/**
 * Determine project status based on STAGE name, NOT dates
 * - Active = Stage contains "Ejecucion", "Construction", "Course"
 * - Completed = Stage contains "Terminado", "Garantia", "Warranty", "Post", "Cierre"
 * - Not Started = Everything else or project not active
 * NO "Overdue" status - removed per requirement
 */
PMDashboard.prototype.getStatus = function(project, stageName) {
  // If project is not active in Procore
  if (project.active === false) return 'Inactive';

  var stage = (stageName || '').toLowerCase();

  // Active: project is in execution/construction phase
  if (stage.indexOf('ejecuc') > -1 ||
      stage.indexOf('construc') > -1 ||
      stage.indexOf('course') > -1 ||
      stage.indexOf('en proceso') > -1 ||
      stage.indexOf('activo') > -1) {
    return 'Active';
  }

  // Completed: project is finished, in warranty, or post-construction
  if (stage.indexOf('terminad') > -1 ||
      stage.indexOf('garant') > -1 ||
      stage.indexOf('warranty') > -1 ||
      stage.indexOf('post') > -1 ||
      stage.indexOf('cierre') > -1 ||
      stage.indexOf('close') > -1 ||
      stage.indexOf('complet') > -1 ||
      stage.indexOf('finished') > -1 ||
      stage.indexOf('cerrado') > -1) {
    return 'Completed';
  }

  // Pre-construction / design / bidding phases
  if (stage.indexOf('pre') > -1 ||
      stage.indexOf('dise') > -1 ||
      stage.indexOf('design') > -1 ||
      stage.indexOf('cotiza') > -1 ||
      stage.indexOf('bid') > -1 ||
      stage.indexOf('propu') > -1 ||
      stage.indexOf('plann') > -1) {
    return 'Pre-Construction';
  }

  // Not started
  var now = new Date();
  var start = project.start_date ? new Date(project.start_date) : null;
  if (start && now < start) return 'Not Started';

  // Default: Active (if we can't determine from stage)
  return 'Active';
};

PMDashboard.prototype.getProjectProgress = async function(companyId, projectId, detail) {
  var result = {
    totalTasks: 0,
    completedTasks: 0,
    progressPercent: 0,
    source: 'none'
  };

  try {
    var tasks = await procoreAPI.getScheduleTasks(companyId, projectId);

    if (tasks && Array.isArray(tasks) && tasks.length > 0) {
      var workTasks = [];

      for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i];
        if (t.has_children === true) continue;
        if (t.type === 'wbs' || t.task_type === 'wbs') continue;
        workTasks.push(t);
      }

      if (workTasks.length === 0) workTasks = tasks;

      result.totalTasks = workTasks.length;

      for (var j = 0; j < workTasks.length; j++) {
        var task = workTasks[j];
        var isComplete = false;

        var pct = task.percentage || task.percent_complete || task.pct_complete || 0;
        if (typeof pct === 'string') pct = parseFloat(pct);
        if (pct >= 100) isComplete = true;

        var st = (task.status || '').toLowerCase();
        if (st === 'completed' || st === 'complete' || st === 'finished') isComplete = true;

        if (task.actual_finish || task.actual_finish_date || task.actual_end_date) isComplete = true;

        if (isComplete) result.completedTasks++;
      }

      result.progressPercent = result.totalTasks > 0
        ? Math.round((result.completedTasks / result.totalTasks) * 100)
        : 0;
      result.source = 'schedule';
    } else {
      result.progressPercent = this.estimateProgress(detail);
      result.source = 'dates';
    }
  } catch (e) {
    result.progressPercent = this.estimateProgress(detail);
    result.source = 'dates';
  }

  return result;
};

PMDashboard.prototype.loadPMDetails = async function(companyId, pmId) {
  try {
    var user = await procoreAPI.getUser(companyId, pmId);
    if (!user) return;

    this.pmData[pmId].email = user.email_address || user.email || '';

    var av = null;
    if (user.avatar && typeof user.avatar === 'string' && user.avatar.indexOf('http') === 0) {
      av = user.avatar;
    } else if (user.avatar && typeof user.avatar === 'object') {
      av = user.avatar.url || user.avatar.compact || user.avatar.medium ||
           user.avatar.large || user.avatar.thumb || user.avatar.small || null;
      if (!av && user.avatar.versions) {
        av = user.avatar.versions.medium || user.avatar.versions.compact ||
             user.avatar.versions.large || user.avatar.versions.small || null;
      }
    }
    if (!av && user.avatar_url) av = user.avatar_url;
    if (!av && user.profile_image && user.profile_image.url) av = user.profile_image.url;
    if (!av && user.profile_photo && user.profile_photo.url) av = user.profile_photo.url;

    if (av && typeof av === 'string' && av.indexOf('http') === 0) {
      if (av.indexOf('/default') === -1 && av.indexOf('missing') === -1 && av.indexOf('placeholder') === -1) {
        this.pmData[pmId].avatar = procoreAPI.getProxiedImageUrl(av);
      }
    }

    if (user.name) {
      this.pmData[pmId].name = this.cleanName(user.name);
      this.pmData[pmId].initials = this.getInitials(user.name);
    }
  } catch (e) {
    console.warn('[Dashboard] Cannot load PM details for ' + pmId);
  }
};

PMDashboard.prototype.estimateProgress = function(p) {
  var now = new Date();
  var s = p.start_date ? new Date(p.start_date) : null;
  var e = p.completion_date ? new Date(p.completion_date) : null;
  if (!s || !e) return 0;
  if (now >= e) return 100;
  if (now <= s) return 0;
  return Math.min(100, Math.max(0, Math.round(((now - s) / (e - s)) * 100)));
};

PMDashboard.prototype.cleanName = function(name) {
  if (!name) return 'Unknown';
  return name.replace(/\s*\(.*\)\s*$/, '').trim();
};

PMDashboard.prototype.getInitials = function(name) {
  if (!name) return '??';
  var c = this.cleanName(name);
  var parts = c.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return c.substring(0, 2).toUpperCase();
};

PMDashboard.prototype.getProgressColor = function(pct) {
  if (pct >= 75) return '#4CAF50';
  if (pct >= 50) return '#F47E25';
  if (pct >= 25) return '#FFC107';
  return '#F44336';
};

PMDashboard.prototype.getStatusColor = function(s) {
  var c = {
    'Active': '#4CAF50',
    'Completed': '#2196F3',
    'Not Started': '#9E9E9E',
    'Inactive': '#F44336',
    'Pre-Construction': '#9C27B0'
  };
  return c[s] || '#6B7280';
};

PMDashboard.prototype.getStageIcon = function(stage) {
  var s = (stage || '').toLowerCase();
  if (s.indexOf('ejecuc') > -1 || s.indexOf('construc') > -1 || s.indexOf('course') > -1) return 'fa-hard-hat';
  if (s.indexOf('pre') > -1 || s.indexOf('dise') > -1 || s.indexOf('design') > -1) return 'fa-drafting-compass';
  if (s.indexOf('post') > -1 || s.indexOf('cierre') > -1 || s.indexOf('close') > -1) return 'fa-flag-checkered';
  if (s.indexOf('warrant') > -1 || s.indexOf('garant') > -1 || s.indexOf('terminad') > -1) return 'fa-shield-alt';
  if (s.indexOf('cotiza') > -1 || s.indexOf('bid') > -1) return 'fa-file-invoice-dollar';
  return 'fa-folder-open';
};

PMDashboard.prototype.formatDate = function(d) {
  if (!d) return 'N/A';
  var dt = new Date(d);
  if (isNaN(dt.getTime())) return 'N/A';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

PMDashboard.prototype.sleep = function(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
};

PMDashboard.prototype.updateLoadingMessage = function(msg) {
  var el = document.getElementById('loading-message');
  if (el) el.innerHTML = msg;
};

PMDashboard.prototype.togglePMCard = function(pmId) {
  var list = document.getElementById('pm-projects-' + pmId);
  var icon = document.getElementById('toggle-icon-' + pmId);
  var card = document.getElementById('pm-card-' + pmId);
  if (!list || !icon) return;

  if (list.style.display === 'none') {
    list.style.display = 'block';
    icon.classList.remove('fa-chevron-down');
    icon.classList.add('fa-chevron-up');
    if (card) card.classList.add('pm-card-expanded');
    var fills = list.querySelectorAll('.progress-fill');
    for (var i = 0; i < fills.length; i++) {
      var w = fills[i].style.width;
      fills[i].style.width = '0%';
      fills[i].style.transition = 'none';
      (function(b, ww) {
        requestAnimationFrame(function() {
          b.style.transition = 'width 0.8s ease';
          b.style.width = ww;
        });
      })(fills[i], w);
    }
  } else {
    list.style.display = 'none';
    icon.classList.remove('fa-chevron-up');
    icon.classList.add('fa-chevron-down');
    if (card) card.classList.remove('pm-card-expanded');
  }
};

PMDashboard.prototype.renderDashboard = function(container) {
  var pmList = [];
  var keys = Object.keys(this.pmData);
  for (var k = 0; k < keys.length; k++) pmList.push(this.pmData[keys[k]]);

  if (pmList.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-user-slash"></i><h3>No Project Managers Found</h3><p>No projects with assigned PMs were found.</p></div>';
    return;
  }

  var totalProjects = 0, activeProjects = 0, totalProgress = 0;
  for (var i = 0; i < pmList.length; i++) {
    totalProjects += pmList[i].projects.length;
    for (var j = 0; j < pmList[i].projects.length; j++) {
      if (pmList[i].projects[j].status === 'Active') activeProjects++;
      totalProgress += pmList[i].projects[j].progressPercent;
    }
  }
  var avgProgress = totalProjects > 0 ? Math.round(totalProgress / totalProjects) : 0;

  var h = '';

  // ========== SUMMARY CARDS ==========
  h += '<div class="dashboard-summary">';

  h += '<div class="summary-card summary-total"><i class="fas fa-project-diagram"></i><div class="summary-info"><span class="summary-value">' + totalProjects + '</span><span class="summary-label">Total Projects</span></div></div>';

  h += '<div class="summary-card summary-active"><i class="fas fa-play-circle"></i><div class="summary-info"><span class="summary-value">' + activeProjects + '</span><span class="summary-label">Active</span></div></div>';

  h += '<div class="summary-card summary-pms"><i class="fas fa-users"></i><div class="summary-info"><span class="summary-value">' + pmList.length + '</span><span class="summary-label">Project Managers</span></div></div>';

  // AVG Progress with tooltip
  h += '<div class="summary-card summary-avg"><i class="fas fa-chart-line"></i><div class="summary-info"><span class="summary-value">' + avgProgress + '%</span>';
  h += '<span class="summary-label">Avg. Progress ';
  h += '<span class="info-tooltip-wrapper">';
  h += '<span class="info-icon"><i class="fas fa-question"></i></span>';
  h += '<span class="info-tooltip">The Average Progress is calculated from the combined progress of all projects across all Project Managers. For projects with schedule data, progress = completed tasks / total tasks. For projects without schedule data, progress is estimated based on start and completion dates relative to today.</span>';
  h += '</span>';
  h += '</span></div></div>';

  h += '</div>';

  // ========== PM CARDS ==========
  h += '<div class="pm-cards-container">';
  pmList.sort(function(a, b) { return a.name.localeCompare(b.name); });

  for (var p = 0; p < pmList.length; p++) {
    var pm = pmList[p];
    var pmActive = 0, pmProg = 0;
    for (var q = 0; q < pm.projects.length; q++) {
      if (pm.projects[q].status === 'Active') pmActive++;
      pmProg += pm.projects[q].progressPercent;
    }
    var pmAvg = pm.projects.length > 0 ? Math.round(pmProg / pm.projects.length) : 0;
    var pmColor = this.getProgressColor(pmAvg);

    h += '<div class="pm-card" id="pm-card-' + pm.id + '">';

    // PM Header
    h += '<div class="pm-header" onclick="dashboard.togglePMCard(\'' + pm.id + '\')">';
    h += '<div class="pm-profile"><div class="pm-avatar-wrapper">';

    if (pm.avatar) {
      h += '<img src="' + pm.avatar + '" alt="' + pm.name + '" class="pm-avatar" crossorigin="anonymous" referrerpolicy="no-referrer" ';
      h += 'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">';
      h += '<div class="pm-avatar-initials" style="display:none;">' + pm.initials + '</div>';
    } else {
      h += '<div class="pm-avatar-initials">' + pm.initials + '</div>';
    }

    h += '</div><div class="pm-info">';
    h += '<h3 class="pm-name">' + pm.name + '</h3>';
    if (pm.email) h += '<span class="pm-email"><i class="fas fa-envelope"></i> ' + pm.email + '</span>';
    h += '<div class="pm-stats-inline">';
    h += '<span class="pm-stat-badge"><i class="fas fa-folder-open"></i> ' + pm.projects.length + ' project' + (pm.projects.length !== 1 ? 's' : '') + '</span>';
    h += '<span class="pm-stat-badge active"><i class="fas fa-bolt"></i> ' + pmActive + ' active</span>';
    h += '</div></div></div>';

    // Circular Progress
    h += '<div class="pm-summary-right"><div class="pm-circular-progress">';
    h += '<svg viewBox="0 0 36 36" class="circular-progress">';
    h += '<path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>';
    h += '<path class="circle-fill" stroke="' + pmColor + '" stroke-dasharray="' + pmAvg + ', 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>';
    h += '<text x="18" y="20.35" class="progress-text">' + pmAvg + '%</text>';
    h += '</svg></div>';
    h += '<i class="fas fa-chevron-down pm-toggle-icon" id="toggle-icon-' + pm.id + '"></i></div>';

    h += '</div>'; // end pm-header

    // Projects List
    h += '<div class="pm-projects-list" id="pm-projects-' + pm.id + '" style="display:none;">';
    h += '<div class="pm-projects-header"><span><i class="fas fa-list"></i> Assigned Projects</span>';
    h += '<span class="pm-tasks-total"><i class="fas fa-tasks"></i> ' + pm.completedTasks + '/' + pm.totalTasks + ' total tasks</span></div>';

    pm.projects.sort(function(a, b) {
      if (a.status === 'Active' && b.status !== 'Active') return -1;
      if (a.status !== 'Active' && b.status === 'Active') return 1;
      return b.progressPercent - a.progressPercent;
    });

    for (var r = 0; r < pm.projects.length; r++) {
      var proj = pm.projects[r];
      var pColor = this.getProgressColor(proj.progressPercent);
      var sColor = this.getStatusColor(proj.status);
      var sIcon = this.getStageIcon(proj.stage);
      var sourceLabel = proj.progressSource === 'schedule' ? '' : ' (est.)';

      h += '<div class="project-item">';

      // Name + Status
      h += '<div class="project-header-row"><div class="project-name-group">';
      if (proj.number) h += '<span class="project-number">#' + proj.number + '</span>';
      h += '<span class="project-name">' + proj.name + '</span></div>';
      h += '<span class="project-status-badge" style="background:' + sColor + '15;color:' + sColor + ';border:1px solid ' + sColor + '30;">' + proj.status + '</span></div>';

      // Meta
      h += '<div class="project-meta">';
      h += '<span class="project-stage"><i class="fas ' + sIcon + '"></i> ' + proj.stage + '</span>';
      if (proj.progressSource === 'schedule') {
        h += '<span class="project-tasks-count"><i class="fas fa-check-circle"></i> ' + proj.completedTasks + '/' + proj.totalTasks + ' tasks</span>';
      } else {
        h += '<span class="project-tasks-count"><i class="fas fa-calendar-alt"></i> No schedule data</span>';
      }
      h += '</div>';

      // Dates
      h += '<div class="project-dates">';
      if (proj.startDate) h += '<span class="date-tag"><i class="fas fa-play"></i> ' + this.formatDate(proj.startDate) + '</span>';
      if (proj.completionDate) h += '<span class="date-tag"><i class="fas fa-flag-checkered"></i> ' + this.formatDate(proj.completionDate) + '</span>';
      h += '</div>';

      // Progress
      h += '<div class="project-progress-bar"><div class="progress-track"><div class="progress-fill" style="width:' + proj.progressPercent + '%;background:' + pColor + ';"></div></div>';
      h += '<span class="progress-percent" style="color:' + pColor + ';">' + proj.progressPercent + '%' + sourceLabel + '</span></div>';

      h += '</div>';
    }

    h += '</div></div>';
  }

  h += '</div>';
  container.innerHTML = h;

  setTimeout(function() {
    var bars = document.querySelectorAll('.progress-fill');
    for (var b = 0; b < bars.length; b++) bars[b].style.transition = 'width 1s ease';
  }, 100);
};

dashboard = new PMDashboard();
console.log('[Dashboard] Module loaded.');

})();
