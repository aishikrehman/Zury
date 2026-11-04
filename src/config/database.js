// Where the database is. DATABASE_URL (mysql://user:password@host:3306/name), or on
// Toolforge ZURY_DB=toolsdb: the tool's ToolsDB account (TOOL_TOOLSDB_USER and
// TOOL_TOOLSDB_PASSWORD) and its database <user>__zury, composed here so the password
// stays in the tool's own variables.
if (process.env.ZURY_DB === 'toolsdb' && process.env.TOOL_TOOLSDB_USER && process.env.TOOL_TOOLSDB_PASSWORD) {
  const user = process.env.TOOL_TOOLSDB_USER;
  process.env.DATABASE_URL = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(process.env.TOOL_TOOLSDB_PASSWORD)}@tools.db.svc.wikimedia.cloud:3306/${user}__zury`;
}
module.exports = {};
