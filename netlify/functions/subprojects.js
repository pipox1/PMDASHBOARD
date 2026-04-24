const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

function supabaseRequest(path, options) {
  var url = SUPABASE_URL + '/rest/v1' + path;
  var defaultHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  var mergedHeaders = Object.assign({}, defaultHeaders, options.headers || {});
  return fetch(url, {
    method: options.method || 'GET',
    headers: mergedHeaders,
    body: options.body || undefined
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_KEY' }) };
  }

  try {

    // GET
    if (event.httpMethod === 'GET') {
      var path = '/subprojects?select=*&order=created_at.asc';
      var parentProjectId = event.queryStringParameters ? event.queryStringParameters.parent_project_id : null;
      if (parentProjectId) {
        path += '&parent_project_id=eq.' + encodeURIComponent(parentProjectId);
      }

      var resp = await supabaseRequest(path, { method: 'GET' });
      var data = await resp.json();

      if (!resp.ok) {
        console.error('[Subprojects] GET error:', JSON.stringify(data));
        return { statusCode: resp.status, headers, body: JSON.stringify({ error: data.message || 'Read failed' }) };
      }

      var mapped = data.map(function(row) {
        return {
          id: row.id, parentProjectId: row.parent_project_id, parentProjectName: row.parent_project_name,
          pmId: row.pm_id, pmName: row.pm_name, number: row.number, name: row.name,
          totalTasks: row.total_tasks, completedTasks: row.completed_tasks, stage: row.stage, status: row.status,
          startDate: row.start_date, completionDate: row.completion_date, createdAt: row.created_at, updatedAt: row.updated_at
        };
      });

      return { statusCode: 200, headers, body: JSON.stringify({ subprojects: mapped }) };
    }

    // POST
    if (event.httpMethod === 'POST') {
      var body = JSON.parse(event.body || '{}');
      console.log('[Subprojects] Creating:', body.name);

      if (!body.parentProjectId || !body.name) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'parentProjectId and name are required' }) };
      }

      var newId = 'sp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      var insertBody = {
        id: newId, parent_project_id: String(body.parentProjectId), parent_project_name: body.parentProjectName || '',
        pm_id: String(body.pmId || ''), pm_name: body.pmName || '', number: body.number || '', name: body.name,
        total_tasks: parseInt(body.totalTasks) || 0, completed_tasks: parseInt(body.completedTasks) || 0,
        stage: body.stage || 'Proyecto en Ejecucion', status: body.status || 'Active',
        start_date: body.startDate || null, completion_date: body.completionDate || null
      };

      var resp = await supabaseRequest('/subprojects', { method: 'POST', body: JSON.stringify(insertBody) });
      var data = await resp.json();

      if (!resp.ok) {
        console.error('[Subprojects] POST error:', JSON.stringify(data));
        return { statusCode: resp.status, headers, body: JSON.stringify({ error: data.message || 'Create failed' }) };
      }

      var created = data[0] || data;
      var mapped = {
        id: created.id, parentProjectId: created.parent_project_id, parentProjectName: created.parent_project_name,
        pmId: created.pm_id, pmName: created.pm_name, number: created.number, name: created.name,
        totalTasks: created.total_tasks, completedTasks: created.completed_tasks, stage: created.stage, status: created.status,
        startDate: created.start_date, completionDate: created.completion_date, createdAt: created.created_at, updatedAt: created.updated_at
      };

      return { statusCode: 201, headers, body: JSON.stringify({ subproject: mapped, message: 'Created' }) };
    }

    // PUT
    if (event.httpMethod === 'PUT') {
      var body = JSON.parse(event.body || '{}');
      if (!body.id) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }; }

      var updateBody = { updated_at: new Date().toISOString() };
      if (body.name !== undefined) updateBody.name = body.name;
      if (body.number !== undefined) updateBody.number = body.number;
      if (body.totalTasks !== undefined) updateBody.total_tasks = parseInt(body.totalTasks) || 0;
      if (body.completedTasks !== undefined) updateBody.completed_tasks = parseInt(body.completedTasks) || 0;
      if (body.stage !== undefined) updateBody.stage = body.stage;
      if (body.status !== undefined) updateBody.status = body.status;
      if (body.startDate !== undefined) updateBody.start_date = body.startDate;
      if (body.completionDate !== undefined) updateBody.completion_date = body.completionDate;

      var resp = await supabaseRequest('/subprojects?id=eq.' + encodeURIComponent(body.id), { method: 'PATCH', body: JSON.stringify(updateBody) });
      var data = await resp.json();

      if (!resp.ok) {
        console.error('[Subprojects] PUT error:', JSON.stringify(data));
        return { statusCode: resp.status, headers, body: JSON.stringify({ error: data.message || 'Update failed' }) };
      }

      var updated = data[0] || data;
      var mapped = {
        id: updated.id, parentProjectId: updated.parent_project_id, parentProjectName: updated.parent_project_name,
        pmId: updated.pm_id, pmName: updated.pm_name, number: updated.number, name: updated.name,
        totalTasks: updated.total_tasks, completedTasks: updated.completed_tasks, stage: updated.stage, status: updated.status,
        startDate: updated.start_date, completionDate: updated.completion_date, createdAt: updated.created_at, updatedAt: updated.updated_at
      };

      return { statusCode: 200, headers, body: JSON.stringify({ subproject: mapped, message: 'Updated' }) };
    }

    // DELETE
    if (event.httpMethod === 'DELETE') {
      var deleteId = event.queryStringParameters ? event.queryStringParameters.id : null;
      if (!deleteId) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }; }

      var resp = await supabaseRequest('/subprojects?id=eq.' + encodeURIComponent(deleteId), { method: 'DELETE' });
      if (!resp.ok) {
        var data = await resp.json();
        return { statusCode: resp.status, headers, body: JSON.stringify({ error: data.message || 'Delete failed' }) };
      }

      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Deleted' }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (error) {
    console.error('[Subprojects] Error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
