'use strict';
// ---------------------------------------------------------------------------
// Optional OpenRouter integration. Every call is non-blocking, rate limited,
// time-boxed, and has a scripted fallback so the game never waits on it.
// ---------------------------------------------------------------------------
const LLM = (() => {
  const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
  const DEFAULTS = { enabled: false, key: '', model: 'openai/gpt-4o-mini', interval: 18, killer: true, npc: true, debug: false };
  const cfg = Object.assign({}, DEFAULTS);
  const stats = { calls: 0, ok: 0, fail: 0, lastError: '', inflight: 0, lastMs: 0 };

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem('ahn_ai') || '{}');
      Object.assign(cfg, s);
    } catch (e) { /* storage unavailable */ }
  }
  function save() {
    try { localStorage.setItem('ahn_ai', JSON.stringify(cfg)); } catch (e) { /* storage unavailable */ }
  }
  function active() { return cfg.enabled && cfg.key && cfg.key.length > 10; }

  async function chat(messages, o = {}) {
    if (!active()) throw new Error('AI disabled');
    stats.calls++; stats.inflight++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeout || 12000);
    const t0 = performance.now();
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Authorization': 'Bearer ' + cfg.key,
          'Content-Type': 'application/json',
          'X-Title': "All Hallows' Night",
        },
        body: JSON.stringify({
          model: cfg.model || DEFAULTS.model,
          messages,
          max_tokens: o.max_tokens || 180,
          temperature: o.temperature == null ? 0.9 : o.temperature,
        }),
      });
      if (!res.ok) {
        let msg = res.status + ' ' + res.statusText;
        try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) { /* ignore */ }
        throw new Error(msg);
      }
      const j = await res.json();
      const text = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
      stats.ok++; stats.lastMs = Math.round(performance.now() - t0);
      return (text || '').trim();
    } catch (e) {
      stats.fail++; stats.lastError = e.name === 'AbortError' ? 'timeout' : e.message;
      throw e;
    } finally {
      clearTimeout(timer); stats.inflight--;
    }
  }

  // ---------------- killer director ----------------
  const TACTICS = ['stalk', 'ambush', 'cut_power', 'cut_phone', 'cut_streetlights', 'sabotage_car', 'hunt_resident', 'chase', 'patrol', 'evade_police', 'search'];
  async function director(profile, state) {
    const sys = `You are the tactical mind of ${profile.fullName} in a top-down horror survival game. Persona: ${profile.persona}
Pick the single best next tactic to terrify, isolate and eventually kill the survivor while staying in character.
Tactics:
- stalk: watch the survivor from darkness to build their fear (and your power)
- ambush: wait hidden where the survivor is likely heading. target = "car", "phone:<houseId>", "cruiser", or "house:<houseId>"
- cut_power: kill a house's electricity. target = "house:<houseId>"
- cut_phone: cut a house's phone line. target = "house:<houseId>"
- cut_streetlights: kill the street/camp lights
- sabotage_car: disable the escape car
- hunt_resident: kill a resident. target = "resident:<id>"
- chase: attack the survivor now
- search: search the area where the survivor was last seen
- patrol: roam
- evade_police: avoid the police
Reply with ONLY compact JSON: {"tactic":"...","target":"... or null","reason":"<12 words"}`;
    const txt = await chat([{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(state) }], { max_tokens: 90, temperature: 0.7, timeout: 10000 });
    const j = U.parseJSON(txt);
    if (!j || !TACTICS.includes(j.tactic)) throw new Error('bad director reply');
    return j;
  }

  // ---------------- residents ----------------
  async function resident(r, ctx, playerText) {
    const sys = `You are ${r.name}, a ${r.ageWord} living at ${ctx.address} in ${ctx.town}. Personality: ${r.persona.label}.
It is ${ctx.time} on ${ctx.date}. A masked killer (${ctx.killerDesc}) is loose, but you only know what is listed in FACTS.
Stay in character, speak like a real frightened person in a 70s-90s horror movie, 1-2 short sentences, no narration.
You may choose ONE action: "none", "follow" (go with the survivor), "stay" (lock up and hide), "call_police" (only if your phone works), "give_item" (hand over the item you have), "flee".
Respect your personality: skeptical/grumpy people need convincing; if you have seen the killer or are terrified you are more willing to follow.
Reply ONLY as JSON: {"say":"...","action":"...","trust_delta":-0.2..0.2}`;
    const facts = {
      your_fear: Math.round(r.fear * 100) + '%',
      trust_in_survivor: Math.round(r.trust * 100) + '%',
      seen_killer: r.mem.killerSeen ? `yes, ${Math.round(ctx.now - r.mem.killerT)}s ago near ${r.mem.killerPlace}` : 'no',
      your_phone_works: ctx.phoneWorks,
      lights_on_at_home: ctx.power,
      you_have_item: r.item ? ITEMS[r.item].name : 'nothing useful',
      you_know: r.knowledge,
      police: ctx.police,
      bodies_seen: r.mem.bodies,
      currently: r.state,
    };
    const msgs = [{ role: 'system', content: sys + '\nFACTS: ' + JSON.stringify(facts) }];
    for (const h of r.chat.slice(-6)) msgs.push(h);
    msgs.push({ role: 'user', content: playerText });
    const txt = await chat(msgs, { max_tokens: 140, temperature: 0.95, timeout: 12000 });
    const j = U.parseJSON(txt);
    if (j && j.say) return j;
    return { say: txt.replace(/[{}"]/g, '').slice(0, 220), action: 'none' };
  }

  async function oneLine(sys, user, maxTok = 60) {
    const t = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: maxTok, temperature: 1.0, timeout: 9000 });
    return t.replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0].slice(0, 200);
  }
  function ghostCall(ctx) {
    return oneLine(`You are Ghostface from Scream, calling the victim on the phone. Write ONE short, menacing, playful line (max 22 words). Reference what you can see or horror-movie trivia. No stage directions.`, JSON.stringify(ctx), 50);
  }
  function dispatch(ctx) {
    return oneLine('You are a small-town police dispatcher on the radio. Write ONE terse radio call (max 20 words) using police codes. No quotes.', JSON.stringify(ctx), 45);
  }
  function copBark(ctx) {
    return oneLine('You are a small-town cop in a slasher movie. Write ONE short shouted line (max 10 words) for this moment. No quotes.', JSON.stringify(ctx), 30);
  }

  async function test() {
    const t = await chat([{ role: 'user', content: 'Reply with the single word: ready' }], { max_tokens: 5, temperature: 0, timeout: 15000 });
    return t;
  }

  load();
  return { cfg, stats, load, save, active, chat, director, resident, ghostCall, dispatch, copBark, test, TACTICS };
})();
