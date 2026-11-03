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
function eventPath(c) {
  if (c.series && c.edition) return `/${c.series.slug}/${c.edition}`;
  return c.slug ? `/${c.slug}` : `/contest/${c.id}`;
}

module.exports = { formatDate, formatDateTime, userPath, eventPath };
