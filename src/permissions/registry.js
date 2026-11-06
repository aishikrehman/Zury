// Single source of truth for permissions and the roles that bundle them.
// Controllers and templates refer to permission keys only, never to role names.

const PERMISSIONS = {
  createEvent: 'Create new events',
  deleteEvent: 'Delete this event',
  deleteOwnEvent: 'Delete events you organize',
  deleteAnyEvent: 'Delete any event',
  deleteAnything: 'Delete anything: series and editions with their events, single entries and reviews, accounts',
  editEvent: 'Edit this event',
  editOwnEvent: 'Edit events you organize',
  editAnyEvent: 'Edit any event',
  manageEvent: 'Manage this event',
  manageOwnEvent: 'Manage events you organize',
  manageAnyEvent: 'Manage any event',
  reviewEvent: 'See review progress for this event',
  reviewAnyEvent: 'See review progress for any event',
  submitEntry: 'Submit entries',
  submitOwnEntry: 'Submit your own entries',
  submitOthersEntry: 'Submit entries on behalf of others',
  reviewOwnEntry: 'Review your own entries',
  reviewAssignedEntry: 'Review entries assigned to you',
  reviewAnyEntry: 'Review any entry',
  manageJury: 'Manage the reviewers',
  manageParticipants: 'Manage participants',
  assignJury: 'Assign reviewers to entries',
  manageAssignments: 'Manage review assignments',
  viewSubmissions: 'View the submission list',
  viewOwnSubmissions: 'View your own submissions',
  viewAllSubmissions: 'View all submissions, including hidden ones',
  massSubmit: 'Submit many entries at once',
  massReview: 'Review many entries at once',
  createAppeal: 'Appeal a decision',
  reviewAppeal: 'Review appeals',
  manageAppeals: 'Manage appeals',
  sendNotifications: 'Send notifications',
  sendMassMessage: 'Send MassMessage campaigns',
  sendStatusMessage: 'Send status messages to participants',
  awardBadge: 'Award badges',
  publishResults: 'Publish results',
  viewStatistics: 'View statistics',
  exportData: 'Export data',
  importEvents: 'Import from Fountain and manage series and editions',
  accessAdmin: 'Open the Zury administration panel',
  viewDatabase: 'Look through the database (read only)',
  managePlatformRoles: 'Grant and revoke Zury roles',
  manageSiteConfig: 'Change Zury site configuration',
  viewAuditLog: 'View the audit log',
  // Superusers only (every permission): backups and clean-up.
  maintainSite: 'Back up the database and run maintenance',
};

// Holding the key on the left also grants the keys on the right.
const IMPLIES = {
  deleteAnyEvent: ['deleteEvent'],
  deleteOwnEvent: ['deleteEvent'],
  editAnyEvent: ['editEvent'],
  editOwnEvent: ['editEvent'],
  manageAnyEvent: ['manageEvent'],
  manageOwnEvent: ['manageEvent'],
  reviewAnyEvent: ['reviewEvent'],
  submitOwnEntry: ['submitEntry'],
  submitOthersEntry: ['submitEntry'],
  reviewAnyEntry: ['reviewAssignedEntry'],
  viewAllSubmissions: ['viewSubmissions', 'viewOwnSubmissions'],
  manageAppeals: ['reviewAppeal'],
  manageAssignments: ['assignJury'],
};

const EVENT_MANAGEMENT = [
  'manageJury',
  'manageParticipants',
  'assignJury',
  'manageAssignments',
  'viewAllSubmissions',
  'submitOthersEntry',
  'massSubmit',
  'manageAppeals',
  'sendNotifications',
  'sendMassMessage',
  'sendStatusMessage',
  'awardBadge',
  'publishResults',
  'viewStatistics',
  'exportData',
];

// source "wikimedia": derived from verified Wikimedia groups, never assignable in Zury.
// source "zury": assigned inside Zury by someone with managePlatformRoles.
// scope "wiki": applies only to events whose primary wiki is one where the group is held.
const PLATFORM_ROLES = {
  steward: {
    label: 'Steward',
    source: 'wikimedia',
    scope: 'global',
    description: 'Event authority across all communities.',
    permissions: ['createEvent', 'importEvents', 'editAnyEvent', 'manageAnyEvent', 'reviewAnyEvent', ...EVENT_MANAGEMENT],
  },
  'global-sysop': {
    label: 'Global Sysop',
    source: 'wikimedia',
    scope: 'global',
    description: 'Can manage events across communities.',
    permissions: ['createEvent', 'importEvents', 'editAnyEvent', 'manageAnyEvent', 'reviewAnyEvent', ...EVENT_MANAGEMENT],
  },
  'local-admin': {
    label: 'Local Admin',
    source: 'wikimedia',
    scope: 'wiki',
    description: 'Manages events whose primary wiki is one where they are an administrator.',
    permissions: ['editAnyEvent', 'manageAnyEvent', 'reviewAnyEvent', ...EVENT_MANAGEMENT],
    globalPermissions: ['createEvent', 'importEvents'],
  },
  // Every permission. Only grantable from the server command line, never the web UI.
  superuser: {
    label: 'Superuser',
    source: 'zury',
    scope: 'global',
    cliOnly: true,
    description: 'Full access to everything in Zury.',
    permissions: Object.keys(PERMISSIONS),
  },
  'platform-admin': {
    label: 'Zury Administrator',
    source: 'zury',
    scope: 'global',
    description: 'Trusted organizer who runs Zury: creates events on any wiki and, with Superuser, is the only one who can delete events, data and series.',
    permissions: ['createEvent', 'accessAdmin', 'deleteAnyEvent', 'managePlatformRoles', 'manageSiteConfig', 'viewAuditLog'],
  },
};

