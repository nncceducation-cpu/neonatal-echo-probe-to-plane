// app.js - wire the anatomy, the slicer, the 3-D panel and the echo panel
// together, and put a probe in the user's hand.

import { buildStructures } from './geom.js';
import { sliceAll, loopInSector } from './slicer.js';
import { SectorView, SHORT } from './sector.js';
import { Scene3D } from './scene3d.js';
import { Probe } from './probe.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

const state = {
  anatomy: null, views: null, structures: null,
  scene: null, sector: null, probe: null,
  view: null, mode: 'guided', quiz: null, groups: null,
  highlight: new Set(),
};

async function boot() {
  const [anatomy, views] = await Promise.all([
    fetch('data/anatomy.json').then((r) => r.json()),
    fetch('data/views.json').then((r) => r.json()),
  ]);
  state.anatomy = anatomy;
  state.views = views;
  state.structures = buildStructures(anatomy);
  state.groups = new Set(['chamber', 'wall', 'valve', 'vessel', 'detail',
                          'flow', 'context']);

  state.scene = new Scene3D($('#c3d'), anatomy, state.structures);
  state.sector = new SectorView($('#c2d'));
  buildViewList();
  buildControls();
  selectView(views.views[0].id);
  window.addEventListener('resize', layout);
  layout();
  (function loop() {
    state.scene.render();
    requestAnimationFrame(loop);
  })();
}

// ------------------------------------------------------------------ view list
const WINDOW_ORDER = ['ps2', 'ps3', 'ps4', 'apical', 'subcostal', 'supra',
                      'high_ps'];
const WINDOW_GROUP = {
  ps2: 'Parasternal', ps3: 'Parasternal', ps4: 'Parasternal',
  apical: 'Apical', subcostal: 'Subcostal',
  supra: 'Suprasternal', high_ps: 'High parasternal',
};

function buildViewList() {
  const box = $('#views');
  box.innerHTML = '';
  const groups = new Map();
  for (const v of state.views.views) {
    const g = WINDOW_GROUP[v.window] || v.window;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(v);
  }
  const seen = new Set();
  for (const w of WINDOW_ORDER) {
    const g = WINDOW_GROUP[w];
    if (!g || seen.has(g) || !groups.has(g)) continue;
    seen.add(g);
    box.appendChild(el('div', 'grp', g));
    for (const v of groups.get(g)) {
      const b = el('button', 'vbtn', v.name);
      b.dataset.id = v.id;
      b.title = `${v.window_label} \u00b7 index ${v.index_toward}`;
      b.onclick = () => selectView(v.id);
      box.appendChild(b);
    }
  }
}

function selectView(id) {
  const v = state.views.views.find((x) => x.id === id);
  state.view = v;
  state.probe = new Probe(v);
  state.quiz = null;
  document.querySelectorAll('.vbtn').forEach((b) => {
    b.classList.toggle('on', b.dataset.id === id);
  });
  renderInfo();
  update();
}

