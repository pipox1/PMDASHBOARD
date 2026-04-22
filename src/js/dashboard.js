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
        await this.sleep(300);
      }
    }

    this.isLoading = false;
    console.log('[Dashboard] Done. PMs found:', Object.keys(this.pmData).length);
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

  console.log('[DEBUG] Project: ' + (detail.name || project.name));

  // Try to find PM from multiple sources
  var pm = null;

  // Method 1: Standard project_manager field (object with id)
  if (detail.project_manager && detail.project_manager.id) {
    pm = { id: detail.project_manager.id, name: detail.project_manager.name || 'Unknown' };
    console.log('[DEBUG] PM found via project_manager:', pm.name);
  }

  // Method 2: project_manager as number
  if (!pm && detail.project_manager && typeof detail.project_manager === 'number') {
    pm = { id: detail.project_manager, name: 'PM #' + detail.project_manager };
    console.log('[DEBUG] PM found via project_manager number:', pm.id);
  }

  // Method 3: project_manager_id field
  if (!pm && detail.project_manager_id) {
    pm = { id: detail.project_manager_id, name: 'PM #' + detail.project_manager_id };
    console.log('[DEBUG] PM found via project_manager_id:', pm.id);
  }

  // Method 4: Custom fields - WHERE YOUR PM DATA IS STORED!
  // Procore stores the PM in a custom field of type "login_informations"
  if (!pm && detail.custom_fields) {
    var cfKeys = Object.keys(detail.custom_fields);
    for (var ci = 0; ci < cfKeys.length; ci++) {
      var cf = detail.custom_fields[cfKeys[ci]];
      // Look for login_informations type fields (user picker fields)
      if (cf && cf.data_type === 'login_informations' && cf.value && cf.value.length > 0) {
        var pmData = cf.value[0]; // First person in the list is the PM
        if (pmData && pmData.id) {
          pm = { id: pmData.id, name: pmData.label || 'Unknown PM' };
          console.log('[DEBUG] PM found via custom_field (' + cfKeys[ci] + '):', pm.name);
          break;
        }
      }
    }
  }

  // Method 5: superintendent field
  if (!pm && detail.superintendent && detail.superintendent.id) {
    pm = { id: detail.superintendent.id, name: detail.superintendent.name || 'Unknown' };
    console.log('[DEBUG] PM found via superintendent:', pm.name);
  }

  // Method 6: project_owner field
  if (!pm && detail.project_owner && detail.project_owner.id) {
    pm = { id: detail.project_owner.id, name: detail.project_owner.name || 'Unknown' };
    console.log('[DEBUG] PM found via project_owner:', pm.name);
  }

  // Method 7: created_by as fallback
  if (!pm && detail.created_by && detail.created_by.id) {
    // Only use created_by if it matches known PM names
    var creatorName = (detail.created_by.name || '').toLowerCase();
    if (creatorName.indexOf('barajas') > -1 || creatorName.indexOf('mora') > -1 ||
        creatorName.indexOf('munoz') > -1 || creatorName.indexOf('muñoz') > -1 ||
        creatorName.indexOf('gallegos') > -1) {
      pm = { id: detail.created_by.id, name: detail.created_by.name || 'Unknown' };
      console.log('[DEBUG] PM found via created_by (known PM):', pm.name);
    }
  }

  if (!pm) {
    console.log('[DEBUG] No PM found for: ' + (detail.name || project.name));
    return;
  }

  var pmId = pm.id;
  var pmName = pm.name;

  // Initialize PM data if this is a new PM
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

    // Load PM user details (avatar, email)
    await this.loadPMDetails(companyId, pmId);
  }

  // Get schedule tasks for progress calculation
  var totalTasks = 0;
  var completedTasks = 0;
  var progressPercent = 0;

  try {
    var tasks = await procoreAPI.getScheduleTasks(companyId, project.id);
    if (tasks && Array.isArray(tasks) && tasks.length > 0) {
      var workTasks = tasks.filter(function(t) {
        return !t.has_children;
      });
      totalTasks = workTasks.length;
      completedTasks = workTasks.filter(function(t) {
        var pct = t.percentage || t.percent_complete || 0;
        var st = (t.status || '').toLowerCase();
        return pct >= 100 || st === 'completed' || st === 'complete';
      }).length;
      progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    }
  } catch (e) {
    console.warn('[Dashboard] No schedule for project ' + project.id);
    progressPercent = this.estimateProgress(detail);
  }

  // Get the stage name properly
  var stageName = 'Not Set';
  if (detail.project_stage && detail.project_stage.name) {
    stageName = detail.project_stage.name;
  } else if (detail.stage) {
    stageName = detail.stage;
  } else if (project.stage) {
    stageName = project.stage;
  }

  // Add project to PM data
  this.pmData[pmId].projects.push({
    id: project.id,
    name: detail.name || project.name || 'Unnamed',
    number: detail.project_number || project.project_number || '',
    stage: stageName,
    status: this.getStatus(detail),
    startDate: detail.start_date || null,
    completionDate: detail.completion_date || null,
    totalTasks: totalTasks,
    completedTasks: completedTasks,
    progressPercent: progressPercent
  });

  this.pmData[pmId].totalTasks += totalTasks;
  this.pmData[pmId].completedTasks += completedTasks;
};

