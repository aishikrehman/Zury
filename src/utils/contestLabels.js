const CONTEST_TYPES = {
  photo: 'Photo contest',
  writing: 'Writing contest',
  data: 'Data contest',
  editathon: 'Edit-a-thon',
  workshop: 'Workshop',
  training: 'Training',
  photowalk: 'Photowalk',
};
const TYPE_ICONS = { photo: 'photo', writing: 'writing', data: 'database', editathon: 'users-group', workshop: 'presentation', training: 'school', photowalk: 'walk' };
const TYPE_COLORS = { photo: 'blue', writing: 'green', data: 'purple', editathon: 'orange', workshop: 'teal', training: 'cyan', photowalk: 'pink' };
// What an event is about, for browsing and reports.
const PROJECT_CATEGORIES = {
  glam: 'GLAM (galleries, libraries, archives, museums)',
  education: 'Education',
  heritage: 'Heritage and monuments',
  nature: 'Nature and environment',
  culture: 'Arts and culture',
  gender: 'Gender gap and diversity',
  science: 'Science and technology',
  health: 'Health and medicine',
  history: 'History',
  geography: 'Places and geography',
  language: 'Language and literature',
  sports: 'Sports',
  community: 'Community building',
  other: 'Other',
};
// Activities are run as sessions people attend, rather than as contests.
const ACTIVITY_TYPES = ['workshop', 'training', 'photowalk'];

const CONTEST_STATUSES = {
  draft: { label: 'Draft', badge: 'secondary' },
  published: { label: 'Published', badge: 'info' },
  upcoming: { label: 'Upcoming', badge: 'info' },
  active: { label: 'Active', badge: 'success' },
  submission_closed: { label: 'Submission closed', badge: 'warning' },
  under_review: { label: 'Under review', badge: 'warning' },
  completed: { label: 'Completed', badge: 'dark' },
  archived: { label: 'Archived', badge: 'light' },
  cancelled: { label: 'Cancelled', badge: 'danger' },
};

// Groupings used by listings (/events/active etc.).
const STATUS_GROUPS = {
  active: ['active', 'submission_closed', 'under_review'],
  upcoming: ['published', 'upcoming'],
  completed: ['completed', 'archived'],
};

const SUBMISSION_STATUSES = {
  pending: { label: 'Pending', color: 'secondary' },
  validated: { label: 'Validated', color: 'azure' },
  invalid: { label: 'Invalid', color: 'red' },
  under_review: { label: 'Under review', color: 'yellow' },
  approved: { label: 'Approved', color: 'green' },
  rejected: { label: 'Rejected', color: 'orange' },
  disqualified: { label: 'Disqualified', color: 'red' },
  withdrawn: { label: 'Withdrawn', color: 'secondary' },
  appealed: { label: 'Appealed', color: 'purple' },
};

module.exports = { PROJECT_CATEGORIES, CONTEST_TYPES, TYPE_ICONS, TYPE_COLORS, ACTIVITY_TYPES, CONTEST_STATUSES, STATUS_GROUPS, SUBMISSION_STATUSES };
