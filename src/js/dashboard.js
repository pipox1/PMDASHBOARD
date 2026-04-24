var dashboard = null;

(function() {

function PMDashboard() {
  this.companyId = null;
  this.projects = [];
  this.pmData = {};
  this.subprojects = [];
  this.isLoading = false;
}

// ========== SUBPROJECT API ==========

PMDashboard.prototype.loadSubprojects = async function() {
  try {
    var response = await fetch('/.netlify/functions/subprojects');
    if (response.ok) {
      var data = await response.json();
      this.subprojects = data.subprojects || [];
      console.log('[Subprojects] Loaded ' + this.subprojects.length + ' subprojects');
    }
  } catch (e) {
    console.warn('[Subprojects] Could not load:', e.message);
    this.subprojects = [];
  }
};

PMDashboard.prototype.saveSubproject = async function(subData) {
  try {
    var response = await fetch('/.netlify/functions/subprojects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subData)
    });
    if (response.ok) {
      var result = await response.json();
      this.subprojects.push(result.subproject);
      console.log('[Subprojects] Created:', result.subproject.name);
      return result.subproject;
    }
  } catch (e) {
    console.error('[Subprojects] Save error:', e.message);
    alert('Error saving subproject: ' + e.message);
  }
  return null;
};

PMDashboard.prototype.updateSubproject = async function(subData) {
  try {
    var response = await fetch('/.netlify/functions/subprojects', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subData)
    });
    if (response.ok) {
      var result = await response.json();
      for (var i = 0; i < this.subprojects.length; i++) {
        if (this.subprojects[i].id === result.subproject.id) {
          this.subprojects[i] = result.subproject;
          break;
        }
      }
      console.log('[Subprojects] Updated:', result.subproject.name);
      return result.subproject;
    }
  } catch (e) {
    console.error('[Subprojects] Update error:', e.message);
    alert('Error updating subproject: ' + e.message);
  }
  return null;
};

PMDashboard.prototype.deleteSubproject = async function(subId) {
  try {
    var response = await fetch('/.netlify/functions/subprojects?id=' + subId, {
      method: 'DELETE'
    });
    if (response.ok) {
      this.subprojects = this.subprojects.filter(function(sp) { return sp.id !== subId; });
      console.log('[Subprojects] Deleted:', subId);
      return true;
    }
  } catch (e) {
    console.error('[Subprojects] Delete error:', e.message);
    alert('Error deleting subproject: ' + e.message);
  }
  return false;
};

// ========== MODAL FUNCTIONS ==========

PMDashboard.prototype.showAddSubprojectModal = function(parentProjectId, parentProjectName, pmId, pmName) {
  this.showSubprojectModal({
    mode: 'add',
    parentProjectId: parentProjectId,
    parentProjectName: parentProjectName,
    pmId: pmId,
    pmName: pmName
  });
};

PMDashboard.prototype.showEditSubprojectModal = function(subId) {
  var sub = null;
  for (var i = 0; i < this.subprojects.length; i++) {
    if (this.subprojects[i].id === subId) {
      sub = this.subprojects[i];
      break;
    }
  }
  if (!sub) return;

  this.showSubprojectModal({
    mode: 'edit',
    subproject: sub
  });
};