PMDashboard.prototype.loadPMDetails = async function(companyId, pmId) {
  try {
    var user = await procoreAPI.getUser(companyId, pmId);
    if (user) {
      this.pmData[pmId].email = user.email_address || user.email || '';

      // Try to get avatar URL from various possible fields
      var av = null;
      if (user.avatar && typeof user.avatar === 'string' && user.avatar.indexOf('http') === 0) {
        av = user.avatar;
      } else if (user.avatar && user.avatar.url) {
        av = user.avatar.url;
      } else if (user.avatar && user.avatar.compact) {
        av = user.avatar.compact;
      } else if (user.avatar_url) {
        av = user.avatar_url;
      } else if (user.profile_image && user.profile_image.url) {
        av = user.profile_image.url;
      }

      // Only use if it is a real photo (not a default placeholder)
      if (av && av.indexOf('default') === -1 && av.indexOf('missing') === -1) {
        this.pmData[pmId].avatar = av;
      }

      // Update name if available from user directory
      if (user.name) {
        this.pmData[pmId].name = this.cleanName(user.name);
        this.pmData[pmId].initials = this.getInitials(user.name);
      }
    }
  } catch (e) {
    console.warn('[Dashboard] Cannot load PM details for ' + pmId);
  }
};

PMDashboard.prototype.getStatus = function(p) {
  if (p.active === false) return 'Inactive';
  var now = new Date();
  var end = p.completion_date ? new Date(p.completion_date) : null;
  var start = p.start_date ? new Date(p.start_date) : null;
  if (end && now > end) return 'Overdue';
  if (start && now < start) return 'Not Started';
  return 'Active';
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
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return c.substring(0, 2).toUpperCase();
};

PMDashboard.prototype.getProgressColor = function(pct) {
  if (pct >= 75) return '#4CAF50';
  if (pct >= 50) return '#F47E25';
  if (pct >= 25) return '#FFC107';
  return '#F44336';
};

PMDashboard.prototype.getStatusColor = function(s) {
  var colors = {
    'Active': '#4CAF50',
    'Completed': '#2196F3',
    'Not Started': '#9E9E9E',
    'Inactive': '#F44336',
    'Overdue': '#F44336'
  };
  return colors[s] || '#6B7280';
};

PMDashboard.prototype.getStageIcon = function(stage) {
  var s = (stage || '').toLowerCase();
  if (s.indexOf('ejecuc') > -1 || s.indexOf('construc') > -1 || s.indexOf('course') > -1) return 'fa-hard-hat';
  if (s.indexOf('pre') > -1 || s.indexOf('dise') > -1 || s.indexOf('design') > -1 || s.indexOf('plann') > -1) return 'fa-drafting-compass';
  if (s.indexOf('post') > -1 || s.indexOf('cierre') > -1 || s.indexOf('close') > -1) return 'fa-flag-checkered';
  if (s.indexOf('warrant') > -1 || s.indexOf('garant') > -1) return 'fa-shield-alt';
  if (s.indexOf('cotiza') > -1 || s.indexOf('bid') > -1 || s.indexOf('propu') > -1) return 'fa-file-invoice-dollar';
  if (s.indexOf('complet') > -1 || s.indexOf('termin') > -1) return 'fa-check-double';
  return 'fa-folder-open';
};

PMDashboard.prototype.formatDate = function(d) {
  if (!d) return 'N/A';
  var dt = new Date(d);
  if (isNaN(dt.getTime())) return 'N/A';
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

PMDashboard.prototype.sleep = function(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
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

    // Animate progress bars when expanding
    var fills = list.querySelectorAll('.progress-fill');
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
    list.style.display = 'none';
    icon.classList.remove('fa-chevron-up');
    icon.classList.add('fa-chevron-down');
    if (card) card.classList.remove('pm-card-expanded');
  }
};

