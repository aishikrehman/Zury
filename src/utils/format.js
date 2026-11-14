function formatDate(date, timeZone = 'UTC') {
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone }).format(date);
  } catch {
    return new Date(date).toISOString().slice(0, 10);
  }
}

function formatDateTime(date, timeZone = 'UTC') {
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date);
  } catch {
    return new Date(date).toISOString();
  }
}

function userPath(username) {
  return `/users/${encodeURIComponent(username)}`;
}

// Canonical address of an event: /<series>/<edition> when it has one.
// An event's address, as stored from its actual parent (see editionService).
function eventPath(c) {
  return c.path || `/contest/${c.id}`;
}

// A name as a readable path piece, the way Wikipedia writes titles: spaces as _, letters in
// any script left as they are (তুষার_হোসেন), only characters that would break the address encoded.
function nameInPath(name) {
  return String(name || '').trim().replace(/ /g, '_').replace(/[%?#/&+\\]/g, (c) => encodeURIComponent(c));
}

module.exports = { formatDate, formatDateTime, userPath, eventPath, nameInPath };
