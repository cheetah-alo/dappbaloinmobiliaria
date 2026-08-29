/* global ContentService, LockService, PropertiesService, SpreadsheetApp, Utilities */

var CLOCK_SKEW_MS = 5 * 60 * 1000;
var ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
var OPS_EVENT_TYPES = ['ops_snapshot', 'ops_assignment', 'ops_activity', 'ops_approval_request', 'ops_approval_decision'];
var ACTIVITY_TYPES = ['lead_created', 'lead_assigned', 'post_published', 'visit_scheduled', 'visit_completed', 'offer_received', 'approval_requested', 'approval_decided', 'manual_follow_up'];
var APPROVAL_KINDS = ['price', 'publication', 'commission', 'discount', 'closure'];

function doGet() {
  return response_({ ok: true, service: 'balo-sheets-gateway' });
}

function doPost(event) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20 * 1000);
    var rawBody = event && event.postData ? event.postData.contents : '';
    var validation = validateEnvelope_(rawBody);
    if (!validation.ok) return response_(validation);

    var spreadsheet = SpreadsheetApp.openById(requiredProperty_('SPREADSHEET_ID'));
    if (validation.event.eventType === 'ops_snapshot') return response_(snapshotResponse_(spreadsheet, validation.event));

    var audit = auditSheet_(spreadsheet);
    if (eventExists_(audit, validation.event.eventId)) {
      return response_({ ok: true, eventId: validation.event.eventId, deduplicated: true });
    }

    var result = recordEvent_(spreadsheet, validation.event);
    if (!result.ok) return response_(result);
    appendRow_(audit, [validation.event.eventId, validation.event.eventType, validation.event.occurredAt, new Date().toISOString(), 'recorded', sourceFor_(validation.event)]);
    return response_({ ok: true, eventId: validation.event.eventId, deduplicated: false, approvalId: result.approvalId || undefined });
  } catch (_error) {
    // Do not write incoming payloads, personal data, or credentials to logs.
    console.error(JSON.stringify({ event: 'gateway_failure' }));
    return response_({ ok: false, code: 'GATEWAY_ERROR' });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function validateEnvelope_(rawBody) {
  if (!rawBody) return { ok: false, code: 'EMPTY_BODY' };
  var envelope;
  try {
    envelope = JSON.parse(rawBody);
  } catch (_error) {
    return { ok: false, code: 'INVALID_JSON' };
  }
  if (!isObject_(envelope) || typeof envelope.timestamp !== 'string' || typeof envelope.signature !== 'string' || !isObject_(envelope.event)) {
    return { ok: false, code: 'INVALID_ENVELOPE' };
  }
  var timestampMs = Date.parse(envelope.timestamp);
  if (!isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > CLOCK_SKEW_MS) return { ok: false, code: 'INVALID_REQUEST_WINDOW' };
  if (!validEvent_(envelope.event)) return { ok: false, code: 'INVALID_EVENT' };
  var expected = 'sha256=' + hmacHex_(requiredProperty_('GATEWAY_HMAC_SECRET'), envelope.timestamp + '.' + canonicalJson_(envelope.event));
  if (!constantTimeEquals_(expected, envelope.signature)) return { ok: false, code: 'INVALID_SIGNATURE' };
  return { ok: true, event: envelope.event };
}

function validEvent_(event) {
  if (!isIdentifier_(event.eventId) || typeof event.eventType !== 'string' || typeof event.occurredAt !== 'string' || !isObject_(event.payload)) return false;
  return event.eventType === 'owner_enquiry' || event.eventType === 'channel_webhook' || OPS_EVENT_TYPES.indexOf(event.eventType) !== -1;
}

function canonicalJson_(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!isFinite(value)) throw new Error('Cannot sign non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson_).join(',') + ']';
  if (isObject_(value)) {
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + canonicalJson_(value[key]);
    }).join(',') + '}';
  }
  throw new Error('Unsupported signed value');
}

function recordEvent_(spreadsheet, event) {
  if (event.eventType === 'owner_enquiry') return recordOwnerEnquiry_(spreadsheet, event);
  if (event.eventType === 'channel_webhook') {
    appendRow_(sheet_(spreadsheet, 'Eventos de canal', ['event_id', 'received_at', 'provider', 'event_type', 'status']), [event.eventId, new Date().toISOString(), event.payload.provider || 'unknown', event.eventType, 'received']);
    return { ok: true };
  }
  return recordOpsEvent_(spreadsheet, event);
}

