var dashboard = null;

(function() {

var _modalPendingData = {};
var _containerListenerAttached = false;

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
    } else {
      console.warn('[Subprojects] Load failed:', response.status);
      this.subprojects = [];
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
      return result.subproject;
    } else {
      var errText = await response.text();
      console.error('[Subprojects] Save failed:', errText);
      alert('Error saving: ' + errText);
    }
  } catch (e) { alert('Error: ' + e.message); }
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
        if (this.subprojects[i].id === result.subproject.id) { this.subprojects[i] = result.subproject; break; }
      }
      return result.subproject;
    } else {
      var errText = await response.text();
      alert('Error updating: ' + errText);
    }
  } catch (e) { alert('Error: ' + e.message); }
  return null;
};

PMDashboard.prototype.deleteSubproject = async function(subId) {
  try {
    var response = await fetch('/.netlify/functions/subprojects?id=' + encodeURIComponent(subId), { method: 'DELETE' });
    if (response.ok) {
      this.subprojects = this.subprojects.filter(function(sp) { return sp.id !== subId; });
      return true;
    }
  } catch (e) { alert('Error: ' + e.message); }
  return false;
};

// ========== MODAL ==========

PMDashboard.prototype.openAddSubprojectModal = function(dataKey) {
  var info = _modalPendingData[dataKey];
  if (!info) return;
  this.showSubprojectModal({ mode: 'add', parentProjectId: info.parentProjectId, parentProjectName: info.parentProjectName, pmId: info.pmId, pmName: info.pmName });
};

PMDashboard.prototype.openEditSubprojectModal = function(subId) {
  var sub = null;
  for (var i = 0; i < this.subprojects.length; i++) {
    if (this.subprojects[i].id === subId) { sub = this.subprojects[i]; break; }
  }
  if (!sub) return;
  this.showSubprojectModal({ mode: 'edit', subproject: sub });
};

PMDashboard.prototype.openDeleteSubproject = function(subId) {
  var sub = null;
  for (var i = 0; i < this.subprojects.length; i++) {
    if (this.subprojects[i].id === subId) { sub = this.subprojects[i]; break; }
  }
  if (!sub) return;
  if (!confirm('Delete subproject "' + sub.name + '"?')) return;
  var self = this;
  this.deleteSubproject(subId).then(function(ok) {
    if (ok) { var c = document.getElementById('dashboard-content'); if (c) self.renderDashboard(c); }
  });
};

PMDashboard.prototype.toggleSubprojects = function(projectId) {
  var container = document.getElementById('subs-container-' + projectId);
  var icon = document.getElementById('subs-icon-' + projectId);
  if (!container || !icon) return;
  if (container.classList.contains('collapsed')) {
    container.classList.remove('collapsed');
    container.style.maxHeight = container.scrollHeight + 'px';
    icon.classList.add('expanded');
  } else {
    container.classList.add('collapsed');
    container.style.maxHeight = '0';
    icon.classList.remove('expanded');
  }
};

