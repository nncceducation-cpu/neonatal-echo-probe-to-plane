// app.js - wire the anatomy, the slicer, the 3-D panel and the echo panel
// together, and put a probe in the user's hand.

import { buildStructures } from './geom.js?v=20260929-8';
import { sliceAll, loopInSector } from './slicer.js?v=20260929-8';
import { SectorView, SHORT } from './sector.js?v=20260929-8';
import { Scene3D } from './scene3d.js?v=20260929-8';
import { Probe } from './probe.js?v=20260929-8';
import { RegisteredHeart } from './registered-heart.js?v=20260929-8';
import { echoReferences, referenceMatches } from './echo-references.js?v=20260929-8';

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
  highlight: new Set(), registered: null,
  autoFitEcho: true,
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
  state.scene.attachOverview($('#c-torso'));
  state.sector = new SectorView($('#c2d'));
  try {
    state.registered = await RegisteredHeart.load();
    state.views.views = state.views.views.map(view => state.registered.adaptView(view));
    state.scene.useRegistered(state.registered, state.groups);
    $('#anatomy-source').textContent = 'Registered anatomical mesh + chamber volume';
    $('#t-labels').checked = false;
    $('#t-labels').disabled = true;
    $('#g-context').checked = false;
    $('#g-context').disabled = true;
  } catch (error) {
    console.warn('Registered heart unavailable; using schematic anatomy', error);
    $('#anatomy-source').textContent = 'Schematic anatomy fallback';
  }
  try {
    await state.scene.loadSurface();
    $('#anatomy-source').textContent = 'Textured neonatal surface · UMCG';
  } catch (error) {
    console.warn('Textured neonatal surface could not load', error);
    $('#anatomy-source').textContent = 'Surface unavailable — anatomical mesh shown';
  }
  buildViewList();
  buildControls();
  selectView(views.views[0].id, true);
  window.addEventListener('resize', layout);
  const resizeObserver = new ResizeObserver(() => layout());
  resizeObserver.observe($('#stage3d'));
  resizeObserver.observe($('#stage2d'));
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

function selectView(id, initial = false) {
  const v = state.views.views.find((x) => x.id === id);
  state.view = v;
  state.probe = new Probe(v);
  state.autoFitEcho = true;
  state.quiz = null;
  if (!initial) activateSection();
  document.querySelectorAll('.vbtn').forEach((b) => {
    b.classList.toggle('on', b.dataset.id === id);
  });
  renderInfo();
  showReference(id);
  if (!initial && echoReferences[id] && state.mode !== 'quiz') {
    $('#stage2d').classList.add('reference-mode');
    $('#echo-study-video').play().catch(() => {
      // Native video controls remain available if autoplay is blocked.
    });
  }
  update();
  state.scene.focusPlane(state.probe.plane());
}

function activateSection() {
  $('#echo-study-video')?.pause();
  $('#stage2d').classList.remove('reference-mode');
  if ($('.echo-reference-toggle') && !$('.echo-reference-toggle').disabled)
    $('.echo-reference-toggle').textContent = 'Show clinical reference';
  const changed = !state.scene.showCut;
  state.scene.showCut = true;
  $('#t-cut').checked = true;
  $('#surface-credit').hidden = true;
  $('#anatomy-source').textContent = 'Section anatomy · right blue / left red';
  return changed;
}

function showReference(id) {
  const ref = echoReferences[id], box = $('#scan-reference');
  const video = $('#echo-study-video');
  video.pause();
  video.removeAttribute('src');
  const button = $('.echo-reference-toggle');
  if (button) {
    button.disabled = !ref;
    button.textContent = ref ? 'Play matched echo study' : 'No reviewed clip for this view';
  }
  $('#stage2d').classList.remove('reference-mode');
  box.hidden = !ref;
  if (!ref) {video.load(); return;}
  video.src = `assets/echo-studies/${ref.file}`;
  video.setAttribute('aria-label',ref.title);
  $('#scan-reference-caption').textContent = `${ref.title} · ${ref.source}`;
  $('#scan-reference small').textContent = `${ref.landmarks} Separate recorded study, not a patient-matched reconstruction or tracked sweep.`;
  $('#echo-source-link').href = `https://drive.google.com/file/d/${ref.id}/view`;
}

