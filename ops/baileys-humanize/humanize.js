// humanize.js — randomized delay + typing indicator wrapper around
// Baileys' sock.sendMessage. Use sendHuman(sock, jid, content, opts?)
// in place of sock.sendMessage; opts.urgent=true bypasses the delay.

const HUMANIZE = process.env.HANU_HUMANIZE !== 'off';

function randInt(lo, hi) {
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function computeDelayMs(text) {
  const len = (text || '').length;
  const baseMs = randInt(1500, 2500);           // 1.5–2.5s base
  const perCharMs = randInt(20, 40);            // 20–40ms per char
  return Math.min(baseMs + Math.min(len * perCharMs, 4000), 6000);
}

async function sendHuman(sock, jid, content, opts = {}) {
  if (!HUMANIZE || opts.urgent) {
    return sock.sendMessage(jid, content);
  }
  const text = (content && content.text) || '';
  const delayMs = computeDelayMs(text);
  try {
    await sock.sendPresenceUpdate('composing', jid);
  } catch (_) { /* presence is best-effort */ }
  console.log(`[hanu-baileys] typing for ${delayMs}ms before send to ${jid}`);
  await new Promise(r => setTimeout(r, delayMs));
  try {
    await sock.sendPresenceUpdate('paused', jid);
  } catch (_) { /* same */ }
  return sock.sendMessage(jid, content);
}

module.exports = { sendHuman, computeDelayMs };