PMDashboard.prototype.showSubprojectModal = function(config) {
  var self = this;
  var isEdit = config.mode === 'edit';
  var sub = config.subproject || {};
  this.closeModal();

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'subproject-modal';

  var content = document.createElement('div');
  content.className = 'modal-content';

  var parentName = isEdit ? (sub.parentProjectName || 'Unknown') : (config.parentProjectName || 'Unknown');

  var html = '';
  html += '<div class="modal-header"><h3><i class="fas fa-' + (isEdit ? 'edit' : 'plus-circle') + '"></i> ' + (isEdit ? 'Edit' : 'Add') + ' Subproject</h3>';
  html += '<button class="modal-close" id="modal-close-btn"><i class="fas fa-times"></i></button></div>';
  html += '<div class="parent-project-info"><i class="fas fa-sitemap"></i> Parent: <strong>' + parentName + '</strong></div>';
  html += '<form id="subproject-form">';
  html += '<div class="form-row"><div class="form-group"><label>Number</label><input type="text" id="sp-number" placeholder="e.g. 5988-E" value="' + (sub.number || '') + '"></div>';
  html += '<div class="form-group"><label>Stage</label><select id="sp-stage">';
  var stages = ['Proyecto en Ejecucion', 'Bidding', 'Pre-Construction', 'Terminados en Periodo Garantia'];
  for (var si = 0; si < stages.length; si++) {
    html += '<option value="' + stages[si] + '"' + (sub.stage === stages[si] ? ' selected' : '') + '>' + stages[si] + '</option>';
  }
  html += '</select></div></div>';
  html += '<div class="form-group"><label>Name *</label><input type="text" id="sp-name" placeholder="e.g. Wiwynn Electricidad" value="' + (sub.name || '') + '" required></div>';
  html += '<div class="form-row"><div class="form-group"><label>Total Tasks</label><input type="number" id="sp-total-tasks" min="0" value="' + (sub.totalTasks || 0) + '"></div>';
  html += '<div class="form-group"><label>Completed Tasks</label><input type="number" id="sp-completed-tasks" min="0" value="' + (sub.completedTasks || 0) + '"></div></div>';
  html += '<div class="form-row"><div class="form-group"><label>Start Date</label><input type="date" id="sp-start-date" value="' + (sub.startDate || '') + '"></div>';
  html += '<div class="form-group"><label>Completion Date</label><input type="date" id="sp-completion-date" value="' + (sub.completionDate || '') + '"></div></div>';
  html += '</form>';
  html += '<div class="modal-actions"><button class="btn-modal-cancel" id="modal-cancel-btn">Cancel</button>';
  html += '<button class="btn-modal-save" id="modal-save-btn"><i class="fas fa-' + (isEdit ? 'save' : 'plus') + '"></i> ' + (isEdit ? 'Save' : 'Add Subproject') + '</button></div>';

  content.innerHTML = html;
  overlay.appendChild(content);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) self.closeModal(); });
  document.body.appendChild(overlay);

  document.getElementById('modal-close-btn').addEventListener('click', function() { self.closeModal(); });
  document.getElementById('modal-cancel-btn').addEventListener('click', function() { self.closeModal(); });
  document.getElementById('modal-save-btn').addEventListener('click', function() {
    self.handleSaveFromModal(isEdit, isEdit ? sub.id : null, config);
  });
};

PMDashboard.prototype.closeModal = function() {
  var m = document.getElementById('subproject-modal');
  if (m) m.remove();
};

PMDashboard.prototype.handleSaveFromModal = async function(isEdit, subId, config) {
  var name = (document.getElementById('sp-name') || {}).value || '';
  if (!name.trim()) { alert('Name is required'); return; }
  var totalTasks = parseInt((document.getElementById('sp-total-tasks') || {}).value) || 0;
  var completedTasks = parseInt((document.getElementById('sp-completed-tasks') || {}).value) || 0;
  if (completedTasks > totalTasks) { alert('Completed cannot exceed total tasks'); return; }

  var btn = document.getElementById('modal-save-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

  var data = {
    name: name.trim(),
    number: ((document.getElementById('sp-number') || {}).value || '').trim(),
    totalTasks: totalTasks, completedTasks: completedTasks,
    stage: (document.getElementById('sp-stage') || {}).value || 'Proyecto en Ejecucion',
    startDate: (document.getElementById('sp-start-date') || {}).value || null,
    completionDate: (document.getElementById('sp-completion-date') || {}).value || null
  };

  var result;
  if (isEdit) {
    data.id = subId;
    result = await this.updateSubproject(data);
  } else {
    data.parentProjectId = config.parentProjectId;
    data.parentProjectName = config.parentProjectName || '';
    data.pmId = config.pmId;
    data.pmName = config.pmName || '';
    result = await this.saveSubproject(data);
  }

  if (result) {
    this.closeModal();
    var c = document.getElementById('dashboard-content');
    if (c) this.renderDashboard(c);
  } else if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-' + (isEdit ? 'save' : 'plus') + '"></i> ' + (isEdit ? 'Save' : 'Add Subproject');
  }
};

// ========== LOAD ==========

