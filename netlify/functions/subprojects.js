const fs = require('fs');
const path = require('path');

const DATA_FILE = '/tmp/subprojects.json';
let memoryStore = null;

function loadData() {
  if (memoryStore !== null) {
    return memoryStore;
  }
  try {
    if (fs.existsSync(DATA_FILE)) {
      var raw = fs.readFileSync(DATA_FILE, 'utf8');
      memoryStore = JSON.parse(raw);
      return memoryStore;
    }
  } catch (e) {
    console.log('[Subprojects] File read error:', e.message);
  }
  memoryStore = [];
  return memoryStore;
}

function saveData(data) {
  memoryStore = data;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8');
  } catch (e) {
    console.log('[Subprojects] File write error:', e.message);
  }
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

  try {

    // GET
    if (event.httpMethod === 'GET') {
      var data = loadData();
      var parentProjectId = event.queryStringParameters ? event.queryStringParameters.parent_project_id : null;

      if (parentProjectId) {
        data = data.filter(function(sp) {
          return String(sp.parentProjectId) === String(parentProjectId);
        });
      }

      return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify({ subprojects: data })
      };
    }

    // POST
    if (event.httpMethod === 'POST') {
      var body = JSON.parse(event.body || '{}');
      console.log('[Subprojects] Creating:', body.name);

      if (!body.parentProjectId || !body.name) {
        return {
          statusCode: 400,
          headers: headers,
          body: JSON.stringify({ error: 'parentProjectId and name are required' })
        };
      }

      var data = loadData();

      var newSub = {
        id: 'sp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        parentProjectId: String(body.parentProjectId),
        parentProjectName: body.parentProjectName || '',
        pmId: String(body.pmId || ''),
        pmName: body.pmName || '',
        number: body.number || '',
        name: body.name,
        totalTasks: parseInt(body.totalTasks) || 0,
        completedTasks: parseInt(body.completedTasks) || 0,
        stage: body.stage || 'Proyecto en Ejecucion',
        status: body.status || 'Active',
        startDate: body.startDate || null,
        completionDate: body.completionDate || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      data.push(newSub);
      saveData(data);

      return {
        statusCode: 201,
        headers: headers,
        body: JSON.stringify({ subproject: newSub, message: 'Created' })
      };
    }

    // PUT
    if (event.httpMethod === 'PUT') {
      var body = JSON.parse(event.body || '{}');

      if (!body.id) {
        return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'id required' }) };
      }

      var data = loadData();
      var idx = -1;
      for (var i = 0; i < data.length; i++) {
        if (data[i].id === body.id) { idx = i; break; }
      }

      if (idx === -1) {
        return { statusCode: 404, headers: headers, body: JSON.stringify({ error: 'Not found' }) };
      }

      if (body.name !== undefined) data[idx].name = body.name;
      if (body.number !== undefined) data[idx].number = body.number;
      if (body.totalTasks !== undefined) data[idx].totalTasks = parseInt(body.totalTasks) || 0;
      if (body.completedTasks !== undefined) data[idx].completedTasks = parseInt(body.completedTasks) || 0;
      if (body.stage !== undefined) data[idx].stage = body.stage;
      if (body.status !== undefined) data[idx].status = body.status;
      if (body.startDate !== undefined) data[idx].startDate = body.startDate;
      if (body.completionDate !== undefined) data[idx].completionDate = body.completionDate;
      data[idx].updatedAt = new Date().toISOString();

      saveData(data);

      return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify({ subproject: data[idx], message: 'Updated' })
      };
    }

    // DELETE
    if (event.httpMethod === 'DELETE') {
      var deleteId = event.queryStringParameters ? event.queryStringParameters.id : null;

      if (!deleteId) {
        return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'id required' }) };
      }

      var data = loadData();
      var filtered = data.filter(function(sp) { return sp.id !== deleteId; });

      if (filtered.length === data.length) {
        return { statusCode: 404, headers: headers, body: JSON.stringify({ error: 'Not found' }) };
      }

      saveData(filtered);

      return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify({ message: 'Deleted' })
      };
    }

    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (error) {
    console.error('[Subprojects] Error:', error);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