PMDashboard.prototype.showSubprojectModal = function(config) {
  var isEdit = config.mode === 'edit';
  var sub = config.subproject || {};

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'subproject-modal';

  var html = '';
  html += '<div class="modal-content">';

  // Header
  html += '<div class="modal-header">';
  html += '<h3><i class="fas fa-' + (isEdit ? 'edit' : 'plus-circle') + '"></i> ' + (isEdit ? 'Edit' : 'Add') + ' Subproject</h3>';
  html += '<button class="modal-close" onclick="dashboard.closeModal()"><i class="fas fa-times"></i></button>';
  html += '</div>';

  // Parent info
  var parentName = isEdit ? sub.parentProjectName : config.parentProjectName;
  html += '<div class="parent-project-info">';
  html += '<i class="fas fa-sitemap"></i> Parent Project: <strong>' + (parentName || 'Unknown') + '</strong>';
  html += '</div>';

  // Form
  html += '<form id="subproject-form" onsubmit="return false;">';

  // Row: Number + Name
  html += '<div class="form-row">';
  html += '<div class="form-group"><label>Subproject Number</label>';
  html += '<input type="text" id="sp-number" placeholder="e.g. 5988-E" value="' + (sub.number || '') + '"></div>';
  html += '<div class="form-group"><label>Stage</label>';
  html += '<select id="sp-stage">';
  var stages = ['Proyecto en Ejecucion', 'Bidding', 'Pre-Construction', 'Terminados en Periodo Garantia'];
  for (var si = 0; si < stages.length; si++) {
    var sel = (sub.stage === stages[si]) ? ' selected' : '';
    html += '<option value="' + stages[si] + '"' + sel + '>' + stages[si] + '</option>';
  }
  html += '</select></div>';
  html += '</div>';

  html += '<div class="form-group"><label>Subproject Name *</label>';
  html += '<input type="text" id="sp-name" placeholder="e.g. Wiwynn Electricidad" value="' + (sub.name || '') + '" required></div>';

  // Tasks
  html += '<div class="form-row">';
  html += '<div class="form-group"><label>Total Tasks</label>';
  html += '<input type="number" id="sp-total-tasks" placeholder="0" min="0" value="' + (sub.totalTasks || 0) + '"></div>';
  html += '<div class="form-group"><label>Completed Tasks</label>';
  html += '<input type="number" id="sp-completed-tasks" placeholder="0" min="0" value="' + (sub.completedTasks || 0) + '"></div>';
  html += '</div>';

  // Dates
  html += '<div class="form-row">';
  html += '<div class="form-group"><label>Start Date</label>';
  html += '<input type="date" id="sp-start-date" value="' + (sub.startDate || '') + '"></div>';
  html += '<div class="form-group"><label>Completion Date</label>';
  html += '<input type="date" id="sp-completion-date" value="' + (sub.completionDate || '') + '"></div>';
  html += '</div>';

  html += '</form>';

  // Actions
  html += '<div class="modal-actions">';
  html += '<button class="btn-modal-cancel" onclick="dashboard.closeModal()">Cancel</button>';

  if (isEdit) {
    html += '<button class="btn-modal-save" onclick="dashboard.handleSaveSubproject(\'edit\', \'' + sub.id + '\')"><i class="fas fa-save"></i> Save Changes</button>';
  } else {
    html += '<button class="btn-modal-save" onclick="dashboard.handleSaveSubproject(\'add\', null, \'' + config.parentProjectId + '\', \'' + this.escapeQuotes(config.parentProjectName) + '\', \'' + config.pmId + '\', \'' + this.escapeQuotes(config.pmName) + '\')"><i class="fas fa-plus"></i> Add Subproject</button>';
  }

  html += '</div>';
  html += '</div>';

  overlay.innerHTML = html;

  // Close on overlay click
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) dashboard.closeModal();
  });

  document.body.appendChild(overlay);
};

PMDashboard.prototype.closeModal = function() {
  var modal = document.getElementById('subproject-modal');
  if (modal) modal.remove();
};

PMDashboard.prototype.escapeQuotes = function(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
};

