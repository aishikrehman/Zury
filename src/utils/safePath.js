// A path inside this site, safe to redirect to: starts with one "/" and is not "//host" or
// "/\host" (browsers read both as another site), with no line breaks or control characters.
function isLocalPath(value) {
  return typeof value === 'string' && /^\/(?![\/\\])/.test(value) && !/[\u0000-\u001f\\]/.test(value);
}

const localOr = (value, fallback) => (isLocalPath(value) ? value : fallback);

module.exports = { isLocalPath, localOr };
