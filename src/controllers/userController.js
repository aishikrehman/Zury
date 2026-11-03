const userService = require('../services/userService');

async function showProfile(req, res, next) {
  try {
    const profileUser = await userService.findByUsername(req.params.username);
    if (!profileUser || profileUser.status !== 'active') {
      return res.status(404).render('pages/404', { title: 'User Not Found' });
    }
    res.render('pages/users/profile', {
      title: `${profileUser.username} — Zury`,
      profileUser,
      isOwnProfile: req.user?.id === profileUser.id,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { showProfile };
