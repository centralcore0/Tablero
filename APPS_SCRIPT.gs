/**
 * Google Apps Script - Web App para Tablero
 *
 * Pasos:
 * 1) Abrí script.new y pegá este archivo.
 * 2) Deploy > New deployment > Web app.
 * 3) Execute as: Me.
 * 4) Who has access: Anyone.
 * 5) Copiá la URL /exec y usala como SHEET_WEBHOOK_URL.
 *
 * Estructura esperada (Sheet gid=0):
 * A:id | B:title | C:description | D:priority | E:client | F:status |
 * G:assignedTo | H:comments(JSON) | I:createdAt | J:createdBy | K:updatedAt | L:updatedBy | M:deadline | N:urgentRequested
 */

const DEFAULT_GID = '0';
const TICKETS_SHEET_NAME = 'BD';
const ADMIN_SHEET_NAME = 'BD_ADMINS';

function doGet() {
  // Importante: no usar response.setHeaders (no existe en Apps Script ContentService).
  return jsonOutput({ ok: true, service: 'tablero-sheet-webhook', version: '2026-02-fix', time: new Date().toISOString() });
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = String(body.action || '').trim();
    const payload = body.payload || {};

    if (!action) return jsonOutput({ ok: false, error: 'Falta action' });

    const adminActions = new Set(['upsertClient','deleteClient']);
    const ticketActions = new Set(['createTicket','updateTicket','deleteTicket']);

    if (ticketActions.has(action)) {
      const sheet = getSheetByName_(body.ticketSheet || TICKETS_SHEET_NAME) || getSheetByGid_(String(body.gid || DEFAULT_GID));
      if (!sheet) return jsonOutput({ ok: false, error: 'No existe hoja de tickets' });
      ensureTicketHeader_(sheet);

      if (action === 'createTicket') {
        upsertTicket_(sheet, payload, true);
        return jsonOutput({ ok: true, action });
      }
      if (action === 'updateTicket') {
        upsertTicket_(sheet, payload, false);
        return jsonOutput({ ok: true, action });
      }
      const id = String(payload.id || '').trim();
      if (!id) return jsonOutput({ ok: false, error: 'Falta payload.id' });
      const row = findTicketRow_(sheet, id);
      if (row > 1) sheet.deleteRow(row);
      return jsonOutput({ ok: true, action, deleted: row > 1 });
    }


    if (action === 'upsertUser' || action === 'deleteUser') {
      // Compatibilidad hacia atrás: esta versión no persiste usuarios en Sheets.
      return jsonOutput({ ok: true, action, ignored: true });
    }

    if (adminActions.has(action)) {
      const sheet = getSheetByName_(body.adminSheet || ADMIN_SHEET_NAME);
      if (!sheet) return jsonOutput({ ok: false, error: `No existe hoja ${ADMIN_SHEET_NAME}` });
      ensureAdminHeader_(sheet);

      if (action === 'upsertClient') {
        upsertAdminRow_(sheet, 'client', payload.key, {
          name: payload.name, createdAt: payload.createdAt, createdBy: payload.createdBy
        });
        return jsonOutput({ ok: true, action });
      }

      deleteAdminRow_(sheet, 'client', payload.key);
      return jsonOutput({ ok: true, action });
    }

    return jsonOutput({ ok: false, error: `Acción no soportada: ${action}` });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function parseBody_(e) {
  if (e && e.postData && e.postData.contents) {
    const text = e.postData.contents;
    try {
      return JSON.parse(text);
    } catch (_) {}
  }

  if (e && e.parameter && e.parameter.payload) {
    try {
      const base = JSON.parse(e.parameter.payload);
      return {
        action: e.parameter.action || base.action,
        payload: base.payload || {},
        gid: e.parameter.gid || base.gid || DEFAULT_GID
      };
    } catch (_) {}
  }

  return (e && e.parameter) ? e.parameter : {};
}

function getSheetByName_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name);
}

function getSheetByGid_(gid) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (String(sheets[i].getSheetId()) === gid) return sheets[i];
  }
  return null;
}

function ensureTicketHeader_(sheet) {
  const expected = [
    'id', 'title', 'description', 'priority', 'client', 'status',
    'assignedTo', 'comments', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deadline', 'urgentRequested'
  ];
  const firstRow = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  const hasHeader = firstRow.some(v => String(v || '').trim() !== '');
  if (!hasHeader) {
    sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
  }
}

function ensureAdminHeader_(sheet) {
  const expected = ['type','key','name','createdAt','createdBy','updatedAt'];
  const firstRow = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  const hasHeader = firstRow.some(v => String(v || '').trim() !== '');
  if (!hasHeader) {
    sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
  }
}

function findTicketRow_(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const values = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === id) return i + 2;
  }
  return -1;
}


function normalizeComments_(value) {
  if (!value) return '{}';
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed || {});
    } catch (_) {
      return '{}';
    }
  }
  return JSON.stringify(value);
}

function normalizeTicket_(p) {
  const now = new Date().toISOString();
  return {
    id: String(p.id || '').trim(),
    title: String(p.title || ''),
    description: String(p.description || ''),
    priority: String(p.priority || 'Media'),
    client: String(p.client || ''),
    status: String(p.status || 'unassigned'),
    assignedTo: String(p.assignedTo || ''),
    comments: normalizeComments_(p.comments),
    createdAt: String(p.createdAt || now),
    createdBy: String(p.createdBy || ''),
    updatedAt: String(p.updatedAt || now),
    updatedBy: String(p.updatedBy || ''),
    deadline: String(p.deadline || ''),
    urgentRequested: String(!!p.urgentRequested)
  };
}

function upsertTicket_(sheet, payload, createOnly) {
  const t = normalizeTicket_(payload);
  if (!t.id) throw new Error('Falta payload.id');

  const rowData = [[
    t.id, t.title, t.description, t.priority, t.client, t.status,
    t.assignedTo, t.comments, t.createdAt, t.createdBy, t.updatedAt, t.updatedBy, t.deadline, t.urgentRequested
  ]];

  const existingRow = findTicketRow_(sheet, t.id);
  if (existingRow > 1) {
    if (createOnly) return;
    sheet.getRange(existingRow, 1, 1, 14).setValues(rowData);
  } else {
    sheet.appendRow(rowData[0]);
  }
}


function findAdminRow_(sheet, type, key) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const values = sheet.getRange(2, 1, last - 1, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === type && String(values[i][1] || '').trim() === String(key || '').trim()) return i + 2;
  }
  return -1;
}

function upsertAdminRow_(sheet, type, key, data) {
  const row = [
    type,
    String(key || ''),
    String(data.name || ''),
    String(data.createdAt || ''),
    String(data.createdBy || ''),
    new Date().toISOString()
  ];
  const existing = findAdminRow_(sheet, type, key);
  if (existing > 1) {
    sheet.getRange(existing, 1, 1, 6).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function deleteAdminRow_(sheet, type, key) {
  const row = findAdminRow_(sheet, type, key);
  if (row > 1) sheet.deleteRow(row);
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