PMDashboard.prototype.loadDashboard = async function(companyId) {
  this.companyId = companyId;
  this.pmData = {};
  this.isLoading = true;
  try {
    this.updateLoadingMessage('Loading saved subprojects...');
    await this.loadSubprojects();
    this.updateLoadingMessage('Loading projects...');
    var allProjects = await procoreAPI.getProjects(companyId);
    this.projects = allProjects;
    console.log('[Dashboard] Found ' + this.projects.length + ' total projects');

    for (var i = 0; i < this.projects.length; i++) {
      this.updateLoadingMessage('Analyzing project ' + (i+1) + '/' + this.projects.length + ':<br><strong>' + (this.projects[i].name || 'Unknown') + '</strong>');
      try { await this.processProject(this.projects[i], companyId); } catch (err) { console.warn('[Dashboard] Error:', err.message); }
      if ((i+1) % 2 === 0) await this.sleep(500);
    }
    this.isLoading = false;
    console.log('[Dashboard] Done. PMs: ' + Object.keys(this.pmData).length);
    return this.pmData;
  } catch (error) { this.isLoading = false; throw error; }
};

PMDashboard.prototype.processProject = async function(project, companyId) {
  var detail;
  try { detail = await procoreAPI.getProjectDetail(companyId, project.id); } catch (e) { return; }

  // FILTER: Skip Bidding and Pre-Construction projects
  var stageName = 'Not Set';
  if (detail.project_stage && detail.project_stage.name) stageName = detail.project_stage.name;
  else if (detail.stage && typeof detail.stage === 'string') stageName = detail.stage;

  var stageLower = stageName.toLowerCase();
  if (stageLower.indexOf('bid') > -1 || stageLower.indexOf('cotiza') > -1 ||
      stageLower.indexOf('pre') > -1 || stageLower.indexOf('dise') > -1 ||
      stageLower.indexOf('plann') > -1) {
    console.log('[Dashboard] Skipping Bidding/Pre-Construction project: ' + (detail.name || project.name));
    return;
  }

  var pm = this.findPM(detail);
  if (!pm) return;
  var pmId = pm.id;
  if (!this.pmData[pmId]) {
    this.pmData[pmId] = { id: pmId, name: this.cleanName(pm.name), email: '', avatar: null, initials: this.getInitials(pm.name), projects: [], totalTasks: 0, completedTasks: 0 };
    await this.loadPMDetails(companyId, pmId);
  }
  var sched = await this.getProjectProgress(companyId, project.id, detail);
  var status = this.getStatus(detail, stageName);
  this.pmData[pmId].projects.push({
    id: project.id, name: detail.name || project.name || 'Unnamed', number: detail.project_number || project.project_number || '',
    stage: stageName, status: status, startDate: detail.start_date || null, completionDate: detail.completion_date || null,
    totalTasks: sched.totalTasks, completedTasks: sched.completedTasks, progressPercent: sched.progressPercent, progressSource: sched.source,
    pmId: pmId, pmName: this.pmData[pmId].name
  });
  this.pmData[pmId].totalTasks += sched.totalTasks;
  this.pmData[pmId].completedTasks += sched.completedTasks;
};

PMDashboard.prototype.findPM = function(detail) {
  if (detail.project_manager && detail.project_manager.id) return { id: detail.project_manager.id, name: detail.project_manager.name || 'Unknown' };
  if (detail.project_manager && typeof detail.project_manager === 'number') return { id: detail.project_manager, name: 'PM #' + detail.project_manager };
  if (detail.project_manager_id) return { id: detail.project_manager_id, name: 'PM #' + detail.project_manager_id };
  if (detail.custom_fields) {
    var cfKeys = Object.keys(detail.custom_fields);
    for (var ci = 0; ci < cfKeys.length; ci++) {
      var cf = detail.custom_fields[cfKeys[ci]];
      if (cf && cf.data_type === 'login_informations' && cf.value) {
        var vals = cf.value;
        if (Array.isArray(vals) && vals.length > 0 && vals[0].id) return { id: vals[0].id, name: vals[0].label || 'Unknown' };
        if (!Array.isArray(vals) && vals.id) return { id: vals.id, name: vals.label || 'Unknown' };
      }
    }
  }
  if (detail.superintendent && detail.superintendent.id) return { id: detail.superintendent.id, name: detail.superintendent.name || 'Unknown' };
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
        var pct=wt[j].percentage||wt[j].percent_complete||0; if(typeof pct==='string')pct=parseFloat(pct);
        var st=(wt[j].status||'').toLowerCase();
        if(pct>=100||st==='completed'||st==='complete'||wt[j].actual_finish) result.completedTasks++;
      }
      result.progressPercent = result.totalTasks>0?Math.round((result.completedTasks/result.totalTasks)*100):0;
      result.source = 'schedule';
    } else { result.progressPercent = this.estimateProgress(detail); result.source = 'dates'; }
  } catch(e) { result.progressPercent = this.estimateProgress(detail); result.source = 'dates'; }
  return result;
};

