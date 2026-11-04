// Profile pictures come from Wikimedia Commons: the person types a file name and Zury
// stores the link to a small thumbnail of it (nothing is copied).
const env = require('../config/env');

class AvatarError extends Error {}

const clean = (name) => String(name || '').trim().replace(/^https?:\/\/commons\.wikimedia\.org\/wiki\//i, '').replace(/^(File|Image|ফাইল):/i, '').replace(/_/g, ' ').trim();

async function thumbnailFor(fileName, width = 160) {
  const name = clean(fileName);
  if (!name || name.length > 240) throw new AvatarError('Type the name of a file on Commons, e.g. Example.jpg.');
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url|mime&iiurlwidth=${width}&titles=${encodeURIComponent('File:' + name)}`;
  let page;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': env.userAgent }, signal: AbortSignal.timeout(10000) });
    page = (await res.json()).query?.pages?.[0];
  } catch {
    throw new AvatarError("Commons didn't answer; try again in a moment.");
  }
  const info = page?.imageinfo?.[0];
  if (!page || page.missing || !info) throw new AvatarError(`There is no file called “${name}” on Commons.`);
  if (!/^image\//.test(info.mime || '')) throw new AvatarError('That file is not a picture.');
  return { name, url: info.thumburl || info.url };
}

module.exports = { thumbnailFor, AvatarError, clean };
