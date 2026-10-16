/* Popzy · séquence 3D "unboxing" du chewing-gum bi-goût
   Three.js r128 + GSAP 3 (chargés en CDN dans index.html) */
(() => {
  /* ===== CONFIG : change le duo ici ===== */
  const DUO = {
    a: { name: 'Fraise', color: '#FF2D87', light: '#FFB3CF', bg: '#FABBCB', bit: '#E8173A' },
    b: { name: 'Menthe', color: '#3A86C8', light: '#CDEBF5', bg: '#B9DDEA', bit: '#36C9A0' },
    duration: 120,       // secondes "réelles" de mastication affichées sur la timeline (2 min)
    holdSeconds: 4.5     // durée d'appui nécessaire pour aller au bout
  };

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = Math.min(innerWidth, innerHeight) < 700 || matchMedia('(pointer: coarse)').matches;
  const $ = (s, c = document) => c.querySelector(s);
  const ov = $('#reveal');
  if (!ov) return;
  const canvas = $('#rvCanvas', ov);
  const sfx = s => { try { window.popzyPop && window.popzyPop(s); } catch (e) {} };

  let THREE, renderer, scene, camera, clock, running = false;
  let gumG, gum, gumU, shadow, capG, topPivot, botPivot, capMat, seamMat, glow, crackLight;
  let burstPts, burstVel, burstMat, berries, leaves, orbitData = [];
  let state = 'idle', progress = 0, chewLevel = 0, holding = false, spin = 0.6, tl = null, lastChewPop = 0;
  const shake = { v: 0 };
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();

  /* ---------- textures générées ---------- */
  function radialTex(inner, outer, size = 128) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c); return t;
  }

  /* ---------- initialisation (une seule fois) ---------- */
  function init() {
    if (renderer) return true;
    if (!window.THREE || !window.gsap) return false;
    THREE = window.THREE;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, alpha: true, powerPreference: 'high-performance' });
    } catch (e) { return false; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    clock = new THREE.Clock();

    // environnement studio généré (reflets "juicy")
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff0f5, side: THREE.BackSide })));
    const box = (w, h, x, y, z, col) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
    box(8, 3, 0, 7, 3, 0xffffff); box(3, 6, -7, 1, 2, 0xffffff); box(3, 5, 7, 0, 3, 0xffe1ef); box(6, 2, 0, -6, 4, 0xd8ecff);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(env, 0.04).texture;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xffd1e6, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(3, 4, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(-4, 2, -3); scene.add(rim);
    crackLight = new THREE.PointLight(0xffffff, 0, 8); crackLight.position.set(0, 0, 1.6); scene.add(crackLight);

    buildGum(); buildCapsule(); buildBurst(); buildOrbits();

    shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({ map: radialTex('rgba(42,6,20,0.32)', 'rgba(42,6,20,0)'), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.55; scene.add(shadow);

    addEventListener('resize', resize); resize();
    bindInput();
    return true;
  }

  /* ---------- le chewing-gum : dragée marbrée en shader ---------- */
  function buildGum() {
    gumU = {
      uMix: { value: 0 }, uChew: { value: 0 }, uSoft: { value: 0 }, uTime: { value: 0 },
      uC1: { value: lin(DUO.a.color) }, uC2: { value: lin(DUO.b.color) }
    };
    const geo = new THREE.SphereGeometry(1, small ? 72 : 128, small ? 54 : 96);
    geo.scale(1.3, 0.8, 1.0);
    const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.75 });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, gumU);
      sh.vertexShader = 'uniform float uChew;uniform float uSoft;uniform float uTime;varying vec3 vP;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        vP = position;
        float sq = uChew;
        transformed.y *= 1.0 - 0.3 * sq;
        transformed.xz *= 1.0 + 0.15 * sq;
        float n = sin(position.x * 5.0 + uTime * 3.0) * sin(position.z * 4.0 + uTime * 2.3) * sin(position.y * 6.0 + uTime);
        transformed += normal * n * (0.025 + 0.07 * uSoft) * (0.35 + sq);
      `);
      sh.fragmentShader = 'uniform float uMix;uniform vec3 uC1;uniform vec3 uC2;varying vec3 vP;\n' + sh.fragmentShader
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
          float ang = atan(vP.z, vP.x);
          float m = sin(vP.y * 3.4 + ang * 2.0 + vP.x * 1.6 + sin(vP.z * 3.0 + vP.x * 2.2) * 0.9);
          float bias = mix(0.6, -0.6, uMix);
          float t = smoothstep(-0.16, 0.16, m - bias);
          vec3 col = mix(uC1, uC2, t);
          float edge = 1.0 - abs(t - 0.5) * 2.0;
          col = mix(col, vec3(1.0), edge * 0.16);
          vec4 diffuseColor = vec4(col, opacity);
        `)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.06;')
        .replace('#include <tonemapping_fragment>', `
          #ifndef FLAT_SHADED
          float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.4);
          gl_FragColor.rgb += mix(diffuseColor.rgb, vec3(1.0), 0.3) * fr * 0.22;
          #endif
          #include <tonemapping_fragment>`);
    };
    gum = new THREE.Mesh(geo, mat);
    gumG = new THREE.Group(); gumG.add(gum); scene.add(gumG);
  }

  /* ---------- la capsule 3D (2 coques + jointure lumineuse + anneau) ---------- */
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

  /* ---------- explosion de particules bicolores ---------- */
  function buildBurst() {
    const N = small ? 170 : 520;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const col = new Float32Array(N * 3), ca = lin(DUO.a.color), cb = lin(DUO.b.color), w = new THREE.Color(1, 1, 1);
    for (let i = 0; i < N; i++) { const c = i % 7 === 0 ? w : (i % 2 ? ca : cb); col.set([c.r, c.g, c.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    burstVel = new Float32Array(N * 3);
    burstMat = new THREE.PointsMaterial({ size: small ? 0.11 : 0.085, map: radialTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64), vertexColors: true, transparent: true, depthWrite: false, opacity: 0 });
    burstPts = new THREE.Points(g, burstMat); scene.add(burstPts);
  }
  function burst() {
    const p = burstPts.geometry.attributes.position.array, N = p.length / 3;
    for (let i = 0; i < N; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), s = 2 + Math.random() * 5.5;
      p[i * 3] = p[i * 3 + 1] = p[i * 3 + 2] = 0;
      burstVel[i * 3] = Math.sin(ph) * Math.cos(th) * s;
      burstVel[i * 3 + 1] = Math.cos(ph) * s * 0.8 + 1;
      burstVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s;
    }
    burstPts.geometry.attributes.position.needsUpdate = true;
    burstMat.opacity = 1;
  }

  /* ---------- orbites : fraises d'un côté, feuilles de menthe de l'autre ---------- */
  function buildOrbits() {
    const N = small ? 8 : 14;
    const prof = [[0, -0.5], [0.16, -0.43], [0.3, -0.22], [0.37, 0.02], [0.34, 0.22], [0.22, 0.36], [0, 0.4]].map(([x, y]) => new THREE.Vector2(x, y));
    const berryGeo = new THREE.LatheGeometry(prof, 18); berryGeo.scale(0.42, 0.42, 0.42);
    const berryMat = new THREE.MeshPhysicalMaterial({ color: lin(DUO.a.bit), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
    const leafGeo = new THREE.SphereGeometry(0.3, 18, 12); leafGeo.scale(0.6, 0.2, 1.05);
    const leafMat = new THREE.MeshPhysicalMaterial({ color: lin(DUO.b.bit), roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    berries = new THREE.InstancedMesh(berryGeo, berryMat, N);
    leaves = new THREE.InstancedMesh(leafGeo, leafMat, N);
    scene.add(berries, leaves);
    orbitData = [];
    for (let k = 0; k < 2; k++) for (let i = 0; i < N; i++) {
      orbitData.push({ k, i, r: 2.1 + Math.random() * 0.8, a: (i / N) * Math.PI * 2 + Math.random() * 0.3, sp: (0.25 + Math.random() * 0.2) * (k ? -1 : 1), y: (Math.random() - 0.5) * 0.9, s: (small ? 0.75 : 0.6) + Math.random() * 0.4, rot: Math.random() * 6 });
    }
    berries.visible = leaves.visible = false;
  }
  const dummy = { o: null };
  function updateOrbits(t, dt, appear) {
    if (!dummy.o) dummy.o = new THREE.Object3D();
    const o = dummy.o, mixA = 1 - 0.75 * gumU.uMix.value, mixB = 0.3 + 0.7 * gumU.uMix.value;
    for (const d of orbitData) {
      d.a += d.sp * dt * (reduce ? 0.4 : 1);
      const tilt = d.k ? -0.42 : 0.42, off = d.k ? 0.55 : -0.55;
      const x = Math.cos(d.a) * d.r + off, z = Math.sin(d.a) * d.r * 0.8;
      o.position.set(x, d.y + Math.sin(d.a) * d.r * tilt * 0.35 + Math.sin(t * 1.3 + d.rot) * 0.08, z);
      o.rotation.set(t * 0.6 + d.rot, t * 0.8 + d.rot, d.rot);
      const sc = d.s * appear * (d.k ? mixB : mixA);
      o.scale.setScalar(Math.max(sc, 0.0001));
      o.updateMatrix();
      (d.k ? leaves : berries).setMatrixAt(d.i, o.matrix);
    }
    berries.instanceMatrix.needsUpdate = leaves.instanceMatrix.needsUpdate = true;
  }

  /* ---------- UI ---------- */
  const ui = {
    now: $('.rv-now', ov), cursor: $('.rv-cursor', ov), tex: $('.rv-tex', ov), flash: $('.rv-flash', ov)
  };
  $('.rv-badge', ov).textContent = `Drop limité · Édition ${DUO.a.name} × ${DUO.b.name}`;
  $('.rv-la', ov).textContent = DUO.a.name; $('.rv-lb', ov).textContent = DUO.b.name;
  $('.rv-tmax', ov).textContent = DUO.duration >= 60 ? `${Math.round(DUO.duration / 60)} min` : `${DUO.duration} s`;
  ov.style.setProperty('--ca', DUO.a.color); ov.style.setProperty('--cb', DUO.b.color);
  const ba = hexRGB(DUO.a.bg), bb = hexRGB(DUO.b.bg);
  function hexRGB(h) { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); }
  function setStage(s) { state = s; ov.classList.remove('s-open', 's-chew', 's-end'); ov.classList.add('s-' + s); }
  function updateUI() {
    const p = progress, secs = Math.round(p * DUO.duration);
    ui.now.textContent = secs >= 60 ? `${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, '0')}` : `${secs} s`;
    ui.cursor.style.left = (p * 100) + '%';
    ui.tex.textContent = 'Texture : ' + (p < 0.33 ? 'ferme' : p < 0.7 ? 'souple' : 'moelleuse');
    const c = ba.map((v, i) => Math.round(v + (bb[i] - v) * p));
    ov.style.backgroundColor = `rgb(${c.join(',')})`;
  }

  /* ---------- input : appui long = mâcher ---------- */
  function bindInput() {
    const start = e => {
      if (state !== 'chew') return;
      if (e.target.closest && e.target.closest('button,a')) return;
      holding = true; ov.classList.add('holding');
    };
    const stop = () => { holding = false; ov.classList.remove('holding'); };
    ov.addEventListener('pointerdown', start);
    addEventListener('pointerup', stop); addEventListener('pointercancel', stop);
    ov.addEventListener('contextmenu', e => e.preventDefault());
    ov.addEventListener('wheel', e => { if (state === 'chew') { e.preventDefault(); progress = Math.min(1, progress + Math.abs(e.deltaY) * 0.0009); chewLevel = Math.min(1, chewLevel + 0.25); } }, { passive: false });
    addEventListener('keydown', e => {
      if (ov.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === ' ' && state === 'chew' && !e.repeat && !(e.target.closest && e.target.closest('button,a'))) { e.preventDefault(); holding = true; ov.classList.add('holding'); }
    });
    addEventListener('keyup', e => { if (e.key === ' ') stop(); });
    $('.rv-close', ov).addEventListener('click', close);
    $('.rv-replay', ov).addEventListener('click', () => { sfx(1.2); play(); });
    $('.rv-cta1', ov).addEventListener('click', () => close());
    $('.rv-cta2', ov).addEventListener('click', () => toast('En caisse chez Carrefour, au rayon confiserie. (Maquette)'));
    $('.rv-share', ov).addEventListener('click', async () => {
      const url = location.origin + location.pathname;
      try { await navigator.clipboard.writeText(url); toast('Lien copié. Envoie-le au groupe !'); }
      catch (e) { toast('Partage simulé : le lien part au groupe.'); }
      sfx(1.5);
    });
  }
  function toast(m) {
    const t = document.getElementById('toast'); if (!t) return;
    t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800);
  }

  /* ---------- boucle ---------- */
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.set(0, 0.35, w / h < 0.8 ? 10.5 : w / h < 1.2 ? 8.6 : 7.4);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
  let orbitAppear = 0;
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    gumU.uTime.value = t;

    if (shake.v > 0) { capG.rotation.z = Math.sin(t * 55) * 0.05 * shake.v; capG.position.x = Math.sin(t * 73) * 0.03 * shake.v; }

    // explosion
    if (burstMat.opacity > 0) {
      const p = burstPts.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        p[i] += burstVel[i] * dt; p[i + 1] += burstVel[i + 1] * dt; p[i + 2] += burstVel[i + 2] * dt;
        burstVel[i] *= 0.965; burstVel[i + 1] = burstVel[i + 1] * 0.965 - 1.4 * dt; burstVel[i + 2] *= 0.965;
      }
      burstPts.geometry.attributes.position.needsUpdate = true;
      burstMat.opacity = Math.max(0, burstMat.opacity - dt * 0.55);
    }

    // mastication
    if (state === 'chew') {
      if (holding) {
        progress = Math.min(1, progress + dt / (reduce ? 3 : DUO.holdSeconds));
        if (t - lastChewPop > 0.62) { lastChewPop = t; sfx(0.6 + progress * 0.6); }
      }
      if (progress >= 1) finish();
    }
    chewLevel += ((holding ? 1 : 0) - chewLevel) * Math.min(1, dt * 8);
    const rhythm = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t * 10);
    gumU.uChew.value = chewLevel * rhythm * (0.6 + 0.4 * progress);
    gumU.uSoft.value = progress;
    gumU.uMix.value += (progress - gumU.uMix.value) * Math.min(1, dt * 6);

    gum.rotation.y += dt * spin * (reduce ? 0.35 : 1);
    gum.rotation.x = Math.sin(t * 0.7) * 0.25;
    if (state === 'chew' || state === 'end') gumG.position.y = gumG.userData.baseY + (reduce ? 0 : Math.sin(t * 1.6) * 0.08);
    shadow.material.opacity = Math.min(1, gumG.scale.x) * (1 - (gumG.position.y + 0.5) * 0.25);

    if (berries.visible) { orbitAppear += ((state === 'chew' || state === 'end' ? 1 : 0) - orbitAppear) * Math.min(1, dt * 3); updateOrbits(t, dt, orbitAppear); }
    if (state === 'chew' || state === 'end') updateUI();
    renderer.render(scene, camera);
  }

  /* ---------- chorégraphie ---------- */
  function resetScene(capColor) {
    tl && tl.kill();
    progress = 0; chewLevel = 0; holding = false; spin = 0.6; orbitAppear = 0; shake.v = 0;
    gumU.uMix.value = 0;
    capMat.color.copy(lin(capColor || DUO.a.color));
    capMat.opacity = 1; capG.userData.ringMat.opacity = 1;
    capG.visible = true; capG.scale.setScalar(1); capG.rotation.set(0.25, -0.3, 0); capG.position.set(0, 0, 0);
    topPivot.position.set(0, 0, 0); topPivot.rotation.set(0, 0, 0);
    botPivot.position.set(0, 0, 0); botPivot.rotation.set(0, 0, 0);
    seamMat.opacity = 0; glow.material.opacity = 0; glow.scale.set(0.1, 0.1, 1); crackLight.intensity = 0;
    gumG.scale.setScalar(0.001); gumG.position.set(0, -0.2, 0); gumG.userData.baseY = 0.15; gum.rotation.set(0, 0, 0);
    burstMat.opacity = 0;
    berries.visible = leaves.visible = true;
    ov.style.backgroundColor = DUO.a.bg;
    updateUI();
  }
  function startChew() {
    setStage('chew');
    capG.visible = false;
  }
  function finish() {
    if (state === 'end') return;
    holding = false; ov.classList.remove('holding');
    setStage('end'); sfx(1.6);
    gsap.to(gumG.userData, { baseY: small ? 0.55 : 0.4, duration: 1.1, ease: 'power3.out' });
    gsap.to(gumG.scale, { x: 0.88, y: 0.88, z: 0.88, duration: 1.1, ease: 'power3.out' });
    gsap.to({ s: spin }, { s: 0.18, duration: 1.4, onUpdate() { spin = this.targets()[0].s; } });
  }
  function play(capColor) {
    resetScene(capColor);
    setStage('open');
    if (reduce) {
      capG.visible = false;
      tl = gsap.timeline()
        .to(gumG.scale, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'power2.out' })
        .to(gumG.position, { y: 0.15, duration: 0.5 }, '<')
        .add(startChew);
      return;
    }
    tl = gsap.timeline();
    tl.from(capG.scale, { x: 0.3, y: 0.3, z: 0.3, duration: 0.55, ease: 'back.out(2.2)' })
      .to(capG.rotation, { x: 0.1, y: 0, duration: 0.55, ease: 'power2.out' }, '<')
      .to(shake, { v: 1, duration: 0.75, ease: 'power2.in' })
      .to(seamMat, { opacity: 1, duration: 0.4, ease: 'power2.in' }, '-=0.45')
      .to(crackLight, { intensity: 7, duration: 0.4, ease: 'power2.in' }, '<')
      .to(glow.material, { opacity: 0.95, duration: 0.4 }, '<')
      .to(glow.scale, { x: 3.4, y: 1.4, duration: 0.42, ease: 'power3.in' }, '<')
      .add(() => { shake.v = 0; burst(); sfx(0.5); flash(); })
      .to(topPivot.position, { y: 3.2, x: -0.6, duration: 1, ease: 'power3.out' })
      .to(topPivot.rotation, { z: 0.7, x: -0.6, duration: 1, ease: 'power3.out' }, '<')
      .to(botPivot.position, { y: -3.4, x: 0.5, duration: 1, ease: 'power3.out' }, '<')
      .to(botPivot.rotation, { z: -0.5, x: 0.5, duration: 1, ease: 'power3.out' }, '<')
      .to([capMat, capG.userData.ringMat, seamMat], { opacity: 0, duration: 0.5 }, '<0.25')
      .to(glow.material, { opacity: 0, duration: 0.6 }, '<')
      .to(crackLight, { intensity: 0, duration: 0.6 }, '<')
      .to(gumG.scale, { x: 1, y: 1, z: 1, duration: 1.2, ease: 'elastic.out(1, 0.5)' }, '<-0.15')
      .to(gumG.position, { y: 0.15, duration: 0.9, ease: 'back.out(2)' }, '<')
      .add(startChew, '-=0.6');
  }
  function flash() {
    gsap.fromTo(ui.flash, { opacity: 0.85 }, { opacity: 0, duration: 0.6, ease: 'power2.out' });
  }

  /* ---------- ouverture / fermeture ---------- */
  function open(capColor) {
    if (!init()) return false;
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
    holding = false;
    document.documentElement.style.overflow = '';
    setTimeout(() => { ov.hidden = true; running = false; tl && tl.kill(); setStage('idle'); }, 380);
  }

  window.PopzyReveal = { open, close, DUO };
})();
