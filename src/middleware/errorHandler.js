function notFound(req, res) {
  res.status(404).render('pages/404', { title: 'Page Not Found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || 500;
  res.status(status).render('pages/error', {
    title: 'Something Went Wrong',
    message: status === 500 ? 'An unexpected error occurred.' : err.message,
  });
}

module.exports = { notFound, errorHandler };