PMDashboard.prototype.handleSaveSubproject = async function(mode, subId, parentProjectId, parentProjectName, pmId, pmName) {
  var nameEl = document.getElementById('sp-name');
  var numberEl = document.getElementById('sp-number');
  var totalTasksEl = document.getElementById('sp-total-tasks');
  var completedTasksEl = document.getElementById('sp-completed-tasks');
  var stageEl = document.getElementById('sp-stage');
  var startDateEl = document.getElementById('sp-start-date');
  var completionDateEl = document.getElementById('sp-completion-date');

  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) {
    alert('Subproject name is required');
    return;
  }

  var totalTasks = totalTasksEl ? parseInt(totalTasksEl.value) || 0 : 0;
  var completedTasks = completedTasksEl ? parseInt(completedTasksEl.value) || 0 : 0;

  if (completedTasks > totalTasks) {
    alert('Completed tasks cannot be greater than total tasks');
    return;
  }

  var data = {
    name: name,
    number: numberEl ? numberEl.value.trim() : '',
    totalTasks: totalTasks,
    completedTasks: completedTasks,
    stage: stageEl ? stageEl.value : 'Proyecto en Ejecucion',
    startDate: startDateEl ? startDateEl.value : null,
    completionDate: completionDateEl ? completionDateEl.value : null
  };

  var result = null;

  if (mode === 'edit') {
    data.id = subId;
    result = await this.updateSubproject(data);
  } else {
    data.parentProjectId = parentProjectId;
    data.parentProjectName = parentProjectName || '';
    data.pmId = pmId;
    data.pmName = pmName || '';
    result = await this.saveSubproject(data);
  }

  if (result) {
    this.closeModal();
    // Re-render dashboard
    var container = document.getElementById('dashboard-content');
    if (container) this.renderDashboard(container);
  }
};

PMDashboard.prototype.handleDeleteSubproject = async function(subId, subName) {
  if (!confirm('Are you sure you want to delete subproject "' + subName + '"?')) return;

  var ok = await this.deleteSubproject(subId);
  if (ok) {
    var container = document.getElementById('dashboard-content');
    if (container) this.renderDashboard(container);
  }
};

// ========== MAIN LOAD ==========

PMDashboard.prototype.loadDashboard = async function(companyId) {
  this.companyId = companyId;
  this.pmData = {};
  this.isLoading = true;

  try {
    // Load subprojects first
    this.updateLoadingMessage('Loading saved subprojects...');
    await this.loadSubprojects();

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
    console.log('[Dashboard] Done. PMs: ' + Object.keys(this.pmData).length);
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
  } catch (e) { return; }

  var pm = this.findPM(detail, project);
  if (!pm) return;

  var pmId = pm.id;
  if (!this.pmData[pmId]) {
    this.pmData[pmId] = {
      id: pmId, name: this.cleanName(pm.name), email: '', avatar: null,
      initials: this.getInitials(pm.name), projects: [], totalTasks: 0, completedTasks: 0
    };
    await this.loadPMDetails(companyId, pmId);
  }

  var scheduleResult = await this.getProjectProgress(companyId, project.id, detail);

  var stageName = 'Not Set';
  if (detail.project_stage && detail.project_stage.name) stageName = detail.project_stage.name;
  else if (detail.stage && typeof detail.stage === 'string') stageName = detail.stage;

  var status = this.getStatus(detail, stageName);

  this.pmData[pmId].projects.push({
    id: project.id,
    name: detail.name || project.name || 'Unnamed',
    number: detail.project_number || project.project_number || '',
    stage: stageName, status: status,
    startDate: detail.start_date || null,
    completionDate: detail.completion_date || null,
    totalTasks: scheduleResult.totalTasks,
    completedTasks: scheduleResult.completedTasks,
    progressPercent: scheduleResult.progressPercent,
    progressSource: scheduleResult.source,
    pmId: pmId, pmName: this.pmData[pmId].name
  });

  this.pmData[pmId].totalTasks += scheduleResult.totalTasks;
  this.pmData[pmId].completedTasks += scheduleResult.completedTasks;
};

