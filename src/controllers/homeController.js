function index(req, res) {
  res.render('pages/home', {
    title: 'Zury — Wikimedia Contests & Events',
  });
}

function about(req, res) {
  res.render('pages/about', {
    title: 'About — Zury',
  });
}

module.exports = { index, about };