// ------------------------------------------------------------------- controls
function buildControls() {
  for (const id of ['slide-l','slide-r','slide-u','slide-d']) {
    $(`#${id}`).disabled = true;
    $(`#${id}`).title = 'Contact locked to the selected acoustic window';
  }
  $('#slide-l').parentElement.hidden = true;
  const gestureHelp = el('p', 'gesture-help', 'Contact locked · Drag up/down to sweep; left/right to rotate. Scroll or use two fingers to sweep.');
  $('#panel-free').prepend(gestureHelp);
  const canvas = $('#c3d');
  const orientation = el('span','patient-orientation','Supine · overhead · head ↑');
  $('#stage3d').append(orientation);
  const modeButton = el('button', 'surface-view gesture-toggle', 'Mouse: slice');
  $('#stage3d').append(modeButton);
  let slicing = true, drag = null;
  state.scene.controls.enabled = false;
  modeButton.onclick = () => {
    slicing = !slicing; state.scene.controls.enabled = !slicing;
    state.scene.followCut = slicing;
    modeButton.textContent = slicing ? 'Mouse: slice' : 'Mouse: orbit';
    update();
  };
  const move = (sweep, rotation) => {
    activateSection(); state.probe.sweep(sweep); state.probe.rotate(rotation); update();
  };
  for (const canvas of [$('#c3d'),$('#c-torso')]) {
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => {
    if (!slicing || e.button !== 0) return;
    drag = {x:e.clientX,y:e.clientY}; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    move((e.clientY-drag.y)*.15,(e.clientX-drag.x)*.15);
    drag = {x:e.clientX,y:e.clientY};
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(type, () => {drag=null;});
  canvas.addEventListener('wheel', e => {
    if (!slicing) return;
    e.preventDefault(); move(Math.max(-3,Math.min(3,e.deltaY*.035)),0);
  }, {passive:false});
  }
  const reference = $('#scan-reference');
  $('#scan-reference-image').remove();
  const video = el('video');
  video.id = 'echo-study-video'; video.controls = true; video.loop = true;
  video.muted = true; video.playsInline = true; video.preload = 'metadata';
  reference.prepend(video);
  const sourceLink = el('a', 'echo-source-link', 'Open original study');
  sourceLink.id = 'echo-source-link'; sourceLink.target = '_blank'; sourceLink.rel = 'noopener';
  reference.append(sourceLink);
  video.onerror = () => {
    $('#scan-reference small').textContent = 'This local clip could not load. Open the original study below.';
  };
  $('#stage2d').append(reference);
  const echoToolbar = el('div','echo-toolbar');
  const referenceButton = el('button','echo-reference-toggle','▶ Clinical clip');
  const fitButton = el('button','echo-fit','Fit whole section');
  fitButton.onclick = () => { state.autoFitEcho = true; update(); };
  echoToolbar.append(referenceButton,fitButton);
  $('#stage2d').prepend(echoToolbar);
  referenceButton.onclick = () => {
    if (!echoReferences[state.view.id]) return;
    if (!referenceMatches(state.probe,state.view)) {
      state.probe.load(state.view); state.autoFitEcho = true;
    }
    state.scene.showCut = true;
    $('#t-cut').checked = true;
    $('#surface-credit').hidden = true;
    const on = $('#stage2d').classList.toggle('reference-mode');
    if (on) video.play().catch(() => {}); else video.pause();
    update();
  };
  const tools = $('#panel-free');
  $('#side-right').insertBefore(tools, $('#vmeta'));
  tools.style.display = '';
  const depth = $('#depth');
  const heading = depth.previousElementSibling;
  const output = $('#depth-val');
  tools.append(heading, depth, output);
  $('#mode-guided').onclick = () => setMode('guided');
  $('#mode-free').onclick = () => setMode('free');
  $('#mode-quiz').onclick = () => setMode('quiz');
  $('#quiz-next').onclick = () => newQuiz();
  $('#camera-home').onclick = () => state.scene.focusPlane(state.probe.plane());
  for (const name of ['views', 'controls']) {
    $(`#panel-${name}`).onclick = () => {
      const open = !document.body.classList.contains(`open-${name}`);
      for (const other of ['views', 'controls']) {
        document.body.classList.toggle(`open-${other}`, open && other === name);
        $(`#panel-${other}`).setAttribute('aria-expanded', String(open && other === name));
      }
    };
  }
  $('#surface-view').onclick = () => {
    $('#echo-study-video').pause();
    $('#stage2d').classList.remove('reference-mode');
    state.probe.load(state.view);
    state.autoFitEcho = true;
    document.body.classList.add('open-views');
    document.body.classList.remove('open-controls');
    $('#panel-views').setAttribute('aria-expanded','true');
    $('#panel-controls').setAttribute('aria-expanded','false');
    $('#t-cut').checked = false;
    $('#t-cut').onchange({target: $('#t-cut')});
  };

  const bind = (sel, fn) => { $(sel).onclick = () => {
    const changed = activateSection(); fn(); update();
    if (changed) state.scene.focusPlane(state.probe.plane());
  }; };
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
    state.autoFitEcho = false;
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
    state.scene.focusPlane(state.probe.plane());
    $('#anatomy-source').textContent = e.target.checked
      ? 'Section anatomy · right blue / left red'
      : state.scene.surface ? 'Textured neonatal surface · UMCG' : 'Anatomical mesh';
    $('#surface-credit').hidden = e.target.checked || !state.scene.surface;
  };
  $('#t-axis').onchange = (e) => {
    state.scene.setAxisVisible(e.target.checked); update();
  };
  $('#t-torso').onchange = (e) => {
    state.scene.showTorso = e.target.checked;
    update();
    state.scene.focusPlane(state.probe.plane());
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
      arrowleft: () => state.probe.rotate(-5),
      arrowright: () => state.probe.rotate(5),
      arrowup: () => state.probe.sweep(-5),
      arrowdown: () => state.probe.sweep(5),
      r: () => state.probe.load(state.view),
    };
    if (map[k]) {
      ev.preventDefault(); const changed = activateSection(); map[k](); update();
      if (changed) state.scene.focusPlane(state.probe.plane());
    }
  });
}