function recordOwnerEnquiry_(spreadsheet, event) {
  var lead = event.payload;
  if (!validOwnerEnquiry_(lead)) return { ok: false, code: 'INVALID_OWNER_ENQUIRY' };
  appendRow_(leadsSheet_(spreadsheet), [
    event.eventId, new Date().toISOString(), lead.name, lead.phone, lead.email || '', lead.operation, lead.district, event.occurredAt,
    sourceFor_(event), lead.attribution.utmSource || '', lead.attribution.utmCampaign || '', lead.attribution.qrId || '', lead.attribution.postId || '', '', 'new'
  ]);
  appendActivity_(spreadsheet, event.eventId, 'lead_created', event.eventId, '', event.occurredAt, { source: sourceFor_(event) });
  return { ok: true };
}

function validOwnerEnquiry_(lead) {
  if (!isObject_(lead) || !validText_(lead.name, 2, 120) || !validText_(lead.phone, 7, 40) || String(lead.phone).replace(/\D/g, '').length < 7 || !validText_(lead.district, 2, 120) || lead.consent !== true || ['sell', 'rent', 'buy', 'invest'].indexOf(lead.operation) === -1 || !validAttribution_(lead.attribution)) return false;
  return !lead.email || validText_(lead.email, 1, 254);
}

function validAttribution_(attribution) {
  if (!isObject_(attribution) || ['website', 'whatsapp', 'instagram', 'portal', 'manual'].indexOf(attribution.source) === -1) return false;
  return ['utmSource', 'utmCampaign', 'qrId', 'postId'].every(function (key) {
    return !attribution[key] || validText_(attribution[key], 1, 120);
  });
}

function recordOpsEvent_(spreadsheet, event) {
  var actor = resolvedActor_(spreadsheet, event.payload.actor);
  if (!actor) return { ok: false, code: 'ACTOR_NOT_AUTHORIZED' };
  if (event.eventType === 'ops_assignment') return recordAssignment_(spreadsheet, event, actor);
  if (event.eventType === 'ops_activity') return recordActivity_(spreadsheet, event, actor);
  if (event.eventType === 'ops_approval_request') return recordApprovalRequest_(spreadsheet, event, actor);
  if (event.eventType === 'ops_approval_decision') return recordApprovalDecision_(spreadsheet, event, actor);
  return { ok: false, code: 'UNSUPPORTED_OPERATION' };
}

function recordAssignment_(spreadsheet, event, actor) {
  if (actor.role !== 'admin' || !isIdentifier_(event.payload.leadId) || !isIdentifier_(event.payload.assigneeId) || !activeActorById_(spreadsheet, event.payload.assigneeId)) return { ok: false, code: 'INVALID_ASSIGNMENT' };
  var lead = findRowById_(leadsSheet_(spreadsheet), event.payload.leadId);
  if (!lead) return { ok: false, code: 'LEAD_NOT_FOUND' };
  lead.sheet.getRange(lead.row, lead.columns.assigned_to).setValue(safeCell_(event.payload.assigneeId));
  appendActivity_(spreadsheet, event.eventId, 'lead_assigned', event.payload.leadId, actor.id, event.occurredAt, { assigneeId: event.payload.assigneeId });
  return { ok: true };
}

function recordActivity_(spreadsheet, event, actor) {
  if (!isIdentifier_(event.payload.leadId) || ACTIVITY_TYPES.indexOf(event.payload.activityType) === -1 || !validMetadata_(event.payload.metadata)) return { ok: false, code: 'INVALID_ACTIVITY' };
  var lead = findRowById_(leadsSheet_(spreadsheet), event.payload.leadId);
  if (!lead) return { ok: false, code: 'LEAD_NOT_FOUND' };
  if (actor.role !== 'admin' && lead.values[lead.columns.assigned_to - 1] !== actor.id) return { ok: false, code: 'ASSIGNMENT_REQUIRED' };
  appendActivity_(spreadsheet, event.eventId, event.payload.activityType, event.payload.leadId, actor.id, event.occurredAt, event.payload.metadata);
  return { ok: true };
}

