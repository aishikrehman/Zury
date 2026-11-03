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

module.exports = { formatDate, formatDateTime, userPath };