function setMode(m) {
  state.mode = m;
  document.querySelectorAll('.mbtn').forEach((b) => {
    b.classList.toggle('on', b.id === `mode-${m}`);
  });
  $('#panel-guided').style.display = m === 'guided' ? '' : 'none';
  $('#panel-free').style.display = '';
  $('#panel-quiz').style.display = m === 'quiz' ? '' : 'none';
  if (m === 'quiz') newQuiz(); else state.quiz = null;
  if (m !== 'quiz') state.sector.opts.labels = $('#t-labels').checked;
  update();
}

// ---------------------------------------------------------------------- quiz
function newQuiz() {
  activateSection();
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
  showReference(answer.id);
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
  if(state.registered) state.registered.showValves = state.groups.has('valve');
  if(state.registered) state.registered.showDetails = state.groups.has('detail');
  const ref = state.mode === 'quiz' ? undefined : echoReferences[v.id];
  const matched = !!ref && referenceMatches(p,v);
  const referenceMode = $('#stage2d').classList.contains('reference-mode');
  $('#stage2d .cap').textContent = referenceMode
    ? 'Recorded echo study · independent source patient'
    : 'Educational chamber section — not a diagnostic echo image';
  const referenceButton = $('.echo-reference-toggle');
  referenceButton.disabled = !ref;
  referenceButton.textContent = !ref ? 'No clinical clip for this view'
    : !matched ? '▶ Reset view & play clinical clip'
    : referenceMode ? 'Show simulated section' : '▶ Play clinical clip';
  const plane = p.plane();
  if (state.autoFitEcho && state.registered) {
    const fitted = state.registered.fitSector(plane);
    p.depth = fitted.depth; p.sector = fitted.sector;
    $('#depth').value = p.depth;
    $('#depth-val').textContent = `${p.depth.toFixed(1)} cm · fan ${p.sector}° (auto-fit)`;
  }
  const view = { ...v, depth: p.depth, sector: p.sector };
  const slices = sliceAll(state.structures, plane)
    .filter((r) => state.groups.has(r.group));
  state.scene.setProbe(p.contact, p.beam, p.index);
  state.scene.sliceInvert = state.sector.opts.invert;
  state.scene.referenceReverseDepth = referenceMode && !!ref?.reverseDepth;
  state.scene.setPlane(plane, slices, view);
  $('.patient-orientation').textContent = state.scene.showCut && state.scene.followCut
    ? `Cut-face view · ${referenceMode ? 'recorded-view orientation' : 'live-section orientation'} · beam ${state.scene.referenceReverseDepth ? '↑' : '↓'}`
    : state.scene.showCut ? 'Free camera · return to Mouse: slice to face the cut'
      : 'Supine · overhead · head ↑';
  $('#valve-detail').hidden = true;
  if(state.scene.showCut && v.id==='psax_av') $('.patient-orientation').textContent += ' · Aortic leaflets unavailable in source model; see recorded clip';
  state.sector.draw(slices, view, { highlight: state.highlight,
    registered: state.registered, plane });

  $('#seen').innerHTML = '';
  if (state.registered) {
    const names = {2: 'LV', 3: 'RV', 4: 'LA', 5: 'RA'};
      for (const code of state.sector.registeredVisible || []) {
      $('#seen').appendChild(el('span', 'chip', names[code]));
      }
      for(const valve of state.registered.valveSections(plane)) {
        $('#seen').appendChild(el('span','chip',valve.label));
      }
  } else {
    const visible = slices.filter((r) => r.outer.concat(r.cavity)
      .some((l) => loopInSector(l, p.depth, p.sector)));
    for (const r of visible.filter((x) => x.group !== 'context')) {
      const t = el('span', 'chip', SHORT[r.id] || r.id);
      t.onmouseenter = () => { state.highlight = new Set([r.id]); update(); };
      t.onmouseleave = () => { state.highlight = new Set(); update(); };
      $('#seen').appendChild(t);
    }
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
  if (v.registration_note) bits.push('registered mesh fit');
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
  const note = $('#vnote');
  note.style.display = v.index_note ? '' : 'none';
  note.textContent = v.index_note || '';
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
  const torso = $('#stage-torso');
  state.scene.resizeOverview(torso.clientWidth,torso.clientHeight);
  const c = $('#c2d');
  const box = $('#stage2d');
  const r = Math.min(2, window.devicePixelRatio || 1);
  c.width = box.clientWidth * r;
  c.height = box.clientHeight * r;
  c.style.width = `${box.clientWidth}px`;
  c.style.height = `${box.clientHeight}px`;
  if (state.view) update();
  if (state.view) state.scene.focusPlane(state.probe.plane());
}

boot();
