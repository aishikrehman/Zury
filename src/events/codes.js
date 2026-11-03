// Wiki codes appear in URLs after the event (/wam/2026/<code>), so they can't
// be the names of event sub-pages.
const RESERVED_CODES = new Set([
  'config', 'status', 'delete', 'wikis', 'participants', 'members', 'overrides', 'activity',
  'statistics', 'submit', 'submissions', 'join', 'leave', 'blocks', 'message', 'tracking', 'sessions',
]);

module.exports = { RESERVED_CODES };
