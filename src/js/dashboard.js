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

  // DEBUG logging
  console.log('[DEBUG] === Project: ' + (detail.name || project.name) + ' ===');
  
  var allKeys = Object.keys(detail);
  var relevantKeys = [];
  for (var ki = 0; ki < allKeys.length; ki++) {
    var kl = allKeys[ki].toLowerCase();
    if (kl.indexOf('manager') > -1 || kl.indexOf('pm') > -1 || kl.indexOf('super') > -1 || kl.indexOf('owner') > -1 || kl.indexOf('assigned') > -1) {
      relevantKeys.push(allKeys[ki]);
    }
  }
  console.log('[DEBUG] Relevant keys:', relevantKeys.join(', '));

  // Log relevant field values
  for (var ri = 0; ri < relevantKeys.length; ri++) {
    var val = detail[relevantKeys[ri]];
    console.log('[DEBUG]   ' + relevantKeys[ri] + ' =', JSON.stringify(val));
  }

  // Try multiple ways to find the PM
  var pm = null;

  // Way 1: project_manager as object with id
  if (detail.project_manager && detail.project_manager.id) {
    pm = { id: detail.project_manager.id, name: detail.project_manager.name || 'Unknown' };
    console.log('[DEBUG] Found PM via project_manager object:', pm.name);
  }
  // Way 2: project_manager as number (just an ID)
  else if (detail.project_manager && typeof detail.project_manager === 'number') {
    pm = { id: detail.project_manager, name: 'PM #' + detail.project_manager };
    console.log('[DEBUG] Found PM via project_manager number:', pm.id);
  }
  // Way 3: project_manager as string (name only?)
  else if (detail.project_manager && typeof detail.project_manager === 'string') {
    console.log('[DEBUG] project_manager is a string:', detail.project_manager);
  }
  // Way 4: project_manager_id 
  else if (detail.project_manager_id) {
    pm = { id: detail.project_manager_id, name: 'PM #' + detail.project_manager_id };
    console.log('[DEBUG] Found PM via project_manager_id:', pm.id);
  }
  // Way 5: pm_id
  else if (detail.pm_id) {
    pm = { id: detail.pm_id, name: 'PM #' + detail.pm_id };
    console.log('[DEBUG] Found PM via pm_id:', pm.id);
  }
  // Way 6: superintendent or project_owner
  else if (detail.project_owner && detail.project_owner.id) {
    pm = { id: detail.project_owner.id, name: detail.project_owner.name || 'Unknown' };
    console.log('[DEBUG] Found PM via project_owner:', pm.name);
  }

  if (!pm) {
    console.log('[DEBUG] NO PM found for: ' + (detail.name || project.name));
    // Log ALL keys for first project to understand structure
    if (Object.keys(this.pmData).length === 0) {
      console.log('[DEBUG] Full project keys:', allKeys.join(', '));
      for (var di = 0; di < Math.min(allKeys.length, 30); di++) {
        var dval = detail[allKeys[di]];
        if (dval !== null && dval !== undefined && dval !== '') {
          var dstr = JSON.stringify(dval);
          if (dstr && dstr.length < 200) {
            console.log('[DEBUG]   ' + allKeys[di] + ' = ' + dstr);
          }
        }
      }
    }
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

  this.pmData[pmId].projects.push({
    id: project.id,
    name: detail.name || project.name || 'Unnamed',
    number: detail.project_number || project.project_number || '',
    stage: detail.stage || project.stage || 'Not Set',
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
      var av = null;
      if (user.avatar && typeof user.avatar === 'string' && user.avatar.indexOf('http') === 0) av = user.avatar;
      else if (user.avatar && user.avatar.url) av = user.avatar.url;
      else if (user.avatar && user.avatar.compact) av = user.avatar.compact;
      else if (user.avatar_url) av = user.avatar_url;
      if (av && av.indexOf('default') === -1 && av.indexOf('missing') === -1) {
        this.pmData[pmId].avatar = av;
      }
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
  return Math.round(((now - s) / (e - s)) * 100);
};

PMDashboard.prototype.cleanName = function(name) {
  if (!name) return 'Unknown';
  return name.replace(/\s*\(.*\)\s*$/, '').trim();
};

PMDashboard.prototype.getInitials = function(name) {
  if (!name) return '??';
  var c = this.cleanName(name);
  var parts = c.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
  return c.substring(0,2).toUpperCase();
};

PMDashboard.prototype.getProgressColor = function(pct) {
  if (pct >= 75) return '#4CAF50';
  if (pct >= 50) return '#F47E25';
  if (pct >= 25) return '#FFC107';
  return '#F44336';
};

PMDashboard.prototype.getStatusColor = function(s) {
  var c = {'Active':'#4CAF50','Completed':'#2196F3','Not Started':'#9E9E9E','Inactive':'#F44336','Overdue':'#F44336'};
  return c[s] || '#6B7280';
};

PMDashboard.prototype.getStageIcon = function(stage) {
  var s = (stage||'').toLowerCase();
  if (s.indexOf('ejecuc')>-1||s.indexOf('construc')>-1) return 'fa-hard-hat';
  if (s.indexOf('pre')>-1||s.indexOf('dise')>-1) return 'fa-drafting-compass';
  if (s.indexOf('post')>-1||s.indexOf('cierre')>-1) return 'fa-flag-checkered';
  if (s.indexOf('warrant')>-1||s.indexOf('garant')>-1) return 'fa-shield-alt';
  return 'fa-folder-open';
};

PMDashboard.prototype.formatDate = function(d) {
  if (!d) return 'N/A';
  var dt = new Date(d);
  if (isNaN(dt.getTime())) return 'N/A';
  return dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
};

PMDashboard.prototype.sleep = function(ms) {
  return new Promise(function(r){setTimeout(r,ms);});
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
    for (var i=0;i<fills.length;i++){
      var w=fills[i].style.width;
      fills[i].style.width='0%';
      fills[i].style.transition='none';
      (function(b,ww){requestAnimationFrame(function(){b.style.transition='width 0.8s ease';b.style.width=ww;});})(fills[i],w);
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
  for (var k=0;k<keys.length;k++) pmList.push(this.pmData[keys[k]]);

  if (pmList.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-user-slash"></i><h3>No Project Managers Found</h3><p>No projects with assigned Project Managers were found. Check the browser console (F12) for debug info.</p></div>';
    return;
  }

  var totalProjects=0, activeProjects=0, totalProgress=0;
  for (var i=0;i<pmList.length;i++){
    totalProjects += pmList[i].projects.length;
    for (var j=0;j<pmList[i].projects.length;j++){
      if (pmList[i].projects[j].status==='Active') activeProjects++;
      totalProgress += pmList[i].projects[j].progressPercent;
    }
  }
  var avgProgress = totalProjects>0 ? Math.round(totalProgress/totalProjects) : 0;

  var h = '';
  h += '<div class="dashboard-summary">';
  h += '<div class="summary-card summary-total"><i class="fas fa-project-diagram"></i><div class="summary-info"><span class="summary-value">'+totalProjects+'</span><span class="summary-label">Total Projects</span></div></div>';
  h += '<div class="summary-card summary-active"><i class="fas fa-play-circle"></i><div class="summary-info"><span class="summary-value">'+activeProjects+'</span><span class="summary-label">Active</span></div></div>';
  h += '<div class="summary-card summary-pms"><i class="fas fa-users"></i><div class="summary-info"><span class="summary-value">'+pmList.length+'</span><span class="summary-label">Project Managers</span></div></div>';
  h += '<div class="summary-card summary-avg"><i class="fas fa-chart-line"></i><div class="summary-info"><span class="summary-value">'+avgProgress+'%</span><span class="summary-label">Avg. Progress</span></div></div>';
  h += '</div>';

  h += '<div class="pm-cards-container">';
  pmList.sort(function(a,b){return a.name.localeCompare(b.name);});

  for (var p=0;p<pmList.length;p++){
    var pm = pmList[p];
    var pmActive=0, pmProg=0;
    for (var q=0;q<pm.projects.length;q++){
      if (pm.projects[q].status==='Active') pmActive++;
      pmProg += pm.projects[q].progressPercent;
    }
    var pmAvg = pm.projects.length>0 ? Math.round(pmProg/pm.projects.length) : 0;
    var pmColor = this.getProgressColor(pmAvg);

    h += '<div class="pm-card" id="pm-card-'+pm.id+'">';
    h += '<div class="pm-header" onclick="dashboard.togglePMCard(\''+pm.id+'\')">';
    h += '<div class="pm-profile"><div class="pm-avatar-wrapper">';
    if (pm.avatar) {
      h += '<img src="'+pm.avatar+'" alt="'+pm.name+'" class="pm-avatar" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">';
      h += '<div class="pm-avatar-initials" style="display:none;">'+pm.initials+'</div>';
    } else {
      h += '<div class="pm-avatar-initials">'+pm.initials+'</div>';
    }
    h += '</div><div class="pm-info">';
    h += '<h3 class="pm-name">'+pm.name+'</h3>';
    if (pm.email) h += '<span class="pm-email"><i class="fas fa-envelope"></i> '+pm.email+'</span>';
    h += '<div class="pm-stats-inline">';
    h += '<span class="pm-stat-badge"><i class="fas fa-folder-open"></i> '+pm.projects.length+' project'+(pm.projects.length!==1?'s':'')+'</span>';
    h += '<span class="pm-stat-badge active"><i class="fas fa-bolt"></i> '+pmActive+' active</span>';
    h += '</div></div></div>';

    h += '<div class="pm-summary-right"><div class="pm-circular-progress">';
    h += '<svg viewBox="0 0 36 36" class="circular-progress">';
    h += '<path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>';
    h += '<path class="circle-fill" stroke="'+pmColor+'" stroke-dasharray="'+pmAvg+', 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>';
    h += '<text x="18" y="20.35" class="progress-text">'+pmAvg+'%</text>';
    h += '</svg></div>';
    h += '<i class="fas fa-chevron-down pm-toggle-icon" id="toggle-icon-'+pm.id+'"></i>';
    h += '</div></div>';

    h += '<div class="pm-projects-list" id="pm-projects-'+pm.id+'" style="display:none;">';
    h += '<div class="pm-projects-header"><span><i class="fas fa-list"></i> Assigned Projects</span>';
    h += '<span class="pm-tasks-total"><i class="fas fa-tasks"></i> '+pm.completedTasks+'/'+pm.totalTasks+' tasks</span></div>';

    pm.projects.sort(function(a,b){
      if (a.status==='Active'&&b.status!=='Active') return -1;
      if (a.status!=='Active'&&b.status==='Active') return 1;
      return b.progressPercent-a.progressPercent;
    });

    for (var r=0;r<pm.projects.length;r++){
      var proj = pm.projects[r];
      var pc = this.getProgressColor(proj.progressPercent);
      var sc = this.getStatusColor(proj.status);
      var si = this.getStageIcon(proj.stage);

      h += '<div class="project-item'+(proj.status==='Overdue'?' project-overdue':'')+'">';
      h += '<div class="project-header-row"><div class="project-name-group">';
      if (proj.number) h += '<span class="project-number">#'+proj.number+'</span>';
      h += '<span class="project-name">'+proj.name+'</span></div>';
      h += '<span class="project-status-badge" style="background:'+sc+'15;color:'+sc+';border:1px solid '+sc+'30;">'+proj.status+'</span></div>';
      h += '<div class="project-meta"><span class="project-stage"><i class="fas '+si+'"></i> '+proj.stage+'</span>';
      h += '<span class="project-tasks-count"><i class="fas fa-check-circle"></i> '+proj.completedTasks+'/'+proj.totalTasks+' tasks</span></div>';
      h += '<div class="project-dates">';
      if (proj.startDate) h += '<span class="date-tag"><i class="fas fa-play"></i> '+this.formatDate(proj.startDate)+'</span>';
      if (proj.completionDate) h += '<span class="date-tag"><i class="fas fa-flag-checkered"></i> '+this.formatDate(proj.completionDate)+'</span>';
      h += '</div>';
      h += '<div class="project-progress-bar"><div class="progress-track"><div class="progress-fill" style="width:'+proj.progressPercent+'%;background:'+pc+';"></div></div>';
      h += '<span class="progress-percent" style="color:'+pc+';">'+proj.progressPercent+'%</span></div>';
      h += '</div>';
    }

    h += '</div></div>';
  }

  h += '</div>';
  container.innerHTML = h;

  setTimeout(function(){
    var bars = document.querySelectorAll('.progress-fill');
    for (var b=0;b<bars.length;b++) bars[b].style.transition = 'width 1s ease';
  }, 50);
};

// Create global instance
dashboard = new PMDashboard();

})();
