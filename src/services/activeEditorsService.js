// Active editors of a wiki over a period (bots left out), for mass messages and lists.
// On Toolforge the wiki's database replica answers for any period; elsewhere (no replica
// credentials) the API's list of active users is used, which only knows the last 30 days.
// Like XTools and Quarry, any other period is counted from the replica only. For local work, an SSH
// tunnel to the replica can be named with TOOL_REPLICA_HOST and TOOL_REPLICA_PORT.
const wikiApi = require('../wiki/wikiApi');

const MAX = 5000;
// Names that look like bots, flagged or not: "bot" not followed by a letter ("AishikBot", "Bot X",
// "Cyberbot II", "JhsBot2", "x_bot"), or "বট". "Botanist", "Abbott" and "RobotLab" are kept.
const BOT_NAME = /bot(?![a-z])|বট/i;
const notBotName = (p) => !BOT_NAME.test(p.username);
const DBNAME = /^[a-z0-9_]{2,40}$/;

function replicaReady() {
  return !!(process.env.TOOL_REPLICA_USER && process.env.TOOL_REPLICA_PASSWORD) || !!process.env.REPLICA_SSH;
}

// The SQL, shared by both ways in. wiki is checked against DBNAME; the numbers are numbers.
const SQL = (since, minEdits, max) => `SELECT x.name, x.edits,
        x.uid IN (SELECT ug_user FROM user_groups WHERE ug_group = 'bot') AS bot,
        x.uid IN (SELECT ufg_user FROM user_former_groups WHERE ufg_group = 'bot') AS formerBot
   FROM (SELECT a.actor_name AS name, a.actor_user AS uid, COUNT(*) AS edits
           FROM revision_userindex r JOIN actor_revision a ON a.actor_id = r.rev_actor
          WHERE r.rev_timestamp >= '${since}' AND a.actor_user IS NOT NULL AND a.actor_name NOT LIKE '~%'
          GROUP BY a.actor_user, a.actor_name HAVING edits >= ${Number(minEdits)} ORDER BY edits DESC LIMIT ${Number(max)}) x`;
const toRow = (name, edits, bot, formerBot) => ({ username: String(name), edits: Number(edits), why: Number(bot) ? 'Bot flag' : Number(formerBot) ? 'Was a bot' : !notBotName({ username: String(name) }) ? 'Bot-like name' : null });

// Local work: the same replica, reached by running the query on Toolforge over SSH
// (REPLICA_SSH=user@dev.toolforge.org, the tool's own replica.my.cnf; no password here).
function fromSsh(wiki, days, minEdits) {
  const since = new Date(Date.now() - days * 86400000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const sql = 'SET SESSION max_statement_time = 120; ' + SQL(since, minEdits, MAX).replace(/\s+/g, ' ');
  const cmd = `mariadb --defaults-file=$HOME/replica.my.cnf -h ${wiki}.analytics.db.svc.wikimedia.cloud ${wiki}_p -B -N -e "${sql}"\n`;
  return new Promise((resolve, reject) => {
    const p = require('child_process').spawn('ssh', ['-o', 'BatchMode=yes', process.env.REPLICA_SSH, `sudo -niu ${process.env.REPLICA_SSH_TOOL || 'tools.zury'} bash -l`]);
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => p.kill(), 180000);
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('The wiki database could not be read: ' + (err.trim().split('\n').pop() || 'code ' + code)));
      resolve(out.split('\n').filter(Boolean).map((l) => toRow(...l.split('\t'))));
    });
    p.stdin.end(cmd);
  });
}

async function fromReplica(wiki, days, minEdits) {
  if (!(process.env.TOOL_REPLICA_USER && process.env.TOOL_REPLICA_PASSWORD)) return fromSsh(wiki, days, minEdits);
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.TOOL_REPLICA_HOST || `${wiki}.analytics.db.svc.wikimedia.cloud`, port: Number(process.env.TOOL_REPLICA_PORT) || 3306, user: process.env.TOOL_REPLICA_USER, password: process.env.TOOL_REPLICA_PASSWORD,
    database: `${wiki}_p`, connectTimeout: 15000,
  });
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
    await conn.query('SET SESSION max_statement_time = 120');
    const [rows] = await conn.query(
      // Counted per person first; the bot checks then run once per person, not once per edit.
      `SELECT x.name, x.edits,
              x.uid IN (SELECT ug_user FROM user_groups WHERE ug_group = 'bot') AS bot,
              x.uid IN (SELECT ufg_user FROM user_former_groups WHERE ufg_group = 'bot') AS formerBot
         FROM (SELECT a.actor_name AS name, a.actor_user AS uid, COUNT(*) AS edits
                 FROM revision_userindex r JOIN actor_revision a ON a.actor_id = r.rev_actor
                WHERE r.rev_timestamp >= ? AND a.actor_user IS NOT NULL AND a.actor_name NOT LIKE '~%'
                GROUP BY a.actor_user, a.actor_name HAVING edits >= ? ORDER BY edits DESC LIMIT ?) x`,
      [since, minEdits, MAX],
    );
    return rows.map((r) => ({ username: String(r.name), edits: Number(r.edits), why: Number(r.bot) ? 'Bot flag' : Number(r.formerBot) ? 'Was a bot' : !notBotName({ username: String(r.name) }) ? 'Bot-like name' : null }));
  } finally {
    await conn.end().catch(() => {});
  }
}

async function fromApi(wiki, minEdits) {
  const out = [];
  let cont = {};
  for (let i = 0; i < 20 && out.length < MAX; i += 1) {
    const d = await wikiApi.get(wiki, { action: 'query', list: 'allusers', auactiveusers: '1', auprop: 'groups', aulimit: 'max', ...cont });
    for (const u of d.query?.allusers || []) {
      if ((u.recentactions || 0) >= minEdits) out.push({ username: u.name, edits: u.recentactions || 0, why: (u.groups || []).includes('bot') ? 'Bot flag' : !notBotName({ username: u.name }) ? 'Bot-like name' : null });
    }
    if (!d.continue) break;
    cont = d.continue;
  }
  return out.sort((a, b) => b.edits - a.edits).slice(0, MAX);
}

// { people: [{ username, edits }], left: [{ username, edits, why }], days, source: 'replica' | 'api' }
// Kept 30 minutes, so moving between the steps of /mass does not ask again.
const activeEditorsKept = new Map();
async function activeEditors(...args) {
  const key = JSON.stringify(args[0]);
  const hit = activeEditorsKept.get(key);
  if (hit && Date.now() - hit.at < 1800000) return hit.value;
  const value = await activeEditorsFresh(...args);
  if (activeEditorsKept.size > 50) activeEditorsKept.delete(activeEditorsKept.keys().next().value);
  activeEditorsKept.set(key, { at: Date.now(), value });
  return value;
}

async function activeEditorsFresh({ wiki, days = 365, minEdits = 1 }) {
  if (!DBNAME.test(String(wiki || ''))) throw new Error('Choose a wiki.');
  days = Math.min(3650, Math.max(1, Number(days) || 365));
  minEdits = Math.min(100000, Math.max(1, Number(minEdits) || 1));
  if (!replicaReady() && days !== 30) throw new Error('Only the last 30 days can be counted here; other periods need the Wikimedia database, which works on Toolforge.');
  const all = replicaReady() ? await fromReplica(wiki, days, minEdits) : await fromApi(wiki, minEdits);
  return { people: all.filter((p) => !p.why), left: all.filter((p) => p.why), days, source: replicaReady() ? 'replica' : 'api' };
}

module.exports = { activeEditors, replicaReady };