PMDashboard.prototype.loadPMDetails = async function(companyId, pmId) {
  try {
    var user = await procoreAPI.getUser(companyId, pmId);
    if (!user) return;
    this.pmData[pmId].email = user.email_address || user.email || '';
    var av = null;
    if (user.avatar && typeof user.avatar==='string' && user.avatar.indexOf('http')===0) av=user.avatar;
    else if (user.avatar && typeof user.avatar==='object') { av = user.avatar.url||user.avatar.compact||user.avatar.medium||user.avatar.large||null; if (!av && user.avatar.versions) av=user.avatar.versions.medium||user.avatar.versions.compact||null; }
    if (!av && user.avatar_url) av=user.avatar_url;
    if (av && av.indexOf('http')===0 && av.indexOf('/default')===-1 && av.indexOf('missing')===-1) this.pmData[pmId].avatar = procoreAPI.getProxiedImageUrl(av);
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

// ========== HELPER: Get grouped subprojects ==========
PMDashboard.prototype.getSubprojectGroups = function() {
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
  return { byPm: subsByPm, byProject: subsByProject };
};

// ========== RENDER ==========

PMDashboard.prototype.renderDashboard = function(container) {
  var self = this;
  _modalPendingData = {};

  var pmList = [];
  var keys = Object.keys(this.pmData);
  for (var k=0;k<keys.length;k++) pmList.push(this.pmData[keys[k]]);

  if (pmList.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-user-slash"></i><h3>No Project Managers Found</h3></div>';
    return;
  }

  var groups = this.getSubprojectGroups();
  var subsByPm = groups.byPm;
  var subsByProject = groups.byProject;

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
      if(this.getStatus({active:true}, pmSubs[sj].stage)==='Active') activeProjects++;
      totalProgress += pmSubs[sj].totalTasks>0 ? Math.round((pmSubs[sj].completedTasks/pmSubs[sj].totalTasks)*100) : 0;
    }
  }
  var avgProgress = totalItems>0 ? Math.round(totalProgress/totalItems) : 0;

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
    var pmSubs = subsByPm[String(pm.id)] || [];
    var pmActive=0, pmProg=0, pmTotalItems = pm.projects.length + pmSubs.length;

    for (var q=0;q<pm.projects.length;q++){
      if(pm.projects[q].status==='Active') pmActive++;
      pmProg += pm.projects[q].progressPercent;
    }
    for (var sq=0;sq<pmSubs.length;sq++){
      if(this.getStatus({active:true}, pmSubs[sq].stage)==='Active') pmActive++;
      pmProg += pmSubs[sq].totalTasks>0 ? Math.round((pmSubs[sq].completedTasks/pmSubs[sq].totalTasks)*100) : 0;
    }

    var pmAvg = pmTotalItems>0 ? Math.round(pmProg/pmTotalItems) : 0;
    var pmColor = this.getProgressColor(pmAvg);
    var pmTotalTasks = pm.totalTasks;
    var pmCompTasks = pm.completedTasks;
    for (var st=0;st<pmSubs.length;st++){ pmTotalTasks+=pmSubs[st].totalTasks; pmCompTasks+=pmSubs[st].completedTasks; }

    h += '<div class="pm-card" id="pm-card-'+pm.id+'">';
    h += '<div class="pm-header" onclick="dashboard.togglePMCard(\''+pm.id+'\')">';
    h += '<div class="pm-profile"><div class="pm-avatar-wrapper">';
    if(pm.avatar){
      h+='<img src="'+pm.avatar+'" alt="" class="pm-avatar" crossorigin="anonymous" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">';
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

      var modalKey = 'mk_' + proj.id;
      _modalPendingData[modalKey] = { parentProjectId: String(proj.id), parentProjectName: proj.name, pmId: String(pm.id), pmName: pm.name };

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

      h += '<button class="btn-add-subproject" data-modal-key="'+modalKey+'">';
      h += '<i class="fas fa-plus"></i> Add Subproject</button>';

      h += '</div>';

      // Subprojects toggle + container
      if (projSubs.length > 0) {
        h += '<div class="subprojects-toggle-row" data-toggle-proj="'+proj.id+'">';
        h += '<div class="subprojects-toggle-icon" id="subs-icon-'+proj.id+'"><i class="fas fa-plus"></i></div>';
        h += '<span class="subprojects-toggle-label">Subprojects</span>';
        h += '<span class="subprojects-toggle-count">'+projSubs.length+'</span>';
        h += '</div>';

        h += '<div class="subprojects-container collapsed" id="subs-container-'+proj.id+'" style="max-height:0;">';

        for (var sub=0;sub<projSubs.length;sub++){
          var spd = projSubs[sub];
          var spProg = spd.totalTasks>0 ? Math.round((spd.completedTasks/spd.totalTasks)*100) : 0;
          var spColor = this.getProgressColor(spProg);
          var spStatus = this.getStatus({active:true}, spd.stage);
          var spSColor = this.getStatusColor(spStatus);
          var spSIcon = this.getStageIcon(spd.stage);

          h += '<div class="subproject-item">';
          h += '<div class="project-header-row"><div class="project-name-group">';
          if(spd.number) h+='<span class="project-number">#'+spd.number+'</span>';
          h += '<span class="project-name">'+spd.name+'<span class="subproject-badge">Sub</span></span></div>';
          h += '<span class="project-status-badge" style="background:'+spSColor+'15;color:'+spSColor+';border:1px solid '+spSColor+'30;">'+spStatus+'</span></div>';

          h += '<div class="project-meta"><span class="project-stage"><i class="fas '+spSIcon+'"></i> '+spd.stage+'</span>';
          h += '<span class="project-tasks-count"><i class="fas fa-check-circle"></i> '+spd.completedTasks+'/'+spd.totalTasks+' tasks</span></div>';

          h += '<div class="project-dates">';
          if(spd.startDate) h+='<span class="date-tag"><i class="fas fa-play"></i> '+this.formatDate(spd.startDate)+'</span>';
          if(spd.completionDate) h+='<span class="date-tag"><i class="fas fa-flag-checkered"></i> '+this.formatDate(spd.completionDate)+'</span>';
          h += '</div>';

          h += '<div class="project-progress-bar"><div class="progress-track"><div class="progress-fill" style="width:'+spProg+'%;background:'+spColor+';"></div></div>';
          h += '<span class="progress-percent" style="color:'+spColor+';">'+spProg+'%</span></div>';

          h += '<div class="subproject-actions">';
          h += '<button class="btn-sub-action btn-sub-edit" data-sub-edit="'+spd.id+'"><i class="fas fa-edit"></i> Edit</button>';
          h += '<button class="btn-sub-action btn-sub-delete" data-sub-delete="'+spd.id+'"><i class="fas fa-trash"></i> Delete</button>';
          h += '</div>';
          h += '</div>';
        }
        h += '</div>';
      }
    }
    h += '</div></div>';
  }
  h += '</div>';
  container.innerHTML = h;

  // FIX: Remove old listener, attach new one
  var newContainer = container.cloneNode(false);
  newContainer.innerHTML = container.innerHTML;
  container.parentNode.replaceChild(newContainer, container);

  newContainer.addEventListener('click', function(e) {
    var addBtn = e.target.closest('.btn-add-subproject');
    if (addBtn) { e.stopPropagation(); var key = addBtn.getAttribute('data-modal-key'); if (key) self.openAddSubprojectModal(key); return; }

    var editBtn = e.target.closest('.btn-sub-edit');
    if (editBtn) { e.stopPropagation(); self.openEditSubprojectModal(editBtn.getAttribute('data-sub-edit')); return; }

    var delBtn = e.target.closest('.btn-sub-delete');
    if (delBtn) { e.stopPropagation(); self.openDeleteSubproject(delBtn.getAttribute('data-sub-delete')); return; }

    var toggleRow = e.target.closest('.subprojects-toggle-row');
    if (toggleRow) { e.stopPropagation(); var projId = toggleRow.getAttribute('data-toggle-proj'); if (projId) self.toggleSubprojects(projId); return; }
  });

  setTimeout(function(){ var b=newContainer.querySelectorAll('.progress-fill'); for(var i=0;i<b.length;i++) b[i].style.transition='width 1s ease'; }, 100);
};

