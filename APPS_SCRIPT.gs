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
 * G:assignedTo | H:comments(JSON) | I:createdAt | J:createdBy | K:updatedAt | L:updatedBy | M:deadline
 */

const DEFAULT_GID = '0';

function doGet() {
  return jsonOutput({ ok: true, service: 'tablero-sheet-webhook', time: new Date().toISOString() });
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = String(body.action || '').trim();
    const payload = body.payload || {};
    const gid = String(body.gid || DEFAULT_GID);

    if (!action) return jsonOutput({ ok: false, error: 'Falta action' });

    const sheet = getSheetByGid_(gid);
    if (!sheet) return jsonOutput({ ok: false, error: `No existe sheet para gid=${gid}` });

    ensureHeader_(sheet);

    if (action === 'createTicket') {
      upsertTicket_(sheet, payload, true);
      return jsonOutput({ ok: true, action });
    }

    if (action === 'updateTicket') {
      upsertTicket_(sheet, payload, false);
      return jsonOutput({ ok: true, action });
    }

    if (action === 'deleteTicket') {
      const id = String(payload.id || '').trim();
      if (!id) return jsonOutput({ ok: false, error: 'Falta payload.id' });
      const row = findTicketRow_(sheet, id);
      if (row > 1) sheet.deleteRow(row);
      return jsonOutput({ ok: true, action, deleted: row > 1 });
    }

    return jsonOutput({ ok: false, error: `Acción no soportada: ${action}` });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  const text = e.postData.contents;
  try {
    return JSON.parse(text);
  } catch (_) {
    return {};
  }
}

function getSheetByGid_(gid) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (String(sheets[i].getSheetId()) === gid) return sheets[i];
  }
  return null;
}

function ensureHeader_(sheet) {
  const expected = [
    'id', 'title', 'description', 'priority', 'client', 'status',
    'assignedTo', 'comments', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deadline'
  ];
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
    comments: JSON.stringify(p.comments || {}),
    createdAt: String(p.createdAt || now),
    createdBy: String(p.createdBy || ''),
    updatedAt: String(p.updatedAt || now),
    updatedBy: String(p.updatedBy || ''),
    deadline: String(p.deadline || '')
  };
}

function upsertTicket_(sheet, payload, createOnly) {
  const t = normalizeTicket_(payload);
  if (!t.id) throw new Error('Falta payload.id');

  const rowData = [[
    t.id, t.title, t.description, t.priority, t.client, t.status,
    t.assignedTo, t.comments, t.createdAt, t.createdBy, t.updatedAt, t.updatedBy, t.deadline
  ]];

  const existingRow = findTicketRow_(sheet, t.id);
  if (existingRow > 1) {
    if (createOnly) return;
    sheet.getRange(existingRow, 1, 1, 13).setValues(rowData);
  } else {
    sheet.appendRow(rowData[0]);
  }
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
