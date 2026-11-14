// Alliances in the browser: offer / accept / break buttons in the player list, incoming offers,
// and a warning before an order would attack an ally (going ahead breaks the alliance).

import { sendMsg } from './net.js';
import { escapeHtml } from './screens.js';
import { S, $, C, players } from './state.js';

// Is player id one of my allies?
function isAlly(id) {
  const me = players.get(S.myId);
  return !!me && !!me.allies && me.allies.includes(id);
}

// Whose is an order target? (0: nobody's)
function targetOwner(tg) {
  if (!tg) return 0;
  if (tg.k === 'c') return tg.id;
  if (tg.k === 't') return S.towers.get(tg.id)?.owner || 0;
  if (tg.k === 'u') return S.units.get(tg.id)?.owner || 0;
  return 0;
}

// ---- the "are you sure?" box
let box = null;
function confirmBox(html, yes, onYes) {
  if (!box) {
    box = document.createElement('div');
    box.id = 'confirm';
    box.innerHTML = '<div class="card"><div class="msg"></div><div class="btns"><button class="no">Cancel</button><button class="yes"></button></div></div>';
    document.body.appendChild(box);
    box.addEventListener('pointerdown', (e) => {
      if (e.target === box) closeConfirm();
    });
    box.querySelector('.no').onclick = closeConfirm;
  }
  box.querySelector('.msg').innerHTML = html;
  const y = box.querySelector('.yes');
  y.textContent = yes;
  y.onclick = () => {
    closeConfirm();
    onYes();
  };
  box.classList.add('show');
  y.focus();
}

function closeConfirm() {
  if (box) box.classList.remove('show');
}

const confirmOpen = () => !!box && box.classList.contains('show');

// Before sending an order: if it targets an ally, ask first. go() sends the order.
function checkAllyOrder(tg, go) {
  const owner = targetOwner(tg);
  if (!owner || owner === S.myId || !isAlly(owner)) {
    go();
    return;
  }
  const q = players.get(owner);
  const name = escapeHtml(q ? q.name : 'them');
  confirmBox(`<h3>⚔ Attack your ally?</h3><p><b>${name}</b> is your ally. Attacking breaks the alliance: your troops and towers will fight theirs again and you stop sharing vision.</p><p class="muted">Everyone sees who broke it${q && q.isBot ? ', and a betrayed bot won\'t trust you again' : ''}.</p>`,
    'Break alliance and attack', () => {
      sendMsg({ t: 'ally', op: 'break', id: owner });
      go();
    });
}

function breakWith(id) {
  const q = players.get(id);
  confirmBox(`<h3>Break the alliance with <b>${escapeHtml(q ? q.name : '?')}</b>?</h3><p>Your troops and towers will fight theirs again and you stop sharing vision.</p>`,
    'Break alliance', () => sendMsg({ t: 'ally', op: 'break', id }));
}

// The diplomacy button on a leaderboard row for player q.
function allyButton(q) {
  if (!S.me || S.spectating || q.id === S.myId) return '';
  const inOffer = (S.me.offersIn || []).includes(q.id);
  const outOffer = (S.me.offersOut || []).includes(q.id);
  if (isAlly(q.id)) return `<button class="dip ally" data-act="break" data-id="${q.id}" data-tip="Allied: you don't fight and you share vision. Click to break the alliance">🤝</button>`;
  if (inOffer) return `<button class="dip offer" data-act="accept" data-id="${q.id}" data-tip="${escapeHtml(q.name)} offers an alliance: click to accept">✓ Ally</button>`;
  if (outOffer) return '<button class="dip wait" disabled data-tip="Waiting for an answer">…</button>';
  const full = (players.get(S.myId)?.allies || []).length >= C.MAX_ALLIES;
  return `<button class="dip" data-act="propose" data-id="${q.id}"${full ? ' disabled' : ''} data-tip="${full ? `At most ${C.MAX_ALLIES} allies` : `Offer ${escapeHtml(q.name)} an alliance: you stop fighting each other and share vision`}">+🤝</button>`;
}

// Incoming offers, shown under the player list.
function offersHtml() {
  if (!S.me || S.spectating) return '';
  const list = (S.me.offersIn || []).map((id) => players.get(id)).filter(Boolean);
  if (!list.length) return '';
  return `<div class="offers">${list.map((q) => `<div class="offer-row"><span>🤝 <b>${escapeHtml(q.name)}</b> offers an alliance</span>
    <span><button class="dip offer" data-act="accept" data-id="${q.id}">Accept</button><button class="dip" data-act="decline" data-id="${q.id}">No</button></span></div>`).join('')}</div>`;
}

// One listener for the whole player list (its HTML is rebuilt every update, so act on press).
function initDiplomacy() {
  $('leaderboard').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button.dip');
    if (!b || b.disabled || !b.dataset.act) return;
    e.preventDefault();
    e.stopPropagation();
    const id = Number(b.dataset.id);
    if (b.dataset.act === 'break') breakWith(id);
    else sendMsg({ t: 'ally', op: b.dataset.act, id });
  });
}

// New offers get a toast once.
const seenOffers = new Set();
function newOffers(toast) {
  if (!S.me) return;
  for (const id of S.me.offersIn || []) {
    if (seenOffers.has(id)) continue;
    seenOffers.add(id);
    const q = players.get(id);
    if (q) toast(`🤝 ${q.name} offers an alliance: accept in the player list`, true);
  }
  for (const id of [...seenOffers]) if (!(S.me.offersIn || []).includes(id)) seenOffers.delete(id);
}

export { allyButton, checkAllyOrder, closeConfirm, confirmOpen, initDiplomacy, isAlly, newOffers, offersHtml };
