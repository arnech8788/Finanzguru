// Finanzguru Push-Relay (Cloudflare Worker).
// Speichert NUR: Web-Push-Abo + vorberechnete Erinnerungen (Zeitpunkt + generischer Text).
// KEINE personenbezogenen Finanzdaten. Ein Cron-Trigger sendet fällige Erinnerungen.
import { buildPushPayload } from '@block65/webcrypto-web-push';

function cors(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}
function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json', ...cors(origin) } });
}
async function hashKey(endpoint) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/subscribe') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, origin); }
      const { subscription, reminders, tz } = body || {};
      if (!subscription || !subscription.endpoint) return json({ error: 'no subscription' }, 400, origin);
      const key = await hashKey(subscription.endpoint);
      const existing = await env.SUBS.get(key, 'json');
      const tags = new Set((reminders || []).map((r) => r.tag));
      const keptSent = (existing && Array.isArray(existing.sent) ? existing.sent : []).filter((t) => tags.has(t));
      await env.SUBS.put(key, JSON.stringify({ subscription, reminders: reminders || [], sent: keptSent, tz: tz || '', updated: Date.now() }));
      return json({ ok: true, reminders: (reminders || []).length }, 200, origin);
    }

    if (request.method === 'POST' && url.pathname === '/unsubscribe') {
      let body; try { body = await request.json(); } catch { body = {}; }
      if (body.endpoint) await env.SUBS.delete(await hashKey(body.endpoint));
      return json({ ok: true }, 200, origin);
    }

    // Einmaliger Test-Push nach delaySec Sekunden – zum Prüfen bei geschlossener App.
    // Sendet direkt (ohne KV/Cron), abgekoppelt von den echten Erinnerungen.
    if (request.method === 'POST' && url.pathname === '/test') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, origin); }
      const { subscription, delaySec } = body || {};
      if (!subscription || !subscription.endpoint) return json({ error: 'no subscription' }, 400, origin);
      const vapid = { subject: env.VAPID_SUBJECT || 'mailto:admin@example.com', publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
      if (!vapid.publicKey || !vapid.privateKey) return json({ error: 'vapid missing' }, 500, origin);
      const sec = Math.max(0, Math.min(30, Math.round(Number(delaySec) || 0)));
      ctx.waitUntil((async () => {
        if (sec > 0) await new Promise((r) => setTimeout(r, sec * 1000));
        try {
          const message = { data: JSON.stringify({ title: 'Finanzguru – Test', body: `Test-Push nach ${sec}s – Push funktioniert bei geschlossener App ✅`, tag: 'push-test', data: { url: '/' } }), options: { ttl: 60 } };
          const payload = await buildPushPayload(message, subscription, vapid);
          await fetch(subscription.endpoint, payload);
        } catch (e) { /* still: Test, kein Retry */ }
      })());
      return json({ ok: true, delaySec: sec }, 200, origin);
    }

    return new Response('Finanzguru push relay', { headers: cors(origin) });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDue(env));
  }
};

async function sendDue(env) {
  const vapid = {
    subject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  };
  if (!vapid.publicKey || !vapid.privateKey) { console.warn('VAPID keys missing'); return; }
  const now = Date.now();
  let cursor;
  do {
    const list = await env.SUBS.list({ cursor });
    cursor = list.list_complete ? undefined : list.cursor;
    for (const k of list.keys) {
      const rec = await env.SUBS.get(k.name, 'json');
      if (!rec) continue;
      const sent = new Set(rec.sent || []);
      let changed = false; let dead = false;
      for (const r of (rec.reminders || [])) {
        if (sent.has(r.tag)) continue;
        const at = new Date(r.at).getTime();
        if (at > now) continue;
        if (at < now - 3 * 864e5) { sent.add(r.tag); changed = true; continue; } // zu alt -> nicht mehr senden
        try {
          const message = { data: JSON.stringify({ title: r.title || 'Finanzguru', body: r.body || '', tag: r.tag, data: { url: '/' } }), options: { ttl: 24 * 3600 } };
          const payload = await buildPushPayload(message, rec.subscription, vapid);
          const res = await fetch(rec.subscription.endpoint, payload);
          if (res.status === 404 || res.status === 410) { dead = true; break; }
          sent.add(r.tag); changed = true;
        } catch (e) { /* beim nächsten Lauf erneut versuchen */ }
      }
      if (dead) await env.SUBS.delete(k.name);
      else if (changed) { rec.sent = [...sent]; await env.SUBS.put(k.name, JSON.stringify(rec)); }
    }
  } while (cursor);
}