PMDashboard.prototype.renderDashboard = function(container) {
  var pmList = [];
  var keys = Object.keys(this.pmData);
  for (var k = 0; k < keys.length; k++) {
    pmList.push(this.pmData[keys[k]]);
  }

  // Empty state
  if (pmList.length === 0) {
    container.innerHTML = '<div class="empty-state">' +
      '<i class="fas fa-user-slash"></i>' +
      '<h3>No Project Managers Found</h3>' +
      '<p>No projects with assigned Project Managers were found. Open browser console (F12) for debug info.</p>' +
      '</div>';
    return;
  }

  // Calculate global totals
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

  // Build HTML
  var h = '';

  // ========== SUMMARY CARDS ==========
  h += '<div class="dashboard-summary">';

  h += '<div class="summary-card summary-total">';
  h += '<i class="fas fa-project-diagram"></i>';
  h += '<div class="summary-info">';
  h += '<span class="summary-value">' + totalProjects + '</span>';
  h += '<span class="summary-label">Total Projects</span>';
  h += '</div></div>';

  h += '<div class="summary-card summary-active">';
  h += '<i class="fas fa-play-circle"></i>';
  h += '<div class="summary-info">';
  h += '<span class="summary-value">' + activeProjects + '</span>';
  h += '<span class="summary-label">Active</span>';
  h += '</div></div>';

  h += '<div class="summary-card summary-pms">';
  h += '<i class="fas fa-users"></i>';
  h += '<div class="summary-info">';
  h += '<span class="summary-value">' + pmList.length + '</span>';
  h += '<span class="summary-label">Project Managers</span>';
  h += '</div></div>';

  h += '<div class="summary-card summary-avg">';
  h += '<i class="fas fa-chart-line"></i>';
  h += '<div class="summary-info">';
  h += '<span class="summary-value">' + avgProgress + '%</span>';
  h += '<span class="summary-label">Avg. Progress</span>';
  h += '</div></div>';

  h += '</div>'; // end dashboard-summary

  // ========== PM CARDS ==========
  h += '<div class="pm-cards-container">';

  // Sort PMs alphabetically
  pmList.sort(function(a, b) {
    return a.name.localeCompare(b.name);
  });

  for (var p = 0; p < pmList.length; p++) {
    var pm = pmList[p];

    // Calculate PM-level stats
    var pmActive = 0;
    var pmProg = 0;
    for (var q = 0; q < pm.projects.length; q++) {
      if (pm.projects[q].status === 'Active') pmActive++;
      pmProg += pm.projects[q].progressPercent;
    }
    var pmAvg = pm.projects.length > 0 ? Math.round(pmProg / pm.projects.length) : 0;
    var pmColor = this.getProgressColor(pmAvg);

    // --- PM Card ---
    h += '<div class="pm-card" id="pm-card-' + pm.id + '">';

    // PM Header (clickable to expand/collapse)
    h += '<div class="pm-header" onclick="dashboard.togglePMCard(\'' + pm.id + '\')">';

    // Profile section
    h += '<div class="pm-profile">';

    // Avatar
    h += '<div class="pm-avatar-wrapper">';
    if (pm.avatar) {
      h += '<img src="' + pm.avatar + '" alt="' + pm.name + '" class="pm-avatar" ';
      h += 'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">';
      h += '<div class="pm-avatar-initials" style="display:none;">' + pm.initials + '</div>';
    } else {
      h += '<div class="pm-avatar-initials">' + pm.initials + '</div>';
    }
    h += '</div>'; // end avatar-wrapper

    // PM Info text
    h += '<div class="pm-info">';
    h += '<h3 class="pm-name">' + pm.name + '</h3>';
    if (pm.email) {
      h += '<span class="pm-email"><i class="fas fa-envelope"></i> ' + pm.email + '</span>';
    }
    h += '<div class="pm-stats-inline">';
    h += '<span class="pm-stat-badge"><i class="fas fa-folder-open"></i> ' + pm.projects.length + ' project' + (pm.projects.length !== 1 ? 's' : '') + '</span>';
    h += '<span class="pm-stat-badge active"><i class="fas fa-bolt"></i> ' + pmActive + ' active</span>';
    h += '</div>';
    h += '</div>'; // end pm-info

    h += '</div>'; // end pm-profile

    // Circular progress + toggle icon
    h += '<div class="pm-summary-right">';
    h += '<div class="pm-circular-progress">';
    h += '<svg viewBox="0 0 36 36" class="circular-progress">';
    h += '<path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>';
    h += '<path class="circle-fill" stroke="' + pmColor + '" stroke-dasharray="' + pmAvg + ', 100" ';
    h += 'd="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>';
    h += '<text x="18" y="20.35" class="progress-text">' + pmAvg + '%</text>';
    h += '</svg>';
    h += '</div>';
    h += '<i class="fas fa-chevron-down pm-toggle-icon" id="toggle-icon-' + pm.id + '"></i>';
    h += '</div>'; // end pm-summary-right

    h += '</div>'; // end pm-header

    // ========== PROJECTS LIST (collapsed by default) ==========
    h += '<div class="pm-projects-list" id="pm-projects-' + pm.id + '" style="display:none;">';

    // Projects list header
    h += '<div class="pm-projects-header">';
    h += '<span><i class="fas fa-list"></i> Assigned Projects</span>';
    h += '<span class="pm-tasks-total"><i class="fas fa-tasks"></i> ' + pm.completedTasks + '/' + pm.totalTasks + ' total tasks</span>';
    h += '</div>';

    // Sort projects: active first, then by progress descending
    pm.projects.sort(function(a, b) {
      if (a.status === 'Active' && b.status !== 'Active') return -1;
      if (a.status !== 'Active' && b.status === 'Active') return 1;
      return b.progressPercent - a.progressPercent;
    });

    // Render each project
    for (var r = 0; r < pm.projects.length; r++) {
      var proj = pm.projects[r];
      var pColor = this.getProgressColor(proj.progressPercent);
      var sColor = this.getStatusColor(proj.status);
      var sIcon = this.getStageIcon(proj.stage);

      h += '<div class="project-item' + (proj.status === 'Overdue' ? ' project-overdue' : '') + '">';

      // Project name and status badge
      h += '<div class="project-header-row">';
      h += '<div class="project-name-group">';
      if (proj.number) {
        h += '<span class="project-number">#' + proj.number + '</span>';
      }
      h += '<span class="project-name">' + proj.name + '</span>';
      h += '</div>';
      h += '<span class="project-status-badge" style="background:' + sColor + '15;color:' + sColor + ';border:1px solid ' + sColor + '30;">';
      h += proj.status;
      h += '</span>';
      h += '</div>';

      // Stage and task count
      h += '<div class="project-meta">';
      h += '<span class="project-stage"><i class="fas ' + sIcon + '"></i> ' + proj.stage + '</span>';
      h += '<span class="project-tasks-count"><i class="fas fa-check-circle"></i> ' + proj.completedTasks + '/' + proj.totalTasks + ' tasks</span>';
      h += '</div>';

      // Dates
      h += '<div class="project-dates">';
      if (proj.startDate) {
        h += '<span class="date-tag"><i class="fas fa-play"></i> ' + this.formatDate(proj.startDate) + '</span>';
      }
      if (proj.completionDate) {
        h += '<span class="date-tag"><i class="fas fa-flag-checkered"></i> ' + this.formatDate(proj.completionDate) + '</span>';
      }
      h += '</div>';

      // Progress bar
      h += '<div class="project-progress-bar">';
      h += '<div class="progress-track">';
      h += '<div class="progress-fill" style="width:' + proj.progressPercent + '%;background:' + pColor + ';"></div>';
      h += '</div>';
      h += '<span class="progress-percent" style="color:' + pColor + ';">' + proj.progressPercent + '%</span>';
      h += '</div>';

      h += '</div>'; // end project-item
    }

    h += '</div>'; // end pm-projects-list
    h += '</div>'; // end pm-card
  }

  h += '</div>'; // end pm-cards-container

  // Set HTML content
  container.innerHTML = h;

  // Animate progress bars after a short delay
  setTimeout(function() {
    var bars = document.querySelectorAll('.progress-fill');
    for (var b = 0; b < bars.length; b++) {
      bars[b].style.transition = 'width 1s cubic-bezier(0.4, 0, 0.2, 1)';
    }
  }, 100);
};

// Create the global dashboard instance
dashboard = new PMDashboard();
console.log('[Dashboard] Module loaded successfully.');

})();