PMDashboard.prototype.findPM = function(detail) {
  if (detail.project_manager && detail.project_manager.id)
    return { id: detail.project_manager.id, name: detail.project_manager.name || 'Unknown' };
  if (detail.project_manager && typeof detail.project_manager === 'number')
    return { id: detail.project_manager, name: 'PM #' + detail.project_manager };
  if (detail.project_manager_id)
    return { id: detail.project_manager_id, name: 'PM #' + detail.project_manager_id };
  if (detail.custom_fields) {
    var cfKeys = Object.keys(detail.custom_fields);
    for (var ci = 0; ci < cfKeys.length; ci++) {
      var cf = detail.custom_fields[cfKeys[ci]];
      if (cf && cf.data_type === 'login_informations' && cf.value) {
        var vals = cf.value;
        if (Array.isArray(vals) && vals.length > 0 && vals[0].id)
          return { id: vals[0].id, name: vals[0].label || 'Unknown' };
        if (!Array.isArray(vals) && vals.id)
          return { id: vals.id, name: vals.label || 'Unknown' };
      }
    }
  }
  if (detail.superintendent && detail.superintendent.id)
    return { id: detail.superintendent.id, name: detail.superintendent.name || 'Unknown' };
  if (detail.created_by && detail.created_by.name) {
    var cn = detail.created_by.name.toLowerCase();
    if (cn.indexOf('barajas')>-1||cn.indexOf('mora')>-1||cn.indexOf('munoz')>-1||cn.indexOf('muñoz')>-1||cn.indexOf('gallegos')>-1)
      return { id: detail.created_by.id, name: detail.created_by.name };
  }
  return null;
};

PMDashboard.prototype.getStatus = function(project, stageName) {
  if (project.active === false) return 'Inactive';
  var s = (stageName || '').toLowerCase();
  if (s.indexOf('ejecuc')>-1||s.indexOf('construc')>-1||s.indexOf('course')>-1||s.indexOf('en proceso')>-1) return 'Active';
  if (s.indexOf('terminad')>-1||s.indexOf('garant')>-1||s.indexOf('warranty')>-1||s.indexOf('post')>-1||s.indexOf('cierre')>-1||s.indexOf('complet')>-1) return 'Completed';
  if (s.indexOf('pre')>-1||s.indexOf('dise')>-1||s.indexOf('cotiza')>-1||s.indexOf('bid')>-1||s.indexOf('plann')>-1) return 'Pre-Construction';
  return 'Active';
};

PMDashboard.prototype.getProjectProgress = async function(companyId, projectId, detail) {
  var result = { totalTasks:0, completedTasks:0, progressPercent:0, source:'none' };
  try {
    var tasks = await procoreAPI.getScheduleTasks(companyId, projectId);
    if (tasks && Array.isArray(tasks) && tasks.length > 0) {
      var wt = [];
      for (var i=0;i<tasks.length;i++) { if (tasks[i].has_children!==true && tasks[i].type!=='wbs') wt.push(tasks[i]); }
      if (wt.length===0) wt=tasks;
      result.totalTasks = wt.length;
      for (var j=0;j<wt.length;j++) {
        var pct=wt[j].percentage||wt[j].percent_complete||0;
        if(typeof pct==='string')pct=parseFloat(pct);
        var st=(wt[j].status||'').toLowerCase();
        if(pct>=100||st==='completed'||st==='complete'||wt[j].actual_finish) result.completedTasks++;
      }
      result.progressPercent = result.totalTasks>0?Math.round((result.completedTasks/result.totalTasks)*100):0;
      result.source = 'schedule';
    } else {
      result.progressPercent = this.estimateProgress(detail);
      result.source = 'dates';
    }
  } catch(e) {
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
    if (user.avatar && typeof user.avatar==='string' && user.avatar.indexOf('http')===0) av=user.avatar;
    else if (user.avatar && typeof user.avatar==='object') {
      av = user.avatar.url||user.avatar.compact||user.avatar.medium||user.avatar.large||null;
      if (!av && user.avatar.versions) av=user.avatar.versions.medium||user.avatar.versions.compact||null;
    }
    if (!av && user.avatar_url) av=user.avatar_url;
    if (av && av.indexOf('http')===0 && av.indexOf('/default')===-1 && av.indexOf('missing')===-1)
      this.pmData[pmId].avatar = procoreAPI.getProxiedImageUrl(av);
    if (user.name) { this.pmData[pmId].name=this.cleanName(user.name); this.pmData[pmId].initials=this.getInitials(user.name); }
  } catch(e) {}
};

