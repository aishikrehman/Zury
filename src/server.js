const env = require('./config/env');
const app = require('./app');

app.listen(env.port, () => {
  console.log(`Zury is running at http://127.0.0.1:${env.port}`);
});
