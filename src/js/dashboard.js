  async processProject(project, companyId) {
    var detail;
    try {
      detail = await procoreAPI.getProjectDetail(companyId, project.id);
    } catch (e) {
      console.warn('[Dashboard] Cannot get detail for project ' + project.id);
      return;
    }

    // DEBUG: Log the full project detail to see what fields are available
    console.log('[DEBUG] Project: ' + project.name);
    console.log('[DEBUG] project_manager:', JSON.stringify(detail.project_manager));
    console.log('[DEBUG] pm_id field:', detail.pm_id);
    console.log('[DEBUG] project_manager_id:', detail.project_manager_id);
    
    // Log all keys that contain "manager" or "pm"
    var allKeys = Object.keys(detail);
    var relevantKeys = allKeys.filter(function(k) {
      var kl = k.toLowerCase();
      return kl.indexOf('manager') > -1 || kl.indexOf('pm') > -1 || kl.indexOf('superintendent') > -1;
    });
    console.log('[DEBUG] Relevant fields:', relevantKeys);
    
    // Also check if there's a project_owner or similar
    console.log('[DEBUG] All top-level keys:', allKeys.join(', '));

    // Try multiple possible field names for the PM
    var pm = null;
    
    // Option 1: project_manager object
    if (detail.project_manager && detail.project_manager.id) {
      pm = detail.project_manager;
      console.log('[DEBUG] Found PM via project_manager object:', pm.name);
    }
    // Option 2: project_manager is just an ID
    else if (detail.project_manager && typeof detail.project_manager === 'number') {
      pm = { id: detail.project_manager, name: 'PM ID: ' + detail.project_manager };
      console.log('[DEBUG] Found PM via project_manager ID:', pm.id);
    }
    // Option 3: project_manager_id field
    else if (detail.project_manager_id) {
      pm = { id: detail.project_manager_id, name: 'PM ID: ' + detail.project_manager_id };
      console.log('[DEBUG] Found PM via project_manager_id:', pm.id);
    }
    // Option 4: pm_id field  
    else if (detail.pm_id) {
      pm = { id: detail.pm_id, name: 'PM ID: ' + detail.pm_id };
      console.log('[DEBUG] Found PM via pm_id:', pm.id);
    }
    // Option 5: Check roles array
    else if (detail.roles && Array.isArray(detail.roles)) {
      for (var ri = 0; ri < detail.roles.length; ri++) {
        if (detail.roles[ri].role === 'Project Manager' || detail.roles[ri].role === 'Administrador de Proyectos') {
          pm = detail.roles[ri].user || detail.roles[ri];
          console.log('[DEBUG] Found PM via roles:', JSON.stringify(pm));
          break;
        }
      }
    }

    if (!pm || !pm.id) {
      console.log('[DEBUG] *** NO PM FOUND for project: ' + project.name + ' ***');
      // Log first 5 fields with their values for debugging
      for (var di = 0; di < Math.min(allKeys.length, 20); di++) {
        var val = detail[allKeys[di]];
        if (val !== null && val !== undefined && val !== '' && typeof val !== 'object') {
          console.log('[DEBUG]   ' + allKeys[di] + ' = ' + val);
        } else if (val !== null && val !== undefined && typeof val === 'object') {
          console.log('[DEBUG]   ' + allKeys[di] + ' = ' + JSON.stringify(val).substring(0, 100));
        }
      }
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