// ========== PDF EXPORT ==========

PMDashboard.prototype.generatePDFData = function() {
  var pmList = [];
  var keys = Object.keys(this.pmData);
  for (var k=0;k<keys.length;k++) pmList.push(this.pmData[keys[k]]);
  pmList.sort(function(a,b){return a.name.localeCompare(b.name);});

  var groups = this.getSubprojectGroups();
  var subsByPm = groups.byPm;
  var subsByProject = groups.byProject;

  var pdfData = [];
  for (var i=0;i<pmList.length;i++){
    var pm = pmList[i];
    var pmSubs = subsByPm[String(pm.id)] || [];
    var pmTotalItems = pm.projects.length + pmSubs.length;
    var pmActive = 0;
    var pmProg = 0;
    var pmTotalTasks = pm.totalTasks;
    var pmCompTasks = pm.completedTasks;

    for (var q=0;q<pm.projects.length;q++){
      if(pm.projects[q].status==='Active') pmActive++;
      pmProg += pm.projects[q].progressPercent;
    }
    for (var sq=0;sq<pmSubs.length;sq++){
      if(this.getStatus({active:true}, pmSubs[sq].stage)==='Active') pmActive++;
      pmProg += pmSubs[sq].totalTasks>0 ? Math.round((pmSubs[sq].completedTasks/pmSubs[sq].totalTasks)*100) : 0;
      pmTotalTasks += pmSubs[sq].totalTasks;
      pmCompTasks += pmSubs[sq].completedTasks;
    }

    var pmAvg = pmTotalItems>0 ? Math.round(pmProg/pmTotalItems) : 0;

    // Build project rows including subprojects
    var allRows = [];
    for (var r=0;r<pm.projects.length;r++){
      var proj = pm.projects[r];
      allRows.push({
        type: 'project',
        number: proj.number,
        name: proj.name,
        stage: proj.stage,
        status: proj.status,
        tasks: proj.completedTasks + '/' + proj.totalTasks,
        progress: proj.progressPercent
      });

      // Add subprojects under this project
      var projSubs = subsByProject[String(proj.id)] || [];
      for (var s=0;s<projSubs.length;s++){
        var spd = projSubs[s];
        var spProg = spd.totalTasks>0 ? Math.round((spd.completedTasks/spd.totalTasks)*100) : 0;
        var spStatus = this.getStatus({active:true}, spd.stage);
        allRows.push({
          type: 'subproject',
          number: spd.number,
          name: spd.name,
          stage: spd.stage,
          status: spStatus,
          tasks: spd.completedTasks + '/' + spd.totalTasks,
          progress: spProg
        });
      }
    }

    pdfData.push({
      name: pm.name,
      email: pm.email,
      initials: pm.initials,
      avatar: pm.avatar,
      totalProjects: pmTotalItems,
      activeProjects: pmActive,
      avgProgress: pmAvg,
      totalTasks: pmCompTasks + '/' + pmTotalTasks,
      rows: allRows
    });
  }
  return pdfData;
};

dashboard = new PMDashboard();
console.log('[Dashboard] Module loaded with Supabase + subprojects v4.');

})();
