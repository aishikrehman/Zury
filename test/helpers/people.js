// Seeded accounts by role label (e.g. NAME.Organizer → their username), so
// tests don't depend on the display names used in the seed.
const { DEMO_USERS } = require('./fixtures');

const NAME = Object.fromEntries(DEMO_USERS.map((u) => [u.label, u.username]));
const LABEL = Object.fromEntries(DEMO_USERS.map((u) => [u.username, u.label]));

module.exports = { NAME, LABEL };