function recordApprovalRequest_(spreadsheet, event, actor) {
  if (!isIdentifier_(event.payload.approvalId) || !isIdentifier_(event.payload.recordId) || APPROVAL_KINDS.indexOf(event.payload.kind) === -1 || !validText_(event.payload.rationale, 3, 1000)) return { ok: false, code: 'INVALID_APPROVAL_REQUEST' };
  var record = recordById_(spreadsheet, event.payload.recordId);
  if (!record || (actor.role !== 'admin' && record.assigneeId !== actor.id)) return { ok: false, code: 'ASSIGNMENT_REQUIRED' };
  appendRow_(approvalsSheet_(spreadsheet), [event.payload.approvalId, event.payload.kind, event.payload.recordId, actor.id, 'pending', '', '', event.payload.rationale, '']);
  appendActivityForRecord_(spreadsheet, event.eventId, 'approval_requested', record, actor.id, event.occurredAt, { approvalId: event.payload.approvalId, kind: event.payload.kind });
  return { ok: true, approvalId: event.payload.approvalId };
}

function recordApprovalDecision_(spreadsheet, event, actor) {
  if (actor.role !== 'admin' || !isIdentifier_(event.payload.approvalId) || ['approved', 'rejected'].indexOf(event.payload.decision) === -1 || !validText_(event.payload.reason, 3, 1000)) return { ok: false, code: 'INVALID_APPROVAL_DECISION' };
  var approval = findRowById_(approvalsSheet_(spreadsheet), event.payload.approvalId);
  if (!approval || approval.values[approval.columns.status - 1] !== 'pending') return { ok: false, code: 'APPROVAL_NOT_PENDING' };
  var record = recordById_(spreadsheet, String(approval.values[approval.columns.record_id - 1] || ''));
  if (!record) return { ok: false, code: 'APPROVAL_RECORD_NOT_FOUND' };
  approval.sheet.getRange(approval.row, approval.columns.status).setValue(event.payload.decision);
  approval.sheet.getRange(approval.row, approval.columns.approved_by).setValue(safeCell_(actor.id));
  approval.sheet.getRange(approval.row, approval.columns.approved_at).setValue(new Date().toISOString());
  approval.sheet.getRange(approval.row, approval.columns.decision_reason).setValue(safeCell_(event.payload.reason));
  appendActivityForRecord_(spreadsheet, event.eventId, 'approval_decided', record, actor.id, event.occurredAt, { approvalId: event.payload.approvalId, decision: event.payload.decision });
  return { ok: true };
}

function snapshotResponse_(spreadsheet, event) {
  var actor = resolvedActor_(spreadsheet, event.payload.actor);
  if (!actor) return { ok: false, code: 'ACTOR_NOT_AUTHORIZED' };
  var allLeads = readLeads_(leadsSheet_(spreadsheet));
  var allProperties = readProperties_(propertiesSheet_(spreadsheet));
  var leads = actor.role === 'admin' ? allLeads : allLeads.filter(function (lead) { return lead.assigneeId === actor.id; });
  var properties = actor.role === 'admin' ? allProperties : allProperties.filter(function (property) { return property.assigneeId === actor.id; });
  var leadIds = leads.map(function (lead) { return lead.id; });
  var propertyIds = properties.map(function (property) { return property.id; });
  var activities = readActivities_(activitiesSheet_(spreadsheet)).filter(function (activity) {
    return actor.role === 'admin' || (activity.leadId && leadIds.indexOf(activity.leadId) !== -1) || (activity.propertyId && propertyIds.indexOf(activity.propertyId) !== -1);
  });
  var approvals = readApprovals_(approvalsSheet_(spreadsheet)).filter(function (approval) {
    return actor.role === 'admin' || leadIds.indexOf(approval.recordId) !== -1 || propertyIds.indexOf(approval.recordId) !== -1;
  });
  return { ok: true, actor: actor, leads: leads, properties: properties, activities: activities, approvals: approvals, users: actor.role === 'admin' ? readUsers_(usersSheet_(spreadsheet)) : [] };
}

function usersSheet_(spreadsheet) {
  return sheet_(spreadsheet, 'Usuarios', ['id', 'name', 'email', 'role', 'status']);
}

