// Site-wide features that administrators turn on or off (Admin → Features), and the numbers
// some of them use. Read from memory (refreshed on save and every minute), so pages stay quick.
const prisma = require('../config/prisma');

// key: [label, description, beta?, default]
const SWITCHES = {
  chat: ['Event chat', 'A chat button on event, series and edition pages; everyone’s room.', true, true],
  juryChat: ['Reviewers’ room', 'A private chat room for each event’s reviewers and organizers.', true, true],
  levelChat: ['Series and edition chat', 'A chat button on series and edition pages.', true, true],
  liveChat: ['Live chat', 'On: new messages arrive by themselves, with pop-ups and a dot at the inbox. Off: chats show only when opened (the chat box or the chats page); a refresh button brings new ones.', true, true],
  directMessages: ['Direct messages', 'People who share an event can write to each other.', true, true],
  inbox: ['Inbox', 'The chats page (/inbox) and the switch between notifications and chats.', true, true],
  toasts: ['Pop-up alerts', 'New notifications and messages pop up at the corner of the page.', true, true],
  massMessages: ['Mass messages', 'Organizers can send a message to many people, or make a MassMessage list on the wiki.', false, true],
  reminders: ['Deadline reminders', 'Participants hear three days and one day before an event ends.', false, true],
};
// key: [label, description, default, min, max]
const NUMBERS = {
  checkSeconds: ['How often pages check for news (seconds)', 'For pop-up alerts and the inbox count.', 45, 15, 600],
  oldEventDays: ['Chats of events that ended more than … days ago leave the lists', '', 90, 7, 3650],
  directDays: ['Direct messages are kept for … days', '', 90, 7, 3650],
};

let cache = null;
let loadedAt = 0;

async function load() {
  const rows = await prisma.siteSetting.findMany().catch(() => []);
  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out = {};
  for (const [k, def] of Object.entries(SWITCHES)) out[k] = raw[k] === undefined ? def[3] : raw[k] === 'on';
  for (const [k, def] of Object.entries(NUMBERS)) { const n = Number(raw[k]); out[k] = Number.isFinite(n) && n >= def[3] && n <= def[4] ? n : def[2]; }
  cache = out;
  loadedAt = Date.now();
  return out;
}

// All features (from memory; reloaded at most every minute).
async function all() {
  if (!cache || Date.now() - loadedAt > 60000) await load();
  return cache;
}
// The last known values without waiting (for code that cannot await); defaults before the first load.
function now() {
  if (!cache) { load().catch(() => {}); return Object.fromEntries([...Object.entries(SWITCHES).map(([k, d]) => [k, d[3]]), ...Object.entries(NUMBERS).map(([k, d]) => [k, d[2]])]); }
  if (Date.now() - loadedAt > 60000) load().catch(() => {});
  return cache;
}

async function save(body) {
  const ops = [];
  for (const k of Object.keys(SWITCHES)) if (body[k] === 'on' || body[k] === 'off') ops.push([k, body[k]]);
  for (const [k, def] of Object.entries(NUMBERS)) { const n = Math.round(Number(body[k])); if (Number.isFinite(n)) ops.push([k, String(Math.min(def[4], Math.max(def[3], n)))]); }
  for (const [key, value] of ops) await prisma.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  return load();
}

// Every page knows the features (res.locals.features).
async function middleware(req, res, next) {
  try { res.locals.features = await all(); } catch { res.locals.features = now(); }
  next();
}

module.exports = { SWITCHES, NUMBERS, all, now, save, middleware };
