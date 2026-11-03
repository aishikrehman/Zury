const contestService = require('../services/contestService');

async function index(req, res, next) {
  try {
    const [active, upcoming, completed] = await Promise.all([
      contestService.listByGroup('active'),
      contestService.listByGroup('upcoming'),
      contestService.listByGroup('completed'),
    ]);
    res.render('pages/home', {
      title: 'Zury — Wikimedia Contests & Events',
      sections: [
        { key: 'active', heading: 'Active events', items: active, empty: 'No active events right now.' },
        { key: 'upcoming', heading: 'Upcoming events', items: upcoming, empty: 'No upcoming events yet.' },
        { key: 'completed', heading: 'Recently completed', items: completed, empty: 'No completed events yet.' },
      ],
    });
  } catch (err) {
    next(err);
  }
}

function about(req, res) {
  res.render('pages/about', { title: 'About — Zury' });
}

module.exports = { index, about };
