/* Popzy · séquence 3D : ouverture de la capsule + 4 clics de mastication
   Three.js r128 + GSAP 3 (CDN) + sound.js (Web Audio) */
(() => {
  /* ===== CONFIG : change le duo ici ===== */
  const DUO = {
    a: { name: 'Fraise', color: '#FF2D87', bg: '#FABBCB', bit: '#E8173A' },
    b: { name: 'Menthe', color: '#3A86C8', bg: '#B9DDEA', bit: '#36C9A0' },
    tongue: '#F59AB0'   // couleur "naturelle" de la langue avant le premier clic
  };
  const STEPS = [
    { n: 'Premier croc', tex: 'croquante', mix: 0, hint: 'Encore un coup de dent' },
    { n: 'Ça commence à changer', tex: 'ça ramollit', mix: 0.4, hint: 'Continue, ça change…' },
    { n: 'Le switch', tex: 'élastique', mix: 0.8, hint: 'Dernier clic : fais une bulle' },
    { n: 'Full ' + DUO.b.name, tex: 'ultra moelleuse', mix: 1, hint: '' }
  ];

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 700 || touch;
  const $ = (s, c = document) => c.querySelector(s), $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const ov = $('#reveal');
  if (!ov) return;
  const canvas = $('#rvCanvas', ov);
  const SND = new Proxy({}, { get: (_, k) => (...a) => { try { const s = window.PopzySound; s && s[k] && s[k](...a); } catch (e) {} } });

  let THREE, renderer, scene, camera, clock, running = false;
  let gumG, gum, gumMat, gumU, shadow, capG, topPivot, botPivot, capMat, seamMat, glow, crackLight;
  let burstPts, burstVel, burstMat, berries, leaves, orbitData = [];
  let state = 'idle', step = -1, busy = false, spin = 0.6, tl = null, orbitAppear = 0, userMuted = false;
  const shake = { v: 0 }, bg = { m: 0 };
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();

  function radialTex(inner, outer, size = 128) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }

  /* ---------- init ---------- */
  function init() {
    if (renderer) return true;
    if (!window.THREE || !window.gsap) return false;
    THREE = window.THREE;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, alpha: true, powerPreference: 'high-performance' }); }
    catch (e) { return false; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    clock = new THREE.Clock();

    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff0f5, side: THREE.BackSide })));
    const box = (w, h, x, y, z, col) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
    box(8, 3, 0, 7, 3, 0xffffff); box(3, 6, -7, 1, 2, 0xffffff); box(3, 5, 7, 0, 3, 0xffe1ef); box(6, 2, 0, -6, 4, 0xd8ecff);
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(env, 0.04).texture;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xffd1e6, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(3, 4, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(-4, 2, -3); scene.add(rim);
    crackLight = new THREE.PointLight(0xffffff, 0, 8); crackLight.position.set(0, 0, 1.6); scene.add(crackLight);

    buildGum(); buildCapsule(); buildBurst(); buildOrbits();
    shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({ map: radialTex('rgba(42,6,20,0.32)', 'rgba(42,6,20,0)'), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.6; scene.add(shadow);

    addEventListener('resize', resize); resize();
    bindInput();
    return true;
  }

  /* ---------- chewing-gum : marbrure + rondeur + bulle en shader ---------- */
  function buildGum() {
    gumU = {
      uMix: { value: 0 }, uRound: { value: 0 }, uWob: { value: 0 }, uBubble: { value: 0 }, uTime: { value: 0 },
      uC1: { value: lin(DUO.a.color) }, uC2: { value: lin(DUO.b.color) }
    };
    const geo = new THREE.SphereGeometry(1, small ? 72 : 128, small ? 54 : 96);
    geo.scale(1.3, 0.78, 1.0);
    gumMat = new THREE.MeshPhysicalMaterial({ roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.75, transparent: true });
    gumMat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, gumU);
      sh.vertexShader = 'uniform float uRound;uniform float uWob;uniform float uBubble;uniform float uTime;varying vec3 vP;\n' + sh.vertexShader
        .replace('#include <beginnormal_vertex>', `
          vec3 sphN = normalize(position);
          vec3 objectNormal = normalize(mix(vec3(normal), sphN, clamp(max(uBubble, uRound * 0.5), 0.0, 1.0)));
          #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', `
          vP = position;
          vec3 sph = normalize(position) * 1.04;
          vec3 transformed = mix(position, mix(position, sph, 0.5), uRound);
          transformed = mix(transformed, sph, uBubble);
          float n = sin(position.x * 5.0 + uTime * 3.2) * sin(position.z * 4.0 + uTime * 2.4) * sin(position.y * 6.0 + uTime * 1.3);
          transformed += objectNormal * n * uWob;`);
      sh.fragmentShader = 'uniform float uMix;uniform float uBubble;uniform vec3 uC1;uniform vec3 uC2;varying vec3 vP;\n' + sh.fragmentShader
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
          float ang = atan(vP.z, vP.x);
          float m = sin(vP.y * 3.4 + ang * 2.0 + vP.x * 1.6 + sin(vP.z * 3.0 + vP.x * 2.2) * 0.9);
          float bias = mix(1.25, -1.25, uMix);
          float t = smoothstep(-0.16, 0.16, m - bias);
          vec3 col = mix(uC1, uC2, t);
          float edge = 1.0 - abs(t - 0.5) * 2.0;
          col = mix(col, vec3(1.0), edge * 0.16 + uBubble * 0.18);
          vec4 diffuseColor = vec4(col, mix(1.0, 0.82, uBubble));`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * (0.06 + uBubble * 0.1);')
        .replace('#include <tonemapping_fragment>', `
          #ifndef FLAT_SHADED
          float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.4);
          gl_FragColor.rgb += mix(diffuseColor.rgb, vec3(1.0), 0.3) * fr * (0.22 + uBubble * 0.3);
          #endif
          #include <tonemapping_fragment>`);
    };
    gum = new THREE.Mesh(geo, gumMat);
    gumG = new THREE.Group(); gumG.add(gum); scene.add(gumG);
  }

  /* ---------- capsule 3D ---------- */
  function buildCapsule() {
    capG = new THREE.Group(); scene.add(capG);
    capMat = new THREE.MeshPhysicalMaterial({ color: lin(DUO.a.color), metalness: 0.35, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, transparent: true });
    const R = 1.25, flat = 0.8;
    topPivot = new THREE.Group(); botPivot = new THREE.Group(); capG.add(topPivot, botPivot);
    const top = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2), capMat); top.scale.y = flat;
    const bot = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 32, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), capMat); bot.scale.y = flat;
    topPivot.add(top); botPivot.add(bot);
    const ringMat = new THREE.MeshPhysicalMaterial({ color: 0xdcd6e0, metalness: 1, roughness: 0.25, transparent: true });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 16, 64), ringMat); ring.position.y = R * flat + 0.28; topPivot.add(ring);
    capG.userData.ringMat = ringMat;
    seamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const seam = new THREE.Mesh(new THREE.TorusGeometry(R * 1.005, 0.03, 12, 128), seamMat); seam.rotation.x = Math.PI / 2; capG.add(seam);
    glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), transparent: true, depthWrite: false, opacity: 0 }));
    glow.scale.set(0.1, 0.1, 1); glow.position.z = 0.6; capG.add(glow);
  }

  /* ---------- particules d'explosion ---------- */
  function buildBurst() {
    const N = small ? 170 : 480;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    burstVel = new Float32Array(N * 3);
    burstMat = new THREE.PointsMaterial({ size: small ? 0.11 : 0.085, map: radialTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64), vertexColors: true, transparent: true, depthWrite: false, opacity: 0 });
    burstPts = new THREE.Points(g, burstMat); scene.add(burstPts);
  }
  // mode : 'both' (ouverture), 'a', 'b' ; power : vitesse ; r0 : rayon de départ
  function burst(mode = 'both', power = 1, r0 = 0) {
    const p = burstPts.geometry.attributes.position.array, col = burstPts.geometry.attributes.color.array, N = p.length / 3;
    const ca = lin(DUO.a.color), cb = lin(DUO.b.color), w = new THREE.Color(1, 1, 1);
    for (let i = 0; i < N; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), s = (2 + Math.random() * 5.5) * power;
      const dx = Math.sin(ph) * Math.cos(th), dy = Math.cos(ph), dz = Math.sin(ph) * Math.sin(th);
      p[i * 3] = dx * r0; p[i * 3 + 1] = dy * r0 + gumG.position.y; p[i * 3 + 2] = dz * r0;
      burstVel[i * 3] = dx * s; burstVel[i * 3 + 1] = dy * s * 0.8 + power; burstVel[i * 3 + 2] = dz * s;
      const c = i % 7 === 0 ? w : mode === 'a' ? ca : mode === 'b' ? cb : (i % 2 ? ca : cb);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    burstPts.geometry.attributes.position.needsUpdate = burstPts.geometry.attributes.color.needsUpdate = true;
    burstMat.opacity = 1;
  }

  /* ---------- orbites : fraises -> menthe ---------- */
  function buildOrbits() {
    const N = small ? 8 : 14;
    const prof = [[0, -0.5], [0.16, -0.43], [0.3, -0.22], [0.37, 0.02], [0.34, 0.22], [0.22, 0.36], [0, 0.4]].map(([x, y]) => new THREE.Vector2(x, y));
    const berryGeo = new THREE.LatheGeometry(prof, 18); berryGeo.scale(0.42, 0.42, 0.42);
    const leafGeo = new THREE.SphereGeometry(0.3, 18, 12); leafGeo.scale(0.6, 0.2, 1.05);
    berries = new THREE.InstancedMesh(berryGeo, new THREE.MeshPhysicalMaterial({ color: lin(DUO.a.bit), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 }), N);
    leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshPhysicalMaterial({ color: lin(DUO.b.bit), roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 }), N);
    scene.add(berries, leaves);
    for (let k = 0; k < 2; k++) for (let i = 0; i < N; i++)
      orbitData.push({ k, i, r: 2.1 + Math.random() * 0.8, a: (i / N) * Math.PI * 2 + Math.random() * 0.3, sp: (0.25 + Math.random() * 0.2) * (k ? -1 : 1), y: (Math.random() - 0.5) * 0.9, s: (small ? 0.75 : 0.6) + Math.random() * 0.4, rot: Math.random() * 6 });
  }
  let dummy = null;
  function updateOrbits(t, dt) {
    if (!dummy) dummy = new THREE.Object3D();
    const mx = gumU.uMix.value, mixA = 1 - 0.85 * mx, mixB = 0.15 + 0.85 * mx;
    for (const d of orbitData) {
      d.a += d.sp * dt * (reduce ? 0.4 : 1);
      const off = d.k ? 0.55 : -0.55, tilt = d.k ? -0.42 : 0.42;
      dummy.position.set(Math.cos(d.a) * d.r + off, d.y + Math.sin(d.a) * d.r * tilt * 0.35 + Math.sin(t * 1.3 + d.rot) * 0.08, Math.sin(d.a) * d.r * 0.8);
      dummy.rotation.set(t * 0.6 + d.rot, t * 0.8 + d.rot, d.rot);
      dummy.scale.setScalar(Math.max(d.s * orbitAppear * (d.k ? mixB : mixA), 0.0001));
      dummy.updateMatrix();
      (d.k ? leaves : berries).setMatrixAt(d.i, dummy.matrix);
    }
    berries.instanceMatrix.needsUpdate = leaves.instanceMatrix.needsUpdate = true;
  }

  /* ---------- UI ---------- */
  const ui = {
    flash: $('.rv-flash', ov), hint: $('.rv-hint-t', ov), title: $('.rv-step-n', ov), tex: $('.rv-tex', ov),
    fill: $('.rv-fill', ov), dots: $$('.rv-dots i', ov), tongue: $('.rv-tongue', ov), mouth: $('.rv-mouth', ov), snd: $('.rv-snd', ov)
  };
  $('.rv-badge', ov).textContent = `Drop limité · Édition ${DUO.a.name} × ${DUO.b.name}`;
  $('.rv-la', ov).textContent = DUO.a.name; $('.rv-lb', ov).textContent = DUO.b.name;
  ov.style.setProperty('--ca', DUO.a.color); ov.style.setProperty('--cb', DUO.b.color);
  const hexRGB = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
  const mixHex = (h1, h2, m) => { const a = hexRGB(h1), b = hexRGB(h2); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * m)).join(',')})`; };
  const startHint = touch ? 'Tape pour croquer' : 'Clique pour croquer';
  function setStage(s) { state = s; ov.classList.remove('s-open', 's-chew', 's-end'); ov.classList.add('s-' + s); }
  function paintUI() {
    ui.dots.forEach((d, i) => d.classList.toggle('on', i <= step));
    ui.fill.style.width = (step < 0 ? 0 : (step / (STEPS.length - 1)) * 100) + '%';
    ui.title.textContent = step < 0 ? 'Prêt·e ?' : `Étape ${step + 1} · ${STEPS[step].n}`;
    ui.tex.textContent = 'Texture : ' + (step < 0 ? 'intacte' : STEPS[step].tex);
    ui.hint.textContent = step < 0 ? startHint : STEPS[step].hint;
    ov.classList.toggle('no-hint', step >= STEPS.length - 1);
  }
  function setTongue(m, animate) {
    const col = m < 0 ? DUO.tongue : mixHex(DUO.a.color, DUO.b.color, m);
    if (!animate || reduce) { ui.tongue.style.fill = col; return; }
    const drop = document.createElement('span'); drop.className = 'rv-drop'; drop.style.background = col;
    ui.mouth.appendChild(drop);
    setTimeout(() => { ui.tongue.style.fill = col; ui.mouth.classList.remove('gulp'); void ui.mouth.offsetWidth; ui.mouth.classList.add('gulp'); }, 430);
    setTimeout(() => drop.remove(), 900);
  }
  function syncSnd() { ui.snd.textContent = userMuted ? 'Son : off' : 'Son : on'; ui.snd.setAttribute('aria-pressed', String(!userMuted)); }

  /* ---------- input : chaque clic = une mastication ---------- */
  function bindInput() {
    ov.addEventListener('pointerdown', e => {
      if (state !== 'chew' || (e.target.closest && e.target.closest('button,a'))) return;
      e.preventDefault(); next();
    });
    ov.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('keydown', e => {
      if (ov.hidden) return;
      if (e.key === 'Escape') close();
      if ((e.key === ' ' || e.key === 'Enter') && state === 'chew' && !(e.target.closest && e.target.closest('button,a'))) { e.preventDefault(); next(); }
    });
    ui.snd.addEventListener('click', () => { userMuted = !userMuted; SND.setMuted(userMuted); syncSnd(); if (!userMuted) SND.tap(); });
    $('.rv-close', ov).addEventListener('click', close);
    $('.rv-restart', ov).addEventListener('click', () => { SND.tap(); restart(); });
    $('.rv-cta1', ov).addEventListener('click', () => close());
    $('.rv-cta2', ov).addEventListener('click', () => { SND.tap(); toast('En caisse chez Carrefour, au rayon confiserie. (Maquette)'); });
    $('.rv-share', ov).addEventListener('click', async () => {
      SND.shimmer();
      try { await navigator.clipboard.writeText(location.origin + location.pathname); toast('Lien copié. Envoie-le au groupe !'); }
      catch (e) { toast('Partage simulé : le lien part au groupe.'); }
    });
  }
  function toast(m) {
    const t = document.getElementById('toast'); if (!t) return;
    t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800);
  }

  /* ---------- les 4 étapes ---------- */
  function toMix(m, d) { gsap.to(gumU.uMix, { value: m, duration: d, ease: 'power2.out' }); gsap.to(bg, { m, duration: d, ease: 'power2.out' }); }
  function squash(sx, sy, inDur, outDur, ease) {
    return gsap.timeline()
      .to(gum.scale, { x: sx, y: sy, z: sx, duration: inDur, ease: 'power2.out' })
      .to(gum.scale, { x: 1, y: 1, z: 1, duration: outDur, ease });
  }
  function next() {
    if (busy || step >= STEPS.length - 1) return;
    step++; busy = true;
    const k = step, R = reduce ? 0.35 : 1;   // amplitude réduite si reduced-motion
    paintUI();
    setTongue(STEPS[k].mix, true);
    if (k === 0) {                         // Premier croc : sec, rebond rapide
      SND.crunch(1); SND.vibrate([14, 30, 10]);
      squash(1 + 0.12 * R, 1 - 0.28 * R, 0.06, 0.45, reduce ? 'power2.out' : 'elastic.out(1.2, 0.35)');
      toMix(0, 0.2);
      if (!reduce) burst('a', 0.35, 0.8);
      setTimeout(() => busy = false, 320);
    } else if (k === 1) {                  // ça commence à changer
      SND.crunchSquish(); SND.vibrate([12, 20, 26]);
      gsap.to(gumU.uRound, { value: 0.5, duration: 0.8, ease: 'power2.out' });
      gsap.to(gumU.uWob, { value: 0.03 * R, duration: 0.6 });
      squash(1 + 0.2 * R, 1 - 0.35 * R, 0.12, 0.8, reduce ? 'power2.out' : 'elastic.out(1, 0.5)');
      toMix(STEPS[1].mix, 0.8);
      setTimeout(() => busy = false, 520);
    } else if (k === 2) {                  // le switch : stretch façon slime
      SND.stretch(); SND.vibrate([8, 30, 8, 30, 40]);
      gsap.to(gumU.uRound, { value: 0.9, duration: 0.9, ease: 'power2.out' });
      gsap.to(gumU.uWob, { value: 0.06 * R, duration: 0.3, yoyo: true, repeat: 1, onComplete() { gumU.uWob.value = 0.035 * R; } });
      gsap.timeline()
        .to(gum.scale, { x: 1 + 0.75 * R, y: 1 - 0.38 * R, z: 1 - 0.15 * R, duration: 0.42, ease: 'power2.out' })
        .to(gum.scale, { x: 1, y: 1, z: 1, duration: 1.1, ease: reduce ? 'power2.out' : 'elastic.out(1, 0.3)' });
      toMix(STEPS[2].mix, 0.9);
      setTimeout(() => busy = false, 950);
    } else {                               // full goût 2 : bulle qui éclate
      toMix(1, 0.6);
      const inflate = reduce ? 0.5 : 0.85;
      SND.inflate(inflate); SND.vibrate([6, 40, 6, 40, 6]);
      gsap.timeline()
        .to(gumU.uBubble, { value: 1, duration: inflate, ease: 'sine.inOut' })
        .to(gum.scale, { x: 1.9, y: 1.9 * 1.25, z: 1.9, duration: inflate, ease: 'sine.inOut' }, 0)
        .to(gumU.uWob, { value: 0.02, duration: inflate }, 0)
        .add(() => {
          SND.bubblePop(); SND.vibrate(45);
          if (!reduce) { burst('b', 1.1, 1.6); flash(0.5); }
          gumU.uBubble.value = 0; gumU.uRound.value = 1; gumU.uWob.value = 0.04 * R;
          gum.scale.set(0.35, 0.35, 0.35);
        })
        .to(gum.scale, { x: 0.85, y: 0.85, z: 0.85, duration: 0.9, ease: reduce ? 'power2.out' : 'elastic.out(1, 0.45)' })
        .add(finish, '-=0.4');
    }
  }
  function finish() {
    setStage('end'); busy = false;
    gsap.to(gumG.userData, { baseY: small ? 0.5 : 0.38, duration: 1, ease: 'power3.out' });
    gsap.to({ s: spin }, { s: 0.2, duration: 1.4, onUpdate() { spin = this.targets()[0].s; } });
  }
  function restart() {                     // retour à l'étape 1 sans rouvrir la capsule
    gsap.killTweensOf([gumU.uMix, gumU.uRound, gumU.uWob, gumU.uBubble, gum.scale, bg]);
    step = -1; busy = false; spin = 0.6;
    gsap.to(gumU.uMix, { value: 0, duration: 0.5 }); gsap.to(bg, { m: 0, duration: 0.5 });
    gsap.to(gumU.uRound, { value: 0, duration: 0.5 }); gsap.to(gumU.uWob, { value: 0, duration: 0.5 });
    gumU.uBubble.value = 0;
    gsap.fromTo(gum.scale, { x: 0.6, y: 0.6, z: 0.6 }, { x: 1, y: 1, z: 1, duration: 0.8, ease: reduce ? 'power2.out' : 'elastic.out(1, 0.5)' });
    gsap.to(gumG.userData, { baseY: 0.15, duration: 0.6 });
    setTongue(-1, false); paintUI(); setStage('chew'); SND.shimmer();
  }

  /* ---------- boucle de rendu ---------- */
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.set(0, 0.35, w / h < 0.8 ? 10.8 : w / h < 1.2 ? 8.8 : 7.6);
    camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  }
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    gumU.uTime.value = t;
    if (shake.v > 0) { capG.rotation.z = Math.sin(t * 55) * 0.05 * shake.v; capG.position.x = Math.sin(t * 73) * 0.03 * shake.v; }
    if (burstMat.opacity > 0) {
      const p = burstPts.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        p[i] += burstVel[i] * dt; p[i + 1] += burstVel[i + 1] * dt; p[i + 2] += burstVel[i + 2] * dt;
        burstVel[i] *= 0.965; burstVel[i + 1] = burstVel[i + 1] * 0.965 - 1.4 * dt; burstVel[i + 2] *= 0.965;
      }
      burstPts.geometry.attributes.position.needsUpdate = true;
      burstMat.opacity = Math.max(0, burstMat.opacity - dt * 0.6);
    }
    gum.rotation.y += dt * spin * (reduce ? 0.35 : 1);
    gum.rotation.x = Math.sin(t * 0.7) * 0.22;
    if (state === 'chew' || state === 'end') gumG.position.y = gumG.userData.baseY + (reduce ? 0 : Math.sin(t * 1.6) * 0.08);
    shadow.material.opacity = Math.min(1, gumG.scale.x * gum.scale.x) * 0.9;
    orbitAppear += ((state === 'chew' || state === 'end' ? 1 : 0) - orbitAppear) * Math.min(1, dt * 3);
    updateOrbits(t, dt);
    ov.style.backgroundColor = mixHex(DUO.a.bg, DUO.b.bg, bg.m);
    renderer.render(scene, camera);
  }

  /* ---------- ouverture de la capsule ---------- */
  function resetScene(capColor) {
    tl && tl.kill();
    gsap.killTweensOf([gumU.uMix, gumU.uRound, gumU.uWob, gumU.uBubble, gum.scale, bg]);
    step = -1; busy = false; spin = 0.6; orbitAppear = 0; shake.v = 0; bg.m = 0;
    gumU.uMix.value = 0; gumU.uRound.value = 0; gumU.uWob.value = 0; gumU.uBubble.value = 0;
    gum.scale.set(1, 1, 1);
    capMat.color.copy(lin(capColor || DUO.a.color));
    capMat.opacity = 1; capG.userData.ringMat.opacity = 1;
    capG.visible = true; capG.scale.setScalar(1); capG.rotation.set(0.25, -0.3, 0); capG.position.set(0, 0, 0);
    topPivot.position.set(0, 0, 0); topPivot.rotation.set(0, 0, 0);
    botPivot.position.set(0, 0, 0); botPivot.rotation.set(0, 0, 0);
    seamMat.opacity = 0; glow.material.opacity = 0; glow.scale.set(0.1, 0.1, 1); crackLight.intensity = 0;
    gumG.scale.setScalar(0.001); gumG.position.set(0, -0.2, 0); gumG.userData.baseY = 0.15; gum.rotation.set(0, 0, 0);
    burstMat.opacity = 0;
    setTongue(-1, false); paintUI();
  }
  function startChew() { setStage('chew'); capG.visible = false; SND.shimmer(); }
  function play(capColor) {
    resetScene(capColor);
    setStage('open');
    if (reduce) {
      capG.visible = false; SND.openPop();
      tl = gsap.timeline().to(gumG.scale, { x: 1, y: 1, z: 1, duration: 0.5 }).to(gumG.position, { y: 0.15, duration: 0.5 }, '<').add(startChew);
      return;
    }
    tl = gsap.timeline();
    tl.from(capG.scale, { x: 0.3, y: 0.3, z: 0.3, duration: 0.55, ease: 'back.out(2.2)' })
      .to(capG.rotation, { x: 0.1, y: 0, duration: 0.55, ease: 'power2.out' }, '<')
      .to(shake, { v: 1, duration: 0.75, ease: 'power2.in' })
      .add(() => { SND.crack(); SND.vibrate([5, 40, 5]); }, '-=0.5')
      .add(() => SND.crack(), '-=0.22')
      .to(seamMat, { opacity: 1, duration: 0.4, ease: 'power2.in' }, '-=0.45')
      .to(crackLight, { intensity: 7, duration: 0.4, ease: 'power2.in' }, '<')
      .to(glow.material, { opacity: 0.95, duration: 0.4 }, '<')
      .to(glow.scale, { x: 3.4, y: 1.4, duration: 0.42, ease: 'power3.in' }, '<')
      .add(() => { shake.v = 0; burst('both', 1, 0); SND.openPop(); SND.vibrate(30); flash(0.85); })
      .to(topPivot.position, { y: 3.2, x: -0.6, duration: 1, ease: 'power3.out' })
      .to(topPivot.rotation, { z: 0.7, x: -0.6, duration: 1, ease: 'power3.out' }, '<')
      .to(botPivot.position, { y: -3.4, x: 0.5, duration: 1, ease: 'power3.out' }, '<')
      .to(botPivot.rotation, { z: -0.5, x: 0.5, duration: 1, ease: 'power3.out' }, '<')
      .to([capMat, capG.userData.ringMat, seamMat], { opacity: 0, duration: 0.5 }, '<0.25')
      .to(glow.material, { opacity: 0, duration: 0.6 }, '<')
      .to(crackLight, { intensity: 0, duration: 0.6 }, '<')
      .to(gumG.scale, { x: 1, y: 1, z: 1, duration: 1.2, ease: 'elastic.out(1, 0.5)' }, '<-0.15')
      .to(gumG.position, { y: 0.15, duration: 0.9, ease: 'back.out(2)' }, '<')
      .add(startChew, '-=0.7');
  }
  function flash(o) { gsap.fromTo(ui.flash, { opacity: o }, { opacity: 0, duration: 0.6, ease: 'power2.out' }); }

  function open(capColor) {
    if (!init()) return false;
    SND.unlock(); SND.setMuted(userMuted); syncSnd();     // le son s'active au clic sur la capsule
    ov.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    requestAnimationFrame(() => ov.classList.add('on'));
    resize();
    if (!running) { running = true; clock.getDelta(); loop(); }
    play(capColor);
    setTimeout(() => { const b = $('.rv-close', ov); b && b.focus({ preventScroll: true }); }, 50);
    return true;
  }
  function close() {
    ov.classList.remove('on');
    document.documentElement.style.overflow = '';
    setTimeout(() => { ov.hidden = true; running = false; tl && tl.kill(); setStage('idle'); }, 380);
  }

  window.PopzyReveal = { open, close, DUO, STEPS };
})();
