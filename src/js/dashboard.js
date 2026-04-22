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

  // Find PM
  var pm = this.findProjectManager(detail, project);
  if (!pm) return;

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

  // Get schedule data for progress calculation
  var scheduleResult = await this.getProjectProgress(companyId, project.id, detail);

  // Get stage name
  var stageName = 'Not Set';
  if (detail.project_stage && detail.project_stage.name) {
    stageName = detail.project_stage.name;
  } else if (detail.stage) {
    stageName = detail.stage;
  }

  this.pmData[pmId].projects.push({
    id: project.id,
    name: detail.name || project.name || 'Unnamed',
    number: detail.project_number || project.project_number || '',
    stage: stageName,
    status: this.getStatus(detail),
    startDate: detail.start_date || null,
    completionDate: detail.completion_date || null,
    totalTasks: scheduleResult.totalTasks,
    completedTasks: scheduleResult.completedTasks,
    progressPercent: scheduleResult.progressPercent
  });

  this.pmData[pmId].totalTasks += scheduleResult.totalTasks;
  this.pmData[pmId].completedTasks += scheduleResult.completedTasks;
};

PMDashboard.prototype.findProjectManager = function(detail, project) {
  var pm = null;

  // Method 1: Standard project_manager object
  if (detail.project_manager && detail.project_manager.id) {
    return { id: detail.project_manager.id, name: detail.project_manager.name || 'Unknown' };
  }

  // Method 2: project_manager as number
  if (detail.project_manager && typeof detail.project_manager === 'number') {
    return { id: detail.project_manager, name: 'PM #' + detail.project_manager };
  }

  // Method 3: project_manager_id
  if (detail.project_manager_id) {
    return { id: detail.project_manager_id, name: 'PM #' + detail.project_manager_id };
  }

  // Method 4: Custom fields (login_informations type)
  if (detail.custom_fields) {
    var cfKeys = Object.keys(detail.custom_fields);
    for (var ci = 0; ci < cfKeys.length; ci++) {
      var cf = detail.custom_fields[cfKeys[ci]];
      if (cf && cf.data_type === 'login_informations' && cf.value && cf.value.length > 0) {
        var pmData = cf.value[0];
        if (pmData && pmData.id) {
          return { id: pmData.id, name: pmData.label || 'Unknown PM' };
        }
      }
    }
  }

  // Method 5: superintendent
  if (detail.superintendent && detail.superintendent.id) {
    return { id: detail.superintendent.id, name: detail.superintendent.name || 'Unknown' };
  }

  return null;
};