// ------------------------------------------------------------------- controls
function buildControls() {
  $('#mode-guided').onclick = () => setMode('guided');
  $('#mode-free').onclick = () => setMode('free');
  $('#mode-quiz').onclick = () => setMode('quiz');

  const bind = (sel, fn) => { $(sel).onclick = () => { fn(); update(); }; };
  bind('#rot-ccw', () => state.probe.rotate(-7.5));
  bind('#rot-cw', () => state.probe.rotate(7.5));
  bind('#sweep-back', () => state.probe.sweep(-5));
  bind('#sweep-fwd', () => state.probe.sweep(5));
  bind('#rock-up', () => state.probe.rock(-5));
  bind('#rock-down', () => state.probe.rock(5));
  bind('#slide-l', () => state.probe.slide(0.3, 0));
  bind('#slide-r', () => state.probe.slide(-0.3, 0));
  bind('#slide-u', () => state.probe.slide(0, 0.3));
  bind('#slide-d', () => state.probe.slide(0, -0.3));
  bind('#reset', () => state.probe.load(state.view));

  $('#depth').oninput = (e) => {
    state.probe.setDepth(+e.target.value);
    $('#depth-val').textContent = `${(+e.target.value).toFixed(1)} cm`;
    update();
  };
  const toggle = (sel, key, obj) => {
    $(sel).onchange = (e) => { obj()[key] = e.target.checked; update(); };
  };
  toggle('#t-speckle', 'speckle', () => state.sector.opts);
  toggle('#t-labels', 'labels', () => state.sector.opts);
  toggle('#t-invert', 'invert', () => state.sector.opts);
  $('#t-cut').onchange = (e) => {
    state.scene.showCut = e.target.checked; update();
  };
  $('#t-axis').onchange = (e) => {
    state.scene.setAxisVisible(e.target.checked); update();
  };
  $('#t-torso').onchange = (e) => {
    state.scene.torso.visible = e.target.checked;
    state.scene.windowDots.visible = e.target.checked;
  };
  for (const g of ['chamber', 'valve', 'vessel', 'detail', 'context']) {
    const c = $(`#g-${g}`);
    if (c) c.onchange = (e) => {
      if (e.target.checked) state.groups.add(g); else state.groups.delete(g);
      if (g === 'chamber') {
        e.target.checked ? state.groups.add('wall') : state.groups.delete('wall');
      }
      state.scene.setVisibleGroups(state.groups);
      update();
    };
  }
  // keyboard: the same six manoeuvres, for people who would rather not click
  window.addEventListener('keydown', (ev) => {
    if (ev.target.tagName === 'INPUT') return;
    const k = ev.key.toLowerCase();
    const map = {
      q: () => state.probe.rotate(-7.5), e: () => state.probe.rotate(7.5),
      w: () => state.probe.sweep(-5), s: () => state.probe.sweep(5),
      a: () => state.probe.rock(-5), d: () => state.probe.rock(5),
      arrowleft: () => state.probe.slide(0.3, 0),
      arrowright: () => state.probe.slide(-0.3, 0),
      arrowup: () => state.probe.slide(0, 0.3),
      arrowdown: () => state.probe.slide(0, -0.3),
      r: () => state.probe.load(state.view),
    };
    if (map[k]) { ev.preventDefault(); map[k](); update(); }
  });
}

function setMode(m) {
  state.mode = m;
  document.querySelectorAll('.mbtn').forEach((b) => {
    b.classList.toggle('on', b.id === `mode-${m}`);
  });
  $('#panel-guided').style.display = m === 'guided' ? '' : 'none';
  $('#panel-free').style.display = m === 'free' ? '' : 'none';
  $('#panel-quiz').style.display = m === 'quiz' ? '' : 'none';
  if (m === 'quiz') newQuiz(); else state.quiz = null;
  if (m !== 'quiz') state.sector.opts.labels = $('#t-labels').checked;
  update();
}

// ---------------------------------------------------------------------- quiz
function newQuiz() {
  const pool = state.views.views;
  const answer = pool[Math.floor(Math.random() * pool.length)];
  const choices = [answer];
  while (choices.length < 4) {
    const c = pool[Math.floor(Math.random() * pool.length)];
    if (!choices.includes(c)) choices.push(c);
  }
  choices.sort(() => Math.random() - 0.5);
  state.quiz = { answer, choices, done: false };
  state.view = answer;
  state.probe = new Probe(answer);
  state.sector.opts.labels = false;
  const box = $('#quiz-choices');
  box.innerHTML = '';
  for (const c of choices) {
    const b = el('button', 'qbtn', c.name);
    b.onclick = () => {
      if (state.quiz.done) return;
      state.quiz.done = true;
      const right = c.id === answer.id;
      b.classList.add(right ? 'right' : 'wrong');
      if (!right) {
        [...box.children].find((x) => x.textContent === answer.name)
          ?.classList.add('right');
      }
      $('#quiz-msg').textContent = right
        ? 'Correct.'
        : `That is the ${c.name}. This is the ${answer.name}.`;
      $('#quiz-explain').textContent = answer.manoeuvre;
      state.sector.opts.labels = true;
      update();
    };
    box.appendChild(b);
  }
  $('#quiz-msg').textContent = 'Which view is this?';
  $('#quiz-explain').textContent = '';
  update();
}

