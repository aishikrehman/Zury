// Refreshes the wiki and language catalog from Meta-Wiki's sitematrix.
require('dotenv').config();
const prisma = require('../src/config/prisma');
const { syncSitematrix } = require('../src/wiki/catalogService');

syncSitematrix()
  .then(({ wikis, languages }) => console.log(`Stored ${wikis} wikis and ${languages} languages.`))
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
