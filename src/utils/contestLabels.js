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

module.exports = { CONTEST_TYPES, CONTEST_STATUSES, STATUS_GROUPS };