PMDashboard.prototype.getProjectProgress = async function(companyId, projectId, detail) {
  var result = { totalTasks: 0, completedTasks: 0, progressPercent: 0 };

  try {
    // Try the schedule tasks endpoint
    var tasks = await procoreAPI.getScheduleTasks(companyId, projectId);
    
    console.log('[DEBUG Schedule] Project ' + (detail.name || projectId) + ': got ' + (tasks ? tasks.length : 0) + ' tasks');
    
    if (tasks && Array.isArray(tasks) && tasks.length > 0) {
      // Log first task structure to understand the data
      if (tasks.length > 0) {
        var firstTask = tasks[0];
        console.log('[DEBUG Schedule] First task keys:', Object.keys(firstTask).join(', '));
        console.log('[DEBUG Schedule] First task sample:', JSON.stringify({
          name: firstTask.name || firstTask.task_name,
          percentage: firstTask.percentage,
          percent_complete: firstTask.percent_complete,
          status: firstTask.status,
          type: firstTask.type,
          task_type: firstTask.task_type,
          has_children: firstTask.has_children,
          resource_type: firstTask.resource_type
        }));
      }

      // Filter to get only work tasks (not summary/WBS/milestone)
      var workTasks = [];
      for (var t = 0; t < tasks.length; t++) {
        var task = tasks[t];
        
        // Skip summary tasks (parent tasks that have children)
        if (task.has_children === true) continue;
        
        // Skip WBS elements
        if (task.type === 'wbs' || task.task_type === 'wbs') continue;
        if (task.resource_type === 'wbs') continue;
        
        // This is a work task
        workTasks.push(task);
      }

      result.totalTasks = workTasks.length;

      // Count completed tasks
      for (var w = 0; w < workTasks.length; w++) {
        var wt = workTasks[w];
        
        // Check various fields for completion percentage
        var pct = 0;
        if (typeof wt.percentage === 'number') pct = wt.percentage;
        else if (typeof wt.percent_complete === 'number') pct = wt.percent_complete;
        else if (typeof wt.percentage === 'string') pct = parseFloat(wt.percentage) || 0;
        else if (typeof wt.percent_complete === 'string') pct = parseFloat(wt.percent_complete) || 0;
        
        // Check status
        var status = (wt.status || '').toLowerCase();
        
        if (pct >= 100 || status === 'completed' || status === 'complete' || status === 'finished') {
          result.completedTasks++;
        }
      }

      result.progressPercent = result.totalTasks > 0
        ? Math.round((result.completedTasks / result.totalTasks) * 100)
        : 0;

      console.log('[DEBUG Schedule] ' + (detail.name || projectId) + ': ' + result.completedTasks + '/' + result.totalTasks + ' = ' + result.progressPercent + '%');
    } else {
      // No tasks found - try alternative: use the percentage field from individual tasks via different endpoint
      console.log('[DEBUG Schedule] No tasks returned for project ' + (detail.name || projectId));
      
      // Fallback: estimate by dates BUT only if project is active
      if (detail.active !== false && detail.start_date && detail.completion_date) {
        var now = new Date();
        var start = new Date(detail.start_date);
        var end = new Date(detail.completion_date);
        
        // Only use date estimation if we're between start and end dates
        if (now >= start && now <= end) {
          var total = end - start;
          var elapsed = now - start;
          result.progressPercent = Math.round((elapsed / total) * 100);
        } else if (now > end) {
          // Project is past due - don't assume 100%, mark as unknown
          result.progressPercent = 0; // We don't know the actual progress
        } else if (now < start) {
          result.progressPercent = 0;
        }
      }
    }
  } catch (e) {
    console.warn('[Dashboard] Schedule error for project ' + projectId + ':', e.message);
    
    // Fallback: date-based estimation only for active projects within dates
    if (detail.active !== false && detail.start_date && detail.completion_date) {
      var now2 = new Date();
      var start2 = new Date(detail.start_date);
      var end2 = new Date(detail.completion_date);
      
      if (now2 >= start2 && now2 <= end2) {
        var total2 = end2 - start2;
        var elapsed2 = now2 - start2;
        result.progressPercent = Math.round((elapsed2 / total2) * 100);
      }
    }
  }

  return result;
};