function leadsSheet_(spreadsheet) {
  return sheet_(spreadsheet, 'Leads', ['event_id', 'received_at', 'name', 'phone', 'email', 'operation', 'district', 'consent_at', 'source', 'utm_source', 'utm_campaign', 'qr_id', 'post_id', 'assigned_to', 'status']);
}

function propertiesSheet_(spreadsheet) {
  return sheet_(spreadsheet, 'Inmuebles', ['id', 'label', 'assignee_id', 'publication_status']);
}

function activitiesSheet_(spreadsheet) {
  return sheet_(spreadsheet, 'Actividades', ['id', 'type', 'lead_id', 'property_id', 'actor_id', 'occurred_at', 'metadata']);
}

function approvalsSheet_(spreadsheet) {
  return sheet_(spreadsheet, 'Aprobaciones', ['id', 'kind', 'record_id', 'requested_by', 'status', 'approved_by', 'approved_at', 'rationale', 'decision_reason']);
}

function auditSheet_(spreadsheet) {
  return sheet_(spreadsheet, 'Auditoria', ['event_id', 'event_type', 'occurred_at', 'received_at', 'status', 'source']);
}

function appendActivity_(spreadsheet, id, type, leadId, actorId, occurredAt, metadata) {
  appendRow_(activitiesSheet_(spreadsheet), [id, type, leadId || '', '', actorId || '', occurredAt, JSON.stringify(metadata || {})]);
}

function appendActivityForRecord_(spreadsheet, id, type, record, actorId, occurredAt, metadata) {
  appendRow_(activitiesSheet_(spreadsheet), [id, type, record.leadId || '', record.propertyId || '', actorId || '', occurredAt, JSON.stringify(metadata || {})]);
}

function sourceFor_(event) {
  return event.payload && event.payload.attribution ? event.payload.attribution.source || 'manual' : 'channel';
}

function resolvedActor_(spreadsheet, input) {
  if (!isObject_(input) || !isIdentifier_(input.id)) return null;
  var email = typeof input.email === 'string' ? input.email.toLowerCase() : '';
  var rows = readUsers_(usersSheet_(spreadsheet));
  return rows.find(function (actor) {
    return actor.status === 'active' && (actor.id === input.id || (email && actor.email && actor.email.toLowerCase() === email));
  }) || null;
}

function activeActorById_(spreadsheet, actorId) {
  return readUsers_(usersSheet_(spreadsheet)).find(function (actor) { return actor.id === actorId && actor.status === 'active'; }) || null;
}

function readUsers_(sheet) {
  return rows_(sheet).map(function (row) {
    return { id: String(row.id || ''), name: String(row.name || ''), email: String(row.email || ''), role: String(row.role || ''), status: String(row.status || '') };
  }).filter(function (actor) { return isIdentifier_(actor.id) && actor.name && ['admin', 'user'].indexOf(actor.role) !== -1; });
}

function readLeads_(sheet) {
  return rows_(sheet).map(function (row) {
    return {
      id: String(row.event_id || ''), ownerName: String(row.name || ''), assigneeId: String(row.assigned_to || ''), stage: String(row.status || 'new'), consentAt: String(row.consent_at || ''),
      attribution: { source: String(row.source || 'manual'), utmSource: optionalString_(row.utm_source), utmCampaign: optionalString_(row.utm_campaign), qrId: optionalString_(row.qr_id), postId: optionalString_(row.post_id) },
      operation: optionalString_(row.operation), district: optionalString_(row.district), createdAt: optionalString_(row.received_at), contact: { phone: String(row.phone || ''), email: optionalString_(row.email) }
    };
  }).filter(function (lead) { return isIdentifier_(lead.id) && (lead.assigneeId === '' || isIdentifier_(lead.assigneeId)) && ['new', 'qualified', 'visit_scheduled', 'offer_received', 'closed', 'lost'].indexOf(lead.stage) !== -1 && ['website', 'whatsapp', 'instagram', 'portal', 'manual'].indexOf(lead.attribution.source) !== -1; });
}

