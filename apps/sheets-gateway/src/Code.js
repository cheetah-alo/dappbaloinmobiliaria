/* global ContentService, LockService, PropertiesService, SpreadsheetApp, Utilities */

var CLOCK_SKEW_MS = 5 * 60 * 1000;

function doGet() {
  return response_({ ok: true, service: 'balo-sheets-gateway' });
}

function doPost(event) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20 * 1000);
    var rawBody = event && event.postData ? event.postData.contents : '';
    var headers = normalizedHeaders_(event);
    var validation = validateRequest_(rawBody, headers);
    if (!validation.ok) return response_(validation);

    var spreadsheet = SpreadsheetApp.openById(requiredProperty_('SPREADSHEET_ID'));
    var audit = sheet_(spreadsheet, 'Auditoria', ['event_id', 'event_type', 'occurred_at', 'received_at', 'status', 'source']);
    if (eventExists_(audit, validation.payload.eventId)) return response_({ ok: true, eventId: validation.payload.eventId, deduplicated: true });

    recordEvent_(spreadsheet, validation.payload);
    audit.appendRow([validation.payload.eventId, validation.payload.eventType, validation.payload.occurredAt, new Date().toISOString(), 'recorded', sourceFor_(validation.payload)]);
    return response_({ ok: true, eventId: validation.payload.eventId, deduplicated: false });
  } catch (error) {
    console.error(error && error.message ? error.message : String(error));
    return response_({ ok: false, code: 'GATEWAY_ERROR' });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function normalizedHeaders_(event) {
  var parameters = (event && event.parameter) || {};
  return {
    eventId: parameters.event_id || '',
    timestamp: parameters.timestamp || '',
    signature: parameters.signature || ''
  };
}

function validateRequest_(rawBody, headers) {
  if (!rawBody) return { ok: false, code: 'EMPTY_BODY' };
  var timestamp = headers.timestamp;
  var signature = headers.signature;
  if (!timestamp || !signature || Math.abs(Date.now() - Date.parse(timestamp)) > CLOCK_SKEW_MS) return { ok: false, code: 'INVALID_REQUEST_WINDOW' };
  var expected = 'sha256=' + hmacHex_(requiredProperty_('GATEWAY_HMAC_SECRET'), timestamp + '.' + rawBody);
  if (!constantTimeEquals_(expected, signature)) return { ok: false, code: 'INVALID_SIGNATURE' };
  try {
    var payload = JSON.parse(rawBody);
    if (!payload.eventId || !payload.eventType || !payload.occurredAt || !payload.payload) return { ok: false, code: 'INVALID_EVENT' };
    return { ok: true, payload: payload };
  } catch (_error) {
    return { ok: false, code: 'INVALID_JSON' };
  }
}

function recordEvent_(spreadsheet, event) {
  if (event.eventType === 'owner_enquiry') {
    var lead = event.payload;
    sheet_(spreadsheet, 'Leads', ['event_id', 'received_at', 'name', 'phone', 'email', 'operation', 'district', 'consent_at', 'source', 'utm_source', 'utm_campaign', 'qr_id', 'post_id', 'assigned_to', 'status']).appendRow([
      event.eventId, new Date().toISOString(), lead.name || '', lead.phone || '', lead.email || '', lead.operation || '', lead.district || '', event.occurredAt,
      sourceFor_(event), (lead.attribution || {}).utmSource || '', (lead.attribution || {}).utmCampaign || '', (lead.attribution || {}).qrId || '', (lead.attribution || {}).postId || '', '', 'new'
    ]);
    return;
  }
  sheet_(spreadsheet, 'Eventos de canal', ['event_id', 'received_at', 'provider', 'event_type', 'status']).appendRow([event.eventId, new Date().toISOString(), (event.payload || {}).provider || 'unknown', event.eventType, 'received']);
}

function sourceFor_(event) {
  return event.payload && event.payload.attribution ? event.payload.attribution.source || 'manual' : 'channel';
}

function eventExists_(sheet, eventId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  return sheet.getRange(2, 1, lastRow - 1, 1).getValues().some(function (row) { return row[0] === eventId; });
}

function sheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  return sheet;
}

function requiredProperty_(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('Missing script property: ' + name);
  return value;
}

function hmacHex_(key, message) {
  return Utilities.computeHmacSha256Signature(message, key).map(function (byte) {
    var normalized = byte < 0 ? byte + 256 : byte;
    return normalized.toString(16).padStart(2, '0');
  }).join('');
}

function constantTimeEquals_(left, right) {
  if (left.length !== right.length) return false;
  var difference = 0;
  for (var index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function response_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
