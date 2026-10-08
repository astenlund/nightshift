'use strict';

// Removes a run's independent provenance completely, its index rows and the provenance and discharge record artifacts bound to
// it, while its schema-2 accounting and frontier artifacts stay: a record the runtime must treat as having lost its provenance.
function dropFacilityProvenance(db, runId) {
  db.prepare(`DELETE FROM artifacts WHERE body LIKE ? AND (body LIKE '%"predecessor":%' OR body LIKE '%"occurrence":%')`).run(`%"runId":"${runId}"%`);
  db.prepare('DELETE FROM accounting_commits WHERE run_id=?').run(runId);
  db.prepare('DELETE FROM discharge_index WHERE run_id=?').run(runId);
}

module.exports = { dropFacilityProvenance };