PMDashboard.prototype.estimateProgress = function(p) {
  var now=new Date(), s=p.start_date?new Date(p.start_date):null, e=p.completion_date?new Date(p.completion_date):null;
  if(!s||!e)return 0; if(now>=e)return 100; if(now<=s)return 0;
  return Math.min(100,Math.max(0,Math.round(((now-s)/(e-s))*100)));
};

PMDashboard.prototype.cleanName = function(n) { return n ? n.replace(/\s*\(.*\)\s*$/,'').trim() : 'Unknown'; };
PMDashboard.prototype.getInitials = function(n) { if(!n)return'??'; var c=this.cleanName(n),p=c.split(/\s+/); return p.length>=2?(p[0][0]+p[p.length-1][0]).toUpperCase():c.substring(0,2).toUpperCase(); };
PMDashboard.prototype.getProgressColor = function(p) { return p>=75?'#4CAF50':p>=50?'#F47E25':p>=25?'#FFC107':'#F44336'; };
PMDashboard.prototype.getStatusColor = function(s) { return {'Active':'#4CAF50','Completed':'#2196F3','Not Started':'#9E9E9E','Inactive':'#F44336','Pre-Construction':'#9C27B0'}[s]||'#6B7280'; };
PMDashboard.prototype.getStageIcon = function(s) { s=(s||'').toLowerCase(); if(s.indexOf('ejecuc')>-1||s.indexOf('construc')>-1)return'fa-hard-hat'; if(s.indexOf('pre')>-1||s.indexOf('dise')>-1)return'fa-drafting-compass'; if(s.indexOf('terminad')>-1||s.indexOf('garant')>-1)return'fa-shield-alt'; if(s.indexOf('bid')>-1||s.indexOf('cotiza')>-1)return'fa-file-invoice-dollar'; return'fa-folder-open'; };
PMDashboard.prototype.formatDate = function(d) { if(!d)return'N/A'; var dt=new Date(d); return isNaN(dt.getTime())?'N/A':dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); };
PMDashboard.prototype.sleep = function(ms) { return new Promise(function(r){setTimeout(r,ms);}); };
PMDashboard.prototype.updateLoadingMessage = function(m) { var e=document.getElementById('loading-message'); if(e)e.innerHTML=m; };

PMDashboard.prototype.togglePMCard = function(pmId) {
  var l=document.getElementById('pm-projects-'+pmId), ic=document.getElementById('toggle-icon-'+pmId), c=document.getElementById('pm-card-'+pmId);
  if(!l||!ic)return;
  if(l.style.display==='none'){l.style.display='block';ic.classList.remove('fa-chevron-down');ic.classList.add('fa-chevron-up');if(c)c.classList.add('pm-card-expanded');
    var f=l.querySelectorAll('.progress-fill');for(var i=0;i<f.length;i++){var w=f[i].style.width;f[i].style.width='0%';f[i].style.transition='none';(function(b,ww){requestAnimationFrame(function(){b.style.transition='width 0.8s ease';b.style.width=ww;});})(f[i],w);}
  }else{l.style.display='none';ic.classList.remove('fa-chevron-up');ic.classList.add('fa-chevron-down');if(c)c.classList.remove('pm-card-expanded');}
};

// ========== RENDER ==========