// -------------------------------------------------------------------- render
function update() {
  const p = state.probe, v = state.view;
  const plane = p.plane();
  const view = { ...v, depth: p.depth, sector: p.sector };
  const slices = sliceAll(state.structures, plane)
    .filter((r) => state.groups.has(r.group));
  state.scene.setProbe(p.contact, p.beam, p.index);
  state.scene.setPlane(plane, slices, view);
  state.sector.draw(slices, view, { highlight: state.highlight });

  const visible = slices.filter((r) => r.outer.concat(r.cavity)
    .some((l) => loopInSector(l, p.depth, p.sector)));
  $('#seen').innerHTML = '';
  for (const r of visible.filter((x) => x.group !== 'context')) {
    const t = el('span', 'chip', SHORT[r.id] || r.id);
    t.onmouseenter = () => { state.highlight = new Set([r.id]); update(); };
    t.onmouseleave = () => { state.highlight = new Set(); update(); };
    $('#seen').appendChild(t);
  }

  const dv = p.deviation(v);
  $('#dev').textContent = state.mode === 'quiz' ? ''
    : `plane ${dv.plane_deg}\u00b0 \u00b7 beam ${dv.beam_deg}\u00b0 \u00b7 `
      + `rotation ${dv.index_deg}\u00b0 \u00b7 contact ${dv.contact_mm} mm`;
  $('#advice').textContent = state.mode === 'free' ? p.advice(v) : '';
  const near = state.mode === 'free' ? p.nearest(state.views.views) : null;
  $('#nearest').textContent = near
    ? `closest standard view: ${near.view.name} (${near.dv.plane_deg}\u00b0 off)`
    : '';
}

function renderInfo() {
  const v = state.view;
  $('#vname').textContent = v.name;
  $('#vwindow').textContent = v.window_label;
  const m = v.metrics;
  const bits = [`section: ${v.section.replace(/_/g, ' ')}`,
                `index mark ${v.index_toward}`,
                `depth ${v.depth} cm`, `sector ${v.sector}\u00b0`];
  if (v.clock_stated) bits.push(`stated pointer position ${v.clock_stated}`);
  if (m.phi_from_plax_deg != null) {
    bits.push(`rotation about the long axis: ${m.phi_from_plax_deg}\u00b0 from PLAX`);
  }
  if (m.level_from_apex_mm != null) {
    bits.push(`level: ${m.level_from_apex_mm} mm from the apex`);
  }
  if (m.window_shift_mm > 0.5) {
    bits.push(`window sits ${m.window_shift_mm} mm off the nominal landmark`);
  }
  $('#vmeta').textContent = bits.join(' \u00b7 ');
  $('#vman').textContent = v.manoeuvre;
  $('#vpit').textContent = v.pitfall;
  const lim = $('#vlim');
  lim.style.display = v.limitation ? '' : 'none';
  lim.textContent = v.limitation || '';
  const src = $('#vsrc');
  src.style.display = v.source ? '' : 'none';
  src.textContent = v.source ? `Source: ${v.source}` : '';
  const t = $('#vteach');
  t.innerHTML = '';
  for (const x of v.teaches) t.appendChild(el('li', null, x));
  $('#depth').value = v.depth;
  $('#depth-val').textContent = `${v.depth.toFixed(1)} cm`;
}

function layout() {
  const a = $('#stage3d');
  state.scene.resize(a.clientWidth, a.clientHeight);
  const c = $('#c2d');
  const box = $('#stage2d');
  const r = Math.min(2, window.devicePixelRatio || 1);
  c.width = box.clientWidth * r;
  c.height = box.clientHeight * r;
  c.style.width = `${box.clientWidth}px`;
  c.style.height = `${box.clientHeight}px`;
  if (state.view) update();
}

boot();
