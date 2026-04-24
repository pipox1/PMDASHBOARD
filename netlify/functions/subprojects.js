const { getStore } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const store = getStore({ name: "pm-dashboard-subprojects", siteID: process.env.SITE_ID || process.env.NETLIFY_SITE_ID });
    const STORE_KEY = "all-subprojects";

    // Load existing data
    async function loadData() {
      try {
        var raw = await store.get(STORE_KEY);
        if (raw) {
          return JSON.parse(raw);
        }
      } catch (e) {
        console.log('[Subprojects] No existing data, starting fresh');
      }
      return [];
    }

    // Save data
    async function saveData(data) {
      await store.set(STORE_KEY, JSON.stringify(data));
    }

    // GET - Read all subprojects
    if (event.httpMethod === 'GET') {
      var data = await loadData();
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

    // POST - Create new subproject
    if (event.httpMethod === 'POST') {
      var body = JSON.parse(event.body || '{}');

      if (!body.parentProjectId || !body.name) {
        return {
          statusCode: 400,
          headers: headers,
          body: JSON.stringify({ error: 'parentProjectId and name are required' })
        };
      }

      var data = await loadData();

      var newSubproject = {
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
        updatedAt: new Date().toISOString(),
        createdBy: body.createdBy || 'Unknown'
      };

      data.push(newSubproject);
      await saveData(data);

      return {
        statusCode: 201,
        headers: headers,
        body: JSON.stringify({ subproject: newSubproject, message: 'Subproject created' })
      };
    }

    // PUT - Update subproject
    if (event.httpMethod === 'PUT') {
      var body = JSON.parse(event.body || '{}');

      if (!body.id) {
        return {
          statusCode: 400,
          headers: headers,
          body: JSON.stringify({ error: 'id is required' })
        };
      }

      var data = await loadData();
      var index = -1;
      for (var i = 0; i < data.length; i++) {
        if (data[i].id === body.id) {
          index = i;
          break;
        }
      }

      if (index === -1) {
        return {
          statusCode: 404,
          headers: headers,
          body: JSON.stringify({ error: 'Subproject not found' })
        };
      }

      // Update fields
      if (body.name !== undefined) data[index].name = body.name;
      if (body.number !== undefined) data[index].number = body.number;
      if (body.totalTasks !== undefined) data[index].totalTasks = parseInt(body.totalTasks) || 0;
      if (body.completedTasks !== undefined) data[index].completedTasks = parseInt(body.completedTasks) || 0;
      if (body.stage !== undefined) data[index].stage = body.stage;
      if (body.status !== undefined) data[index].status = body.status;
      if (body.startDate !== undefined) data[index].startDate = body.startDate;
      if (body.completionDate !== undefined) data[index].completionDate = body.completionDate;
      data[index].updatedAt = new Date().toISOString();

      await saveData(data);

      return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify({ subproject: data[index], message: 'Subproject updated' })
      };
    }

    // DELETE - Delete subproject
    if (event.httpMethod === 'DELETE') {
      var params = event.queryStringParameters || {};
      var deleteId = params.id;

      if (!deleteId) {
        return {
          statusCode: 400,
          headers: headers,
          body: JSON.stringify({ error: 'id is required' })
        };
      }

      var data = await loadData();
      var newData = data.filter(function(sp) {
        return sp.id !== deleteId;
      });

      if (newData.length === data.length) {
        return {
          statusCode: 404,
          headers: headers,
          body: JSON.stringify({ error: 'Subproject not found' })
        };
      }

      await saveData(newData);

      return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify({ message: 'Subproject deleted' })
      };
    }

    return {
      statusCode: 405,
      headers: headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('[Subprojects] Error:', error);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