PMDashboard.prototype.renderDashboard = function(container) {
  var self = this;
  var pmList = [];
  var keys = Object.keys(this.pmData);
  for (var k=0;k<keys.length;k++) pmList.push(this.pmData[keys[k]]);

  if (pmList.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-user-slash"></i><h3>No Project Managers Found</h3></div>';
    return;
  }

  // Get subprojects grouped by PM
  var subsByPm = {};
  var subsByProject = {};
  for (var si = 0; si < this.subprojects.length; si++) {
    var sp = this.subprojects[si];
    var spPmId = String(sp.pmId);
    if (!subsByPm[spPmId]) subsByPm[spPmId] = [];
    subsByPm[spPmId].push(sp);
    var spParent = String(sp.parentProjectId);
    if (!subsByProject[spParent]) subsByProject[spParent] = [];
    subsByProject[spParent].push(sp);
  }

  // Calculate totals including subprojects
  var totalProjects=0, activeProjects=0, totalProgress=0, totalItems=0;
  for (var i=0;i<pmList.length;i++){
    var pmSubs = subsByPm[String(pmList[i].id)] || [];
    totalProjects += pmList[i].projects.length + pmSubs.length;
    totalItems += pmList[i].projects.length + pmSubs.length;
    for (var j=0;j<pmList[i].projects.length;j++){
      if(pmList[i].projects[j].status==='Active') activeProjects++;
      totalProgress += pmList[i].projects[j].progressPercent;
    }
    for (var sj=0;sj<pmSubs.length;sj++){
      var spStatus = this.getStatus({active:true}, pmSubs[sj].stage);
      if(spStatus==='Active') activeProjects++;
      var spProg = pmSubs[sj].totalTasks>0 ? Math.round((pmSubs[sj].completedTasks/pmSubs[sj].totalTasks)*100) : 0;
      totalProgress += spProg;
    }
  }
  var avgProgress = totalItems>0 ? Math.round(totalProgress/totalItems) : 0;

  var h = '';

  // Summary
  h += '<div class="dashboard-summary">';
  h += '<div class="summary-card summary-total"><i class="fas fa-project-diagram"></i><div class="summary-info"><span class="summary-value">'+totalProjects+'</span><span class="summary-label">Total Projects</span></div></div>';
  h += '<div class="summary-card summary-active"><i class="fas fa-play-circle"></i><div class="summary-info"><span class="summary-value">'+activeProjects+'</span><span class="summary-label">Active</span></div></div>';
  h += '<div class="summary-card summary-pms"><i class="fas fa-users"></i><div class="summary-info"><span class="summary-value">'+pmList.length+'</span><span class="summary-label">Project Managers</span></div></div>';
  h += '<div class="summary-card summary-avg"><i class="fas fa-chart-line"></i><div class="summary-info"><span class="summary-value">'+avgProgress+'%</span>';
  h += '<span class="summary-label">Avg. Progress <span class="info-tooltip-wrapper"><span class="info-icon"><i class="fas fa-question"></i></span>';
  h += '<span class="info-tooltip">Average progress across all projects and subprojects. Based on schedule tasks where available, or estimated from dates.</span></span></span></div></div>';
  h += '</div>';

  // PM Cards
  h += '<div class="pm-cards-container">';
  pmList.sort(function(a,b){return a.name.localeCompare(b.name);});

  for (var p=0;p<pmList.length;p++){
    var pm = pmList[p];
    var pmSubs = subsByPm[String(pm.id)] || [];
    var pmActive=0, pmProg=0, pmTotalItems = pm.projects.length + pmSubs.length;

    for (var q=0;q<pm.projects.length;q++){
      if(pm.projects[q].status==='Active') pmActive++;
      pmProg += pm.projects[q].progressPercent;
    }
    for (var sq=0;sq<pmSubs.length;sq++){
      var sqStatus = this.getStatus({active:true}, pmSubs[sq].stage);
      if(sqStatus==='Active') pmActive++;
      pmProg += pmSubs[sq].totalTasks>0 ? Math.round((pmSubs[sq].completedTasks/pmSubs[sq].totalTasks)*100) : 0;
    }

    var pmAvg = pmTotalItems>0 ? Math.round(pmProg/pmTotalItems) : 0;
    var pmColor = this.getProgressColor(pmAvg);
    var pmTotalTasks = pm.totalTasks;
    var pmCompTasks = pm.completedTasks;
    for (var st=0;st<pmSubs.length;st++){ pmTotalTasks+=pmSubs[st].totalTasks; pmCompTasks+=pmSubs[st].completedTasks; }

    // PM Card
    h += '<div class="pm-card" id="pm-card-'+pm.id+'">';
    h += '<div class="pm-header" onclick="dashboard.togglePMCard(\''+pm.id+'\')">';
    h += '<div class="pm-profile"><div class="pm-avatar-wrapper">';
    if(pm.avatar){
      h+='<img src="'+pm.avatar+'" alt="'+pm.name+'" class="pm-avatar" crossorigin="anonymous" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">';
      h+='<div class="pm-avatar-initials" style="display:none;">'+pm.initials+'</div>';
    } else { h+='<div class="pm-avatar-initials">'+pm.initials+'</div>'; }
    h += '</div><div class="pm-info"><h3 class="pm-name">'+pm.name+'</h3>';
    if(pm.email) h+='<span class="pm-email"><i class="fas fa-envelope"></i> '+pm.email+'</span>';
    h += '<div class="pm-stats-inline">';
    h += '<span class="pm-stat-badge"><i class="fas fa-folder-open"></i> '+pmTotalItems+' project'+(pmTotalItems!==1?'s':'')+'</span>';
    h += '<span class="pm-stat-badge active"><i class="fas fa-bolt"></i> '+pmActive+' active</span>';
    h += '</div></div></div>';

    h += '<div class="pm-summary-right"><div class="pm-circular-progress"><svg viewBox="0 0 36 36" class="circular-progress">';
    h += '<path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>';
    h += '<path class="circle-fill" stroke="'+pmColor+'" stroke-dasharray="'+pmAvg+', 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>';
    h += '<text x="18" y="20.35" class="progress-text">'+pmAvg+'%</text></svg></div>';
    h += '<i class="fas fa-chevron-down pm-toggle-icon" id="toggle-icon-'+pm.id+'"></i></div></div>';

    // Projects List
    h += '<div class="pm-projects-list" id="pm-projects-'+pm.id+'" style="display:none;">';
    h += '<div class="pm-projects-header"><span><i class="fas fa-list"></i> Assigned Projects</span>';
    h += '<span class="pm-tasks-total"><i class="fas fa-tasks"></i> '+pmCompTasks+'/'+pmTotalTasks+' total tasks</span></div>';

    pm.projects.sort(function(a,b){
      if(a.status==='Active'&&b.status!=='Active')return-1;
      if(a.status!=='Active'&&b.status==='Active')return 1;
      return b.progressPercent-a.progressPercent;
    });

    for (var r=0;r<pm.projects.length;r++){
      var proj = pm.projects[r];
      var pColor = this.getProgressColor(proj.progressPercent);
      var sColor = this.getStatusColor(proj.status);
      var sIcon = this.getStageIcon(proj.stage);
      var srcLabel = proj.progressSource==='schedule'?'':' (est.)';
      var projSubs = subsByProject[String(proj.id)] || [];

      h += '<div class="project-item">';
      h += '<div class="project-header-row"><div class="project-name-group">';
      if(proj.number) h+='<span class="project-number">#'+proj.number+'</span>';
      h += '<span class="project-name">'+proj.name+'</span></div>';
      h += '<span class="project-status-badge" style="background:'+sColor+'15;color:'+sColor+';border:1px solid '+sColor+'30;">'+proj.status+'</span></div>';

      h += '<div class="project-meta"><span class="project-stage"><i class="fas '+sIcon+'"></i> '+proj.stage+'</span>';
      if(proj.progressSource==='schedule') h+='<span class="project-tasks-count"><i class="fas fa-check-circle"></i> '+proj.completedTasks+'/'+proj.totalTasks+' tasks</span>';
      else h+='<span class="project-tasks-count"><i class="fas fa-calendar-alt"></i> No schedule data</span>';
      h += '</div>';

      h += '<div class="project-dates">';
      if(proj.startDate) h+='<span class="date-tag"><i class="fas fa-play"></i> '+this.formatDate(proj.startDate)+'</span>';
      if(proj.completionDate) h+='<span class="date-tag"><i class="fas fa-flag-checkered"></i> '+this.formatDate(proj.completionDate)+'</span>';
      h += '</div>';

      h += '<div class="project-progress-bar"><div class="progress-track"><div class="progress-fill" style="width:'+proj.progressPercent+'%;background:'+pColor+';"></div></div>';
      h += '<span class="progress-percent" style="color:'+pColor+';">'+proj.progressPercent+'%'+srcLabel+'</span></div>';

      // Add Subproject button
      h += '<button class="btn-add-subproject" onclick="event.stopPropagation(); dashboard.showAddSubprojectModal(\''+proj.id+'\', \''+this.escapeQuotes(proj.name)+'\', \''+pm.id+'\', \''+this.escapeQuotes(pm.name)+'\')">';
      h += '<i class="fas fa-plus"></i> Add Subproject</button>';

      h += '</div>'; // end project-item

      // Render subprojects for this project
      for (var sub=0;sub<projSubs.length;sub++){
        var sp = projSubs[sub];
        var spProg = sp.totalTasks>0 ? Math.round((sp.completedTasks/sp.totalTasks)*100) : 0;
        var spColor = this.getProgressColor(spProg);
        var spStatus = this.getStatus({active:true}, sp.stage);
        var spSColor = this.getStatusColor(spStatus);
        var spSIcon = this.getStageIcon(sp.stage);

        h += '<div class="subproject-item">';
        h += '<div class="project-header-row"><div class="project-name-group">';
        if(sp.number) h+='<span class="project-number">#'+sp.number+'</span>';
        h += '<span class="project-name">'+sp.name+'<span class="subproject-badge">Subproject</span></span></div>';
        h += '<span class="project-status-badge" style="background:'+spSColor+'15;color:'+spSColor+';border:1px solid '+spSColor+'30;">'+spStatus+'</span></div>';

        h += '<div class="project-meta"><span class="project-stage"><i class="fas '+spSIcon+'"></i> '+sp.stage+'</span>';
        h += '<span class="project-tasks-count"><i class="fas fa-check-circle"></i> '+sp.completedTasks+'/'+sp.totalTasks+' tasks</span></div>';

        h += '<div class="project-dates">';
        if(sp.startDate) h+='<span class="date-tag"><i class="fas fa-play"></i> '+this.formatDate(sp.startDate)+'</span>';
        if(sp.completionDate) h+='<span class="date-tag"><i class="fas fa-flag-checkered"></i> '+this.formatDate(sp.completionDate)+'</span>';
        h += '</div>';

        h += '<div class="project-progress-bar"><div class="progress-track"><div class="progress-fill" style="width:'+spProg+'%;background:'+spColor+';"></div></div>';
        h += '<span class="progress-percent" style="color:'+spColor+';">'+spProg+'%</span></div>';

        h += '<div class="subproject-actions">';
        h += '<button class="btn-sub-action btn-sub-edit" onclick="event.stopPropagation(); dashboard.showEditSubprojectModal(\''+sp.id+'\')"><i class="fas fa-edit"></i> Edit</button>';
        h += '<button class="btn-sub-action btn-sub-delete" onclick="event.stopPropagation(); dashboard.handleDeleteSubproject(\''+sp.id+'\', \''+this.escapeQuotes(sp.name)+'\')"><i class="fas fa-trash"></i> Delete</button>';
        h += '</div>';

        h += '</div>'; // end subproject-item
      }
    }

    h += '</div></div>'; // end pm-projects-list, pm-card
  }

  h += '</div>';
  container.innerHTML = h;

  setTimeout(function(){ var b=document.querySelectorAll('.progress-fill'); for(var i=0;i<b.length;i++) b[i].style.transition='width 1s ease'; }, 100);
};

dashboard = new PMDashboard();
console.log('[Dashboard] Module loaded with subprojects support.');

})();
