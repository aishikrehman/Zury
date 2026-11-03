const messageService = require('../services/messageService');

const { MessageError } = messageService;
const listOf = (v) => String(v || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

function render(req, res, { form = {}, people = null, result = null, error = null, status = 200 }) {
  res.status(status).render('pages/contest/message', {
    title: `Message — ${req.contest.title}`,
    form: { audience: 'participant', method: 'talk', ...form },
    people,
    result,
    error,
    methods: messageService.METHODS,
    audiences: messageService.AUDIENCES,
    maxRecipients: messageService.MAX_RECIPIENTS,
    hasToken: !!req.session.wikimediaToken,
  });
}

const findPeople = (req, form) =>
  messageService.recipients({ contestId: req.contest.id, audience: form.audience, wiki: req.wikiScope?.wiki, usernames: listOf(form.only) });

async function form(req, res, next) {
  try {
    render(req, res, { people: await findPeople(req, { audience: 'participant' }) });
  } catch (err) {
    next(err);
  }
}

// "preview" shows who will get it; "send" sends.
async function send(req, res, next) {
  const f = { audience: req.body.audience, method: req.body.method, subject: req.body.subject, body: req.body.body, only: req.body.only };
  try {
    const people = await findPeople(req, f);
    if (req.body.step !== 'send') return render(req, res, { form: f, people });
    const result = await messageService.send({
      actor: req.user,
      accessToken: req.session.wikimediaToken,
      contest: req.contest,
      method: f.method,
      subject: f.subject,
      body: f.body,
      people,
      fallbackWiki: req.contextWiki?.wiki || req.contest.primaryWiki,
    });
    render(req, res, { form: f, people, result });
  } catch (err) {
    if (!(err instanceof MessageError)) return next(err);
    render(req, res, { form: f, error: err.message, status: 422 });
  }
}

module.exports = { form, send };