// Keys from Zury and Wikimedia roles that can't be handed out per event.
const NON_OVERRIDABLE = new Set([
  'viewDatabase',
  'createEvent',
  'importEvents',
  'deleteEvent',
  'deleteOwnEvent',
  'deleteAnyEvent',
  'editAnyEvent',
  'manageAnyEvent',
  'reviewAnyEvent',
  'accessAdmin',
  'managePlatformRoles',
  'manageSiteConfig',
  'viewAuditLog',
]);
const OVERRIDABLE_PERMISSIONS = Object.keys(PERMISSIONS).filter((p) => !NON_OVERRIDABLE.has(p));

// Which event permission is needed to add or remove each event role.
const ROLE_MANAGEMENT_PERMISSION = {
  organizer: 'manageEvent',
  jury: 'manageJury',
  participant: 'manageParticipants',
  viewer: 'manageParticipants',
};

const EVENT_ROLES = {
  organizer: {
    label: 'Organizer',
    plural: 'Organizers',
    description: 'Runs the event.',
    permissions: ['editOwnEvent', 'manageOwnEvent', 'reviewEvent', 'viewSubmissions', ...EVENT_MANAGEMENT],
  },
  jury: {
    label: 'Reviewers',
    plural: 'Reviewers',
    description: 'Reviews entries.',
    permissions: ['reviewEvent', 'reviewAssignedEntry', 'massReview', 'viewSubmissions', 'viewStatistics'],
  },
  participant: {
    label: 'Participant',
    plural: 'Participants',
    description: 'Submits entries.',
    permissions: ['submitOwnEntry', 'viewOwnSubmissions', 'createAppeal'],
  },
  viewer: {
    label: 'Viewer',
    plural: 'Viewers',
    description: 'Can follow a private event.',
    permissions: ['viewSubmissions'],
  },
};

// Wikimedia groups that map to platform roles. Only these are stored.
const GLOBAL_GROUP_ROLES = { steward: 'steward', 'global-sysop': 'global-sysop' };
const LOCAL_GROUP_ROLES = { sysop: 'local-admin' };

function validateRegistry() {
  const known = (key, where) => {
    if (!PERMISSIONS[key]) throw new Error(`Unknown permission "${key}" in ${where}`);
  };
  for (const [key, implied] of Object.entries(IMPLIES)) {
    known(key, 'IMPLIES');
    implied.forEach((p) => known(p, `IMPLIES.${key}`));
  }
  for (const [name, role] of Object.entries({ ...PLATFORM_ROLES, ...EVENT_ROLES })) {
    [...role.permissions, ...(role.globalPermissions || [])].forEach((p) => known(p, `role ${name}`));
  }
  for (const role of [...Object.values(GLOBAL_GROUP_ROLES), ...Object.values(LOCAL_GROUP_ROLES)]) {
    if (!PLATFORM_ROLES[role]) throw new Error(`Wiki group maps to unknown role "${role}"`);
  }
  NON_OVERRIDABLE.forEach((p) => known(p, 'NON_OVERRIDABLE'));
  for (const [role, permission] of Object.entries(ROLE_MANAGEMENT_PERMISSION)) {
    if (!EVENT_ROLES[role]) throw new Error(`Unknown event role "${role}" in ROLE_MANAGEMENT_PERMISSION`);
    known(permission, 'ROLE_MANAGEMENT_PERMISSION');
  }
}

validateRegistry();

module.exports = {
  PERMISSIONS,
  IMPLIES,
  PLATFORM_ROLES,
  EVENT_ROLES,
  GLOBAL_GROUP_ROLES,
  LOCAL_GROUP_ROLES,
  OVERRIDABLE_PERMISSIONS,
  ROLE_MANAGEMENT_PERMISSION,
  validateRegistry,
};
