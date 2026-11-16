'use strict';
// Explicitly unresolved policy; never infer PASS or choose a 'nice' expected status.
module.exports = new Map([
  ['T07-AUTH-009','Specify response/rollback semantics when Redis blacklist writes fail during logout (DB row may be in transaction).'],
  ['T07-TX-004','After DB commit but Redis publish failure: decide HTTP response status and required reconciliation path, distinct from DB durability.'],
]);
