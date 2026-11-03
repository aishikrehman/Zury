const CONTEST_TYPES = {
  photo: 'Photo contest',
  writing: 'Writing contest',
  data: 'Data contest',
  editathon: 'Edit-a-thon',
};

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

module.exports = { CONTEST_TYPES, CONTEST_STATUSES, STATUS_GROUPS, SUBMISSION_STATUSES };