function readProperties_(sheet) {
  return rows_(sheet).map(function (row) {
    return { id: String(row.id || ''), label: String(row.label || ''), assigneeId: String(row.assignee_id || ''), publicationStatus: String(row.publication_status || 'draft') };
  }).filter(function (property) { return isIdentifier_(property.id) && isIdentifier_(property.assigneeId) && ['draft', 'approved', 'published', 'paused'].indexOf(property.publicationStatus) !== -1; });
}

function readActivities_(sheet) {
  return rows_(sheet).map(function (row) {
    var metadata = {};
    try { metadata = JSON.parse(String(row.metadata || '{}')); } catch (_error) { metadata = {}; }
    return { id: String(row.id || ''), type: String(row.type || ''), leadId: optionalString_(row.lead_id), propertyId: optionalString_(row.property_id), actorId: String(row.actor_id || ''), occurredAt: String(row.occurred_at || ''), metadata: metadata };
  }).filter(function (activity) { return isIdentifier_(activity.id) && ACTIVITY_TYPES.indexOf(activity.type) !== -1 && isIdentifier_(activity.actorId); });
}

function readApprovals_(sheet) {
  return rows_(sheet).map(function (row) {
    return { id: String(row.id || ''), kind: String(row.kind || ''), recordId: String(row.record_id || ''), requestedBy: String(row.requested_by || ''), status: String(row.status || ''), approvedBy: optionalString_(row.approved_by), approvedAt: optionalString_(row.approved_at), rationale: String(row.rationale || ''), decisionReason: optionalString_(row.decision_reason) };
  }).filter(function (approval) { return isIdentifier_(approval.id) && APPROVAL_KINDS.indexOf(approval.kind) !== -1 && isIdentifier_(approval.recordId) && isIdentifier_(approval.requestedBy) && ['pending', 'approved', 'rejected'].indexOf(approval.status) !== -1; });
}

function recordById_(spreadsheet, recordId) {
  var lead = findRowById_(leadsSheet_(spreadsheet), recordId);
  if (lead) return { leadId: recordId, assigneeId: String(lead.values[lead.columns.assigned_to - 1] || '') };
  var property = findRowById_(propertiesSheet_(spreadsheet), recordId);
  return property ? { propertyId: recordId, assigneeId: String(property.values[property.columns.assignee_id - 1] || '') } : null;
}

function findRowById_(sheet, id) {
  var rows = rows_(sheet, true);
  for (var index = 0; index < rows.length; index += 1) {
    if (String(rows[index].values[0]) === id) return { sheet: sheet, row: rows[index].row, values: rows[index].values, columns: rows[index].columns };
  }
  return null;
}

function rows_(sheet, includePosition) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (header) { return String(header); });
  var columns = {};
  headers.forEach(function (header, index) { columns[header] = index + 1; });
  return values.slice(1).map(function (values, index) {
    if (includePosition) return { row: index + 2, values: values, columns: columns };
    var row = {};
    headers.forEach(function (header, columnIndex) { row[header] = values[columnIndex]; });
    return row;
  });
}

function eventExists_(sheet, eventId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  return sheet.getRange(2, 1, lastRow - 1, 1).getValues().some(function (row) { return row[0] === eventId; });
}

function sheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) appendRow_(sheet, headers);
  return sheet;
}

function appendRow_(sheet, values) {
  sheet.appendRow(values.map(safeCell_));
}

function safeCell_(value) {
  var text = value === undefined || value === null ? '' : String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function validMetadata_(metadata) {
  return isObject_(metadata) && Object.keys(metadata).length <= 10 && Object.keys(metadata).every(function (key) {
    return key.length > 0 && key.length <= 120 && validText_(metadata[key], 0, 1000);
  });
}

function validText_(value, min, max) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

function optionalString_(value) {
  return value === undefined || value === null || String(value) === '' ? undefined : String(value);
}

function isObject_(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIdentifier_(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function hmacHex_(key, message) {
  return Utilities.computeHmacSha256Signature(message, key).map(function (byte) {
    var normalized = byte < 0 ? byte + 256 : byte;
    return normalized.toString(16).padStart(2, '0');
  }).join('');
}

function constantTimeEquals_(left, right) {
  var difference = left.length ^ right.length;
  for (var index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ (index < right.length ? right.charCodeAt(index) : 0);
  }
  return difference === 0;
}

function requiredProperty_(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('Missing script property');
  return value;
}

function response_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