PMDashboard.prototype.loadPMDetails = async function(companyId, pmId) {
  try {
    var user = await procoreAPI.getUser(companyId, pmId);
    
    if (!user) {
      console.warn('[Dashboard] No user data for PM ' + pmId);
      return;
    }

    console.log('[DEBUG PM] User data for ' + pmId + ':', JSON.stringify({
      name: user.name,
      email: user.email_address || user.email,
      avatar: user.avatar ? (typeof user.avatar === 'string' ? 'string:' + user.avatar.substring(0, 50) : 'object:' + JSON.stringify(user.avatar).substring(0, 100)) : 'null',
      avatar_url: user.avatar_url || 'none',
      profile_image: user.profile_image ? JSON.stringify(user.profile_image).substring(0, 100) : 'none',
      has_avatar: user.has_avatar
    }));

    // Set email
    this.pmData[pmId].email = user.email_address || user.email || '';

    // Try ALL possible avatar fields
    var avatarUrl = null;

    // Check 1: avatar as direct URL string
    if (!avatarUrl && user.avatar && typeof user.avatar === 'string') {
      if (user.avatar.indexOf('http') === 0) {
        avatarUrl = user.avatar;
        console.log('[DEBUG PM] Avatar from string:', avatarUrl.substring(0, 80));
      }
    }

    // Check 2: avatar as object with various sub-fields
    if (!avatarUrl && user.avatar && typeof user.avatar === 'object') {
      if (user.avatar.url) avatarUrl = user.avatar.url;
      else if (user.avatar.compact) avatarUrl = user.avatar.compact;
      else if (user.avatar.thumb) avatarUrl = user.avatar.thumb;
      else if (user.avatar.small) avatarUrl = user.avatar.small;
      else if (user.avatar.medium) avatarUrl = user.avatar.medium;
      else if (user.avatar.large) avatarUrl = user.avatar.large;
      else if (user.avatar.original) avatarUrl = user.avatar.original;
      
      if (avatarUrl) console.log('[DEBUG PM] Avatar from object:', avatarUrl.substring(0, 80));
      
      // If avatar is an object but we didn't find a URL, check all keys
      if (!avatarUrl) {
        var avKeys = Object.keys(user.avatar);
        console.log('[DEBUG PM] Avatar object keys:', avKeys.join(', '));
        for (var ai = 0; ai < avKeys.length; ai++) {
          var avVal = user.avatar[avKeys[ai]];
          if (typeof avVal === 'string' && avVal.indexOf('http') === 0) {
            avatarUrl = avVal;
            console.log('[DEBUG PM] Avatar from key "' + avKeys[ai] + '":', avatarUrl.substring(0, 80));
            break;
          }
        }
      }
    }

    // Check 3: avatar_url field
    if (!avatarUrl && user.avatar_url) {
      avatarUrl = user.avatar_url;
      console.log('[DEBUG PM] Avatar from avatar_url:', avatarUrl.substring(0, 80));
    }

    // Check 4: profile_image
    if (!avatarUrl && user.profile_image) {
      if (typeof user.profile_image === 'string' && user.profile_image.indexOf('http') === 0) {
        avatarUrl = user.profile_image;
      } else if (user.profile_image.url) {
        avatarUrl = user.profile_image.url;
      } else if (user.profile_image.compact) {
        avatarUrl = user.profile_image.compact;
      }
      if (avatarUrl) console.log('[DEBUG PM] Avatar from profile_image:', avatarUrl.substring(0, 80));
    }

    // Check 5: image field
    if (!avatarUrl && user.image) {
      if (typeof user.image === 'string' && user.image.indexOf('http') === 0) {
        avatarUrl = user.image;
      } else if (user.image && user.image.url) {
        avatarUrl = user.image.url;
      }
    }

    // Validate: only use if it's a real photo URL (not default/placeholder)
    if (avatarUrl) {
      var lowerUrl = avatarUrl.toLowerCase();
      if (lowerUrl.indexOf('default') > -1 || lowerUrl.indexOf('missing') > -1 || lowerUrl.indexOf('placeholder') > -1) {
        console.log('[DEBUG PM] Avatar rejected (default/missing):', avatarUrl.substring(0, 80));
        avatarUrl = null;
      }
    }

    if (avatarUrl) {
      this.pmData[pmId].avatar = avatarUrl;
      console.log('[DEBUG PM] ✅ Avatar SET for ' + this.pmData[pmId].name);
    } else {
      console.log('[DEBUG PM] ❌ No avatar found for ' + this.pmData[pmId].name);
    }

    // Update name
    if (user.name) {
      this.pmData[pmId].name = this.cleanName(user.name);
      this.pmData[pmId].initials = this.getInitials(user.name);
    }

  } catch (e) {
    console.warn('[Dashboard] Cannot load PM details for ' + pmId + ':', e.message);
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
  if (s.indexOf('pre') > -1 || s.indexOf('dise') > -1 || s.indexOf('design') > -1) return 'fa-drafting-compass';
  if (s.indexOf('post') > -1 || s.indexOf('cierre') > -1 || s.indexOf('close') > -1) return 'fa-flag-checkered';
  if (s.indexOf('warrant') > -1 || s.indexOf('garant') > -1) return 'fa-shield-alt';
  if (s.indexOf('terminad') > -1 || s.indexOf('period') > -1) return 'fa-check-double';
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
  for (var k = 0; k < keys.length; k++) pmList.push(this.pmData[keys[k]]);

  if (pmList.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-user-slash"></i><h3>No Project Managers Found</h3><p>No projects with assigned PMs were found. Check F12 console for debug info.</p></div>';
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

  // Summary
  h += '<div class="dashboard-summary">';
  h += '<div class="summary-card summary-total"><i class="fas fa-project-diagram"></i><div class="summary-info"><span class="summary-value">' + totalProjects + '</span><span class="summary-label">Total Projects</span></div></div>';
  h += '<div class="summary-card summary-active"><i class="fas fa-play-circle"></i><div class="summary-info"><span class="summary-value">' + activeProjects + '</span><span class="summary-label">Active</span></div></div>';
  h += '<div class="summary-card summary-pms"><i class="fas fa-users"></i><div class="summary-info"><span class="summary-value">' + pmList.length + '</span><span class="summary-label">Project Managers</span></div></div>';
  h += '<div class="summary-card summary-avg"><i class="fas fa-chart-line"></i><div class="summary-info"><span class="summary-value">' + avgProgress + '%</span><span class="summary-label">Avg. Progress</span></div></div>';
  h += '</div>';

  // PM Cards
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
    h += '<div class="pm-header" onclick="dashboard.togglePMCard(\'' + pm.id + '\')">';
    h += '<div class="pm-profile"><div class="pm-avatar-wrapper">';

    if (pm.avatar) {
      h += '<img src="' + pm.avatar + '" alt="' + pm.name + '" class="pm-avatar" crossorigin="anonymous" ';
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

    h += '<div class="pm-summary-right"><div class="pm-circular-progress">';
    h += '<svg viewBox="0 0 36 36" class="circular-progress">';
    h += '<path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>';
    h += '<path class="circle-fill" stroke="' + pmColor + '" stroke-dasharray="' + pmAvg + ', 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>';
    h += '<text x="18" y="20.35" class="progress-text">' + pmAvg + '%</text>';
    h += '</svg></div>';
    h += '<i class="fas fa-chevron-down pm-toggle-icon" id="toggle-icon-' + pm.id + '"></i>';
    h += '</div></div>';

    // Projects list
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
      var taskLabel = proj.totalTasks > 0 ? (proj.completedTasks + '/' + proj.totalTasks + ' tasks') : 'No schedule data';

      h += '<div class="project-item' + (proj.status === 'Overdue' ? ' project-overdue' : '') + '">';
      h += '<div class="project-header-row"><div class="project-name-group">';
      if (proj.number) h += '<span class="project-number">#' + proj.number + '</span>';
      h += '<span class="project-name">' + proj.name + '</span></div>';
      h += '<span class="project-status-badge" style="background:' + sColor + '15;color:' + sColor + ';border:1px solid ' + sColor + '30;">' + proj.status + '</span></div>';

      h += '<div class="project-meta">';
      h += '<span class="project-stage"><i class="fas ' + sIcon + '"></i> ' + proj.stage + '</span>';
      h += '<span class="project-tasks-count"><i class="fas fa-check-circle"></i> ' + taskLabel + '</span>';
      h += '</div>';

      h += '<div class="project-dates">';
      if (proj.startDate) h += '<span class="date-tag"><i class="fas fa-play"></i> ' + this.formatDate(proj.startDate) + '</span>';
      if (proj.completionDate) h += '<span class="date-tag"><i class="fas fa-flag-checkered"></i> ' + this.formatDate(proj.completionDate) + '</span>';
      h += '</div>';

      // Show progress bar with different style if no schedule data
      if (proj.totalTasks > 0) {
        h += '<div class="project-progress-bar">';
        h += '<div class="progress-track"><div class="progress-fill" style="width:' + proj.progressPercent + '%;background:' + pColor + ';"></div></div>';
        h += '<span class="progress-percent" style="color:' + pColor + ';">' + proj.progressPercent + '%</span>';
        h += '</div>';
      } else if (proj.progressPercent > 0) {
        h += '<div class="project-progress-bar">';
        h += '<div class="progress-track"><div class="progress-fill" style="width:' + proj.progressPercent + '%;background:#FFC107;opacity:0.6;"></div></div>';
        h += '<span class="progress-percent" style="color:#FFC107;font-size:10px;">' + proj.progressPercent + '% (est.)</span>';
        h += '</div>';
      } else {
        h += '<div class="project-progress-bar">';
        h += '<div class="progress-track"><div class="progress-fill" style="width:0%;"></div></div>';
        h += '<span class="progress-percent" style="color:#9CA3AF;font-size:10px;">N/A</span>';
        h += '</div>';
      }

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
