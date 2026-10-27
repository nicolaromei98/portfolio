// About badge for nicolaromei.com (The Profile, <section data-badge>): clear PVC badge holder,
// card art, physics and scene. Built from badge-lab/ by build-about-badge.mjs, do not edit.
// Loaded by nr-port.js: createAboutBadge(THREE, opts) with three r170.

// Clear PVC ID-badge holder with the paper card inside and a chrome split ring.
// The sleeve is one flat quad: its fragment shader traces the view ray through the near sheet,
// the paper card and the far sheet analytically (badge space), so the card is refracted with no
// render target and no extra pass. Seams, holes, zip and edges are distance fields (crisp at any
// zoom). Output is premultiplied light + (1 - transmittance), always rgb <= alpha, so the
// transparent canvas composites like real plastic over whatever HTML sits behind it.
// Thin wall ribbons give the cut edges a thickness when the badge turns edge-on.
//
// createBadge(THREE, { renderer, cardTexture, cardBackTexture, quality, cardFilm, refraction })
//   -> { group, update(elapsedSeconds, camera), dispose(), ringAnchor, envMap, setCard(front, back) }
// Units: cm. Origin: centre of the slot. The badge hangs along -Y, front faces +Z.
// ringAnchor (Vector3, badge space): the top of the split ring, where it hangs on its hook.
// Also returned (extras): holder = { top, bottom, left, right, width, height } outline in badge space.
// Card textures stay owned by the caller (dispose() never frees them).

// Measured on ref/reference-badge.png at 91.5 px/cm (the card is CR80, 5.4 x 8.6)
const BADGE_DIM = {
  top: 0.809, // slot centre -> top edge
  bot: 0.809 - 11.355,
  hw: 3.405, // half width
  ox: -0.01, // the slot sits a hair right of the holder's centre
  rad: 0.34, // outer corner radius
  weldL: 0.27, weldR: 0.25, weldB: 0.224, weldT: 0.213, weldRad: 0.26, // seam insets per side
  zipA: 1.455, zipB: 2.03, // zip-lock track and its lower lip, depth below the top edge
  cardX0: -2.618, cardX1: 2.782, cardY1: -1.509, cardY0: -1.509 - 8.6, cardT: 0.076,
  gap: 0.07, // half opening of the pocket over the card
  holeX: 1.972, holeY: -0.01, holeR: 0.2, // punched through; the pressed ring around it reaches ~0.25
  slotHL: 0.746, slotR: 0.206,
  wall: 0.022, // half thickness of the welded edge (two sheets)
};

// Split ring: two coils of round wire pressed together (~1.4 cm across), standing nearly edge-on
// with its right side forward, as in the reference. The bottom of the wire passes through the
// slot (pivot); the cut ends sit near the top, which leaves the section through its top edge.
const BADGE_RING = { R: 0.66, r: 0.12, x: 0.5, y: 0.03, yaw: -58, roll: 12, turns: 1.94, ends: 108 };

function createBadge(THREE, opts = {}) {
  const renderer = opts.renderer || null;
  const low = opts.quality === "low";
  const D = BADGE_DIM;
  const group = new THREE.Group();
  group.name = "pvc-badge";

  const noiseTex = badgeSheetNoise(THREE, low ? 128 : 256);
  // The PMREM bake needs a renderer; without one the ring falls back to plain lighting
  const envRT = renderer ? badgeStudioEnv(THREE, renderer, low) : null;
  const envMap = envRT ? envRT.texture : null;

  // ---------- sleeve: front + back sheets, seams, zip, header and card in one quad ----------
  const sleeveGeo = new THREE.PlaneGeometry(2 * D.hw + 0.4, D.top - D.bot + 0.4);
  sleeveGeo.translate(D.ox, (D.top + D.bot) / 2, 0);

  const uniforms = {
    uCard: { value: null },
    uCardBack: { value: null },
    uNoise: { value: noiseTex },
    uHasCard: { value: 0 },
    uHasBack: { value: 0 },
    uCardSRGB: { value: 0 },
    uBackSRGB: { value: 0 },
    uWaveMax: { value: noiseTex.userData.gradMax },
    // How much of the near sheet's film lies over the card (a photo crop of a card already
    // carries the plastic's haze, so callers pass less for those)
    uCardFilm: { value: opts.cardFilm ?? 0.55 },
    uRefract: { value: opts.refraction ?? 1.0 },
    // Matte (frosted) finish of the sheets, 0 = clear PVC
    uFrost: { value: opts.frost ?? 0.95 },
  };
  const defines = badgeShaderDefines(low);
  const premultiplied = {
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // rgb = light added by the plastic (premultiplied), alpha = 1 - transmittance
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  };
  const sleeveMat = new THREE.ShaderMaterial({
    ...premultiplied,
    uniforms,
    defines,
    vertexShader: BADGE_SLEEVE_VS,
    fragmentShader: BADGE_SLEEVE_FS,
  });
  const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat);
  sleeve.name = "pvc-sleeve";
  sleeve.renderOrder = 2;

  // ---------- cut-edge walls (outline, slot, holes): only visible as the badge turns ----------
  const wallGeo = badgeWallGeometry(THREE, low);
  const wallMat = new THREE.ShaderMaterial({
    ...premultiplied,
    defines,
    vertexShader: BADGE_WALL_VS,
    fragmentShader: BADGE_WALL_FS,
  });
  const walls = new THREE.Mesh(wallGeo, wallMat);
  walls.name = "pvc-walls";
  walls.renderOrder = 1; // under the sleeve: the far walls are seen through the film

  // ---------- chrome split ring through the slot ----------
  const ringMatrix = badgeRingMatrix(THREE);
  const ringGeo = badgeRingGeometry(THREE, low, ringMatrix);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xe2e2e4,
    metalness: 1,
    roughness: 0.1,
    envMap,
    envMapIntensity: 1,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.name = "split-ring";

  const ringAnchor = badgeRingTop(THREE, ringMatrix);
  const holder = { top: D.top, bottom: D.bot, left: D.ox - D.hw, right: D.ox + D.hw, width: 2 * D.hw, height: D.top - D.bot };

  group.add(ring, walls, sleeve);

  function syncTextureFlags() {
    // sRGB textures are decoded by the GPU; the shader works in display space, so it re-encodes them
    const c = uniforms.uHasCard.value ? uniforms.uCard.value : null;
    uniforms.uCardSRGB.value = c && c.colorSpace === THREE.SRGBColorSpace ? 1 : 0;
    const b = uniforms.uHasBack.value ? uniforms.uCardBack.value : null;
    uniforms.uBackSRGB.value = b && b.colorSpace === THREE.SRGBColorSpace ? 1 : 0;
  }

  function setCard(front, back) {
    uniforms.uCard.value = front || null;
    uniforms.uHasCard.value = front ? 1 : 0;
    // without a printed back the shader draws plain stock
    uniforms.uCardBack.value = back || null;
    uniforms.uHasBack.value = back ? 1 : 0;
    syncTextureFlags();
  }
  setCard(opts.cardTexture, opts.cardBackTexture);

  function update() {
    // Everything view-dependent is solved per pixel from the live matrices: nothing to render here.
    // A texture's colour space may be set after creation: keep the decode flags in step.
    syncTextureFlags();
  }

  function dispose() {
    sleeveGeo.dispose();
    sleeveMat.dispose();
    wallGeo.dispose();
    wallMat.dispose();
    ringGeo.dispose();
    ringMat.dispose();
    noiseTex.dispose();
    if (envRT) envRT.dispose();
    uniforms.uCard.value = uniforms.uCardBack.value = null;
    group.remove(sleeve, walls, ring);
    group.removeFromParent();
  }

  return { group, update, dispose, ringAnchor, envMap, setCard, holder };
}

// Shader defines from BADGE_DIM, so JS and GLSL share one set of measurements
function badgeShaderDefines(low) {
  const D = BADGE_DIM;
  const f = (v) => v.toFixed(4);
  return {
    QUALITY_HIGH: low ? 0 : 1,
    TOP: f(D.top), BOT: f(D.bot), HW: f(D.hw), OX: f(D.ox), RAD: f(D.rad),
    WELD_L: f(D.weldL), WELD_R: f(D.weldR), WELD_B: f(D.weldB), WELD_T: f(D.weldT), WELD_RAD: f(D.weldRad),
    ZIP_A: f(D.zipA), ZIP_B: f(D.zipB),
    CARD_X0: f(D.cardX0), CARD_X1: f(D.cardX1), CARD_Y0: f(D.cardY0), CARD_Y1: f(D.cardY1), CARD_T: f(D.cardT),
    GAP: f(D.gap), HOLE_X: f(D.holeX), HOLE_Y: f(D.holeY), HOLE_R: f(D.holeR),
    SLOT_HL: f(D.slotHL), SLOT_R: f(D.slotR), WALL_HZ: f(D.wall),
  };
}

// Tileable sheet relief (6 cm tile): RG = slope of the waviness + extrusion streaks,
// B = streak haze, A = soft blotches. Integer frequencies per tile keep it seamless.
function badgeSheetNoise(THREE, n) {
  const TILE = 6;
  let seed = 1234567;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const waves = [];
  // broad waviness of the film
  for (let i = 0; i < 14; i++) {
    const kx = Math.round((rnd() * 2 - 1) * 4);
    const ky = Math.round((rnd() * 2 - 1) * 6);
    if (!kx && !ky) continue;
    waves.push([kx, ky, 0.010 / Math.hypot(kx, ky), rnd() * 6.2832]);
  }
  // vertical extrusion streaks: fine in x, slow in y
  for (let i = 0; i < 22; i++) {
    const kx = 10 + Math.floor(rnd() * 70);
    const ky = Math.floor(rnd() * 3);
    waves.push([kx, ky, (0.00006 + rnd() * 0.00009) * (30 / kx), rnd() * 6.2832]);
  }
  const streaks = [];
  for (let i = 0; i < 9; i++) streaks.push([6 + Math.floor(rnd() * 40), Math.floor(rnd() * 2), rnd() * 6.2832, 0.5 + rnd()]);
  const blotch = [];
  for (let i = 0; i < 6; i++) blotch.push([Math.floor(rnd() * 4) + 1, Math.floor(rnd() * 5) + 1, rnd() * 6.2832]);

  const gx = new Float32Array(n * n);
  const gy = new Float32Array(n * n);
  const bb = new Float32Array(n * n);
  const aa = new Float32Array(n * n);
  let gmax = 1e-6;
  const k2 = (2 * Math.PI) / TILE;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i / n) * TILE;
      const y = (j / n) * TILE;
      let dx = 0, dy = 0;
      for (const [kx, ky, a, ph] of waves) {
        const c = Math.cos(k2 * (kx * x + ky * y) + ph) * a * k2;
        dx += c * kx;
        dy += c * ky;
      }
      let s = 0;
      for (const [kx, ky, ph, w] of streaks) s += w * Math.pow(0.5 + 0.5 * Math.sin(k2 * (kx * x + ky * y) + ph), 6);
      let b = 0;
      for (const [kx, ky, ph] of blotch) b += Math.sin(k2 * (kx * x + ky * y) + ph);
      const idx = j * n + i;
      gx[idx] = dx;
      gy[idx] = dy;
      bb[idx] = Math.min(1, s / 2.2);
      aa[idx] = 0.5 + b / 12;
      gmax = Math.max(gmax, Math.abs(dx), Math.abs(dy));
    }
  }
  const data = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    data[k * 4] = Math.round(127.5 + 127.5 * (gx[k] / gmax));
    data[k * 4 + 1] = Math.round(127.5 + 127.5 * (gy[k] / gmax));
    data[k * 4 + 2] = Math.round(255 * bb[k]);
    data[k * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, aa[k])));
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.userData.gradMax = gmax;
  return tex;
}

// Small procedural photo studio baked once into a PMREM map for the chrome (and any other metal
// in the scene, via envMap). Core three only. A grey room, darkest toward the camera, lit by
// white strips: the wire reads mid-grey with crisp white and near-black streaks, as in the
// photo. Window strip on the left, dark flag on the right, white table below.
function badgeStudioEnv(THREE, renderer, low) {
  const scene = new THREE.Scene();
  const trash = [];
  const room = new THREE.SphereGeometry(20, low ? 16 : 32, low ? 8 : 16);
  const pos = room.attributes.position;
  const col = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / 20, y = pos.getY(i) / 20, z = pos.getZ(i) / 20;
    let v = 0.26 + 0.2 * y;
    v *= 1 - 0.9 * Math.min(1, Math.max(0, (z - 0.1) / 0.6)); // the camera side
    v *= 1 - 0.6 * Math.min(1, Math.max(0, (x - 0.3) / 0.5)); // the flag side
    col.push(v, v, v * 1.02);
  }
  room.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const roomMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  scene.add(new THREE.Mesh(room, roomMat));
  trash.push(room, roomMat);
  const panel = (w, h, x, y, z, v) => {
    const g = new THREE.PlaneGeometry(w, h);
    const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    m.color.setRGB(v, v, v);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
    trash.push(g, m);
  };
  panel(2.5, 9, -8, 4, 12, 4.0); // key strip behind the camera, up-left
  panel(3, 18, -13, 1, 3, 6.0); // tall window strip on the left
  panel(16, 3, 0, 15, -1, 4.0); // overhead
  panel(2, 14, 13, 0, -5, 2.5); // thin rim from the back right
  panel(4, 16, 12, 0, 6, 0.01); // dark flag on the right
  panel(20, 12, 0, -14, 2, 1.6); // white table below
  const pmrem = new THREE.PMREMGenerator(renderer);
  let rt;
  if (low) {
    // phones: a 128 px cube instead of fromScene's fixed 256 (a quarter of the memory)
    const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.1, 100, cubeRT);
    cam.update(renderer, scene);
    rt = pmrem.fromCubemap(cubeRT.texture);
    cubeRT.dispose();
  } else {
    rt = pmrem.fromScene(scene, 0.02);
  }
  pmrem.dispose();
  for (const t of trash) t.dispose();
  return rt;
}

// Ring placement in badge space: plane turned about Y, lifted so the wire's bottom sits at the
// pivot in the slot, rolled about that pivot
function badgeRingMatrix(THREE) {
  const K = BADGE_RING;
  const deg = Math.PI / 180;
  return new THREE.Matrix4()
    .makeTranslation(K.x, K.y, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(K.roll * deg))
    .multiply(new THREE.Matrix4().makeTranslation(0, K.R, 0))
    .multiply(new THREE.Matrix4().makeRotationY(K.yaw * deg));
}

// Highest point of the ring (outer surface, between the two coils): where its hook holds it
function badgeRingTop(THREE, matrix) {
  const { R, r } = BADGE_RING;
  const v = new THREE.Vector3();
  const best = new THREE.Vector3(0, -Infinity, 0);
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * Math.PI * 2;
    v.set(Math.cos(a) * R, Math.sin(a) * R, 0).applyMatrix4(matrix);
    if (v.y > best.y) best.copy(v);
  }
  best.y += r * 0.58;
  return best;
}

// Two coils of wire pressed together (a key ring); the cut ends are tapered. Each coil is its own
// tube, but the normals are taken from the pair's common axis, so the coils shade as one round
// rod with a fine seam, like the chrome in the photo. One mesh with the placement baked in.
function badgeRingGeometry(THREE, low, matrix) {
  const { R, r, turns, ends } = BADGE_RING;
  const cw = r * 0.55, ch = r * 0.58; // axial and radial half-size of one coil
  const pitch = cw * 2; // the coils touch
  const segs = low ? 150 : 300, sides = low ? 10 : 16;
  const a0 = (ends * Math.PI) / 180;
  const len = turns * Math.PI * 2 * R;
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = a0 - t * turns * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const off = (t - 0.5) * pitch * turns;
    // axis of the pair: the first turn lies below the second (blended where they swap)
    const side = Math.max(-1, Math.min(1, (0.5 - t) * turns * 8));
    const axis = off + side * cw;
    // the cut ends: the wire narrows over its last ~1.5 mm, like a sheared end
    const sEnd = Math.min(t, 1 - t) * len;
    const taper = 0.35 + 0.65 * Math.min(1, sEnd / 0.15);
    for (let j = 0; j < sides; j++) {
      const p = (j / sides) * Math.PI * 2;
      const cp = Math.cos(p), sp = Math.sin(p);
      const rr = R + cp * ch * taper;
      const z = off + sp * cw * taper;
      pos.push(ca * rr, sa * rr, z);
      const nx = (rr - R) / ch, nz = (z - axis) / (2 * cw);
      const l = Math.sqrt(nx * nx + nz * nz) || 1;
      nrm.push((ca * nx) / l, (sa * nx) / l, nz / l);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + ((j + 1) % sides);
      const c = a + sides, d = b + sides;
      idx.push(a, b, c, b, d, c);
    }
  }
  // end caps (fans) so the cut ends are closed
  for (const [ring, flip] of [[0, true], [segs, false]]) {
    const base = ring * sides;
    const centre = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < sides; j++) { cx += pos[(base + j) * 3]; cy += pos[(base + j) * 3 + 1]; cz += pos[(base + j) * 3 + 2]; }
    const t = ring / segs, a = a0 - t * turns * Math.PI * 2;
    // cap normal along the wire's tangent, pointing out of the wire
    const tx = Math.sin(a), ty = -Math.cos(a), dir = flip ? -1 : 1;
    pos.push(cx / sides, cy / sides, cz / sides);
    nrm.push(tx * dir, ty * dir, 0);
    for (let j = 0; j < sides; j++) {
      const p = base + j, q = base + ((j + 1) % sides);
      if (flip) idx.push(centre, q, p);
      else idx.push(centre, p, q);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  geo.applyMatrix4(matrix);
  return geo;
}

// Thin walls along every cut edge (outline, slot, two holes) as closed ribbons, one geometry:
// face-on they have no area, edge-on they keep the badge from vanishing.
function badgeWallGeometry(THREE, low) {
  const D = BADGE_DIM;
  const arc = low ? 6 : 12;
  const pos = [], nor = [], idx = [];
  // pts run counter-clockwise; out = +1 when the wall faces away from the loop's inside
  const ribbon = (pts, out) => {
    const base = pos.length / 3, n = pts.length;
    for (let i = 0; i < n; i++) {
      const [x, y] = pts[i];
      const [xp, yp] = pts[(i - 1 + n) % n];
      const [xn, yn] = pts[(i + 1) % n];
      let tx = xn - xp, ty = yn - yp;
      const l = Math.hypot(tx, ty) || 1;
      tx /= l; ty /= l;
      pos.push(x, y, -D.wall, x, y, D.wall);
      nor.push(ty * out, -tx * out, 0, ty * out, -tx * out, 0);
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2, b = base + ((i + 1) % n) * 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  };
  const cy = (D.top + D.bot) / 2, hh = (D.top - D.bot) / 2, r = D.rad;
  const outline = [];
  const corners = [[D.hw - r, -hh + r, -Math.PI / 2], [D.hw - r, hh - r, 0], [-D.hw + r, hh - r, Math.PI / 2], [-D.hw + r, -hh + r, Math.PI]];
  for (const [ox, oy, a0] of corners) {
    for (let k = 0; k <= arc; k++) {
      const a = a0 + (k / arc) * (Math.PI / 2);
      outline.push([D.ox + ox + r * Math.cos(a), cy + oy + r * Math.sin(a)]);
    }
  }
  ribbon(outline, 1);
  const slot = [];
  const hl = D.slotHL - D.slotR;
  for (let k = 0; k <= arc * 2; k++) { const a = -Math.PI / 2 + (k / (arc * 2)) * Math.PI; slot.push([hl + D.slotR * Math.cos(a), D.slotR * Math.sin(a)]); }
  for (let k = 0; k <= arc * 2; k++) { const a = Math.PI / 2 + (k / (arc * 2)) * Math.PI; slot.push([-hl + D.slotR * Math.cos(a), D.slotR * Math.sin(a)]); }
  ribbon(slot, -1);
  for (const sx of [-1, 1]) {
    const hole = [];
    for (let k = 0; k < arc * 4; k++) {
      const a = (k / (arc * 4)) * Math.PI * 2;
      hole.push([sx * D.holeX + D.holeR * Math.cos(a), D.holeY + D.holeR * Math.sin(a)]);
    }
    ribbon(hole, -1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}

// ---------- GLSL ----------

// Shared by the sleeve and the walls: helpers and the analytic studio
const BADGE_GLSL_COMMON = /* glsl */ `
#define IOR 1.54
float gauss(float x, float w) { return exp(-(x * x) / (w * w)); }
float band(float x, float a, float b, float s) { return smoothstep(a - s, a + s, x) * (1.0 - smoothstep(b - s, b + s, x)); }
// Anti-aliased line of width w (cm) on a distance field; fades instead of aliasing when thinner than a pixel
float aline(float d, float w, float pix) {
  float ww = max(w, pix);
  return (1.0 - smoothstep(ww * 0.5 - pix * 0.5, ww * 0.5 + pix * 0.5, abs(d))) * min(1.0, w / pix);
}
float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(float x) { float i = floor(x), t = fract(x); return mix(hash11(i), hash11(i + 1.0), t * t * (3.0 - 2.0 * t)); }
float vnoise2(vec2 p) {
  vec2 i = floor(p), t = fract(p);
  vec2 u = t * t * (3.0 - 2.0 * t);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fresnel(float c) {
  float f0 = pow((IOR - 1.0) / (IOR + 1.0), 2.0);
  return f0 + (1.0 - f0) * pow(1.0 - c, 5.0);
}
// Analytic studio in view space (it stays put relative to the camera, like the product photo):
// a soft window on the left and a dark flag on the right draw the bright/dark lips of the
// reference; the overhead strip lights upward-facing ridges, the floor the bottom edge.
float envLight(vec3 r) {
  float e = 0.86 + 0.08 * r.y;
  // soft key behind the camera, up-left: broad gradients on the flat film
  e += 0.22 * smoothstep(0.82, 0.99, dot(r, normalize(vec3(-0.35, 0.35, 1.0))));
  // window on the left
  e += 0.75 * (1.0 - smoothstep(-0.55, -0.12, r.x)) * smoothstep(-0.6, 0.0, r.z) * (1.0 - smoothstep(0.55, 0.95, abs(r.y)));
  // dark flag on the right, then a thin strip further round, so a turning badge always sweeps a sheen
  e *= 1.0 - 0.7 * smoothstep(0.12, 0.5, r.x);
  e += 1.4 * smoothstep(0.86, 0.94, r.x) * (1.0 - smoothstep(0.5, 0.9, abs(r.y)));
  // overhead strip
  e += 1.2 * smoothstep(0.6, 0.85, r.y) * (1.0 - smoothstep(0.35, 0.7, abs(r.x)));
  // pale floor
  e += 0.6 * (1.0 - smoothstep(-0.75, -0.45, r.y));
  return e;
}
`;

const BADGE_SLEEVE_VS = /* glsl */ `
varying vec3 vLocal;
varying vec3 vCamLocal;
varying vec3 vFwdLocal;
varying vec3 vViewPos;
varying vec3 vNM0;
varying vec3 vNM1;
varying vec3 vNM2;
varying vec3 vZWorld;
void main() {
  vLocal = position;
  // Camera in badge space: the shader traces rays there, so any transform of the group works
  mat4 inv = inverse(modelMatrix);
  vCamLocal = (inv * vec4(cameraPosition, 1.0)).xyz;
  vec3 fwdWorld = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vFwdLocal = (inv * vec4(fwdWorld, 0.0)).xyz;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vNM0 = normalMatrix[0];
  vNM1 = normalMatrix[1];
  vNM2 = normalMatrix[2];
  vZWorld = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  gl_Position = projectionMatrix * mv;
}
`;

const BADGE_SLEEVE_FS = /* glsl */ `
uniform sampler2D uCard;
uniform sampler2D uCardBack;
uniform sampler2D uNoise;
uniform float uHasCard;
uniform float uHasBack;
uniform float uCardSRGB;
uniform float uBackSRGB;
uniform float uWaveMax;
uniform float uCardFilm;
uniform float uRefract;
uniform float uFrost;

varying vec3 vLocal;
varying vec3 vCamLocal;
varying vec3 vFwdLocal;
varying vec3 vViewPos;
varying vec3 vNM0;
varying vec3 vNM1;
varying vec3 vNM2;
varying vec3 vZWorld;

#define PILLOW 0.035
#define TILE 6.0
// share of the view a steep bend of the film turns to the studio
#define LENS 0.34
${BADGE_GLSL_COMMON}

// view state shared by the helpers below (set at the top of main)
vec3 gView;
mat3 gNM;
float gSide;

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdOuter(vec2 p) { return sdBox(p - vec2(OX, (TOP + BOT) * 0.5), vec2(HW, (TOP - BOT) * 0.5), RAD); }
float sdWeld(vec2 p) {
  vec2 lo = vec2(OX - HW + WELD_L, BOT + WELD_B);
  vec2 hi = vec2(OX + HW - WELD_R, TOP - WELD_T);
  return sdBox(p - (lo + hi) * 0.5, (hi - lo) * 0.5, WELD_RAD);
}
// Pocket distance with a soft interior (no diagonal crease where the sides meet)
float sdPocket(vec2 p) {
  vec2 lo = vec2(OX - HW + WELD_L, BOT + WELD_B);
  vec2 hi = vec2(OX + HW - WELD_R, TOP - ZIP_B);
  vec2 q = abs(p - (lo + hi) * 0.5) - (hi - lo) * 0.5 + 0.1;
  float inner = 0.5 * (q.x + q.y + sqrt((q.x - q.y) * (q.x - q.y) + 0.04));
  return length(max(q, 0.0)) + min(inner, 0.0) - 0.1;
}
// Distance to the side and bottom welds only: the pillow fades in under the zip instead of
// drawing a rounded pocket outline there
float sdSides(vec2 p) {
  float x = min(p.x - (OX - HW + WELD_L), (OX + HW - WELD_R) - p.x);
  float y = p.y - (BOT + WELD_B);
  return -min(x, y);
}
float sdCard(vec2 p) {
  return sdBox(p - vec2((CARD_X0 + CARD_X1) * 0.5, (CARD_Y0 + CARD_Y1) * 0.5),
               vec2((CARD_X1 - CARD_X0) * 0.5, (CARD_Y1 - CARD_Y0) * 0.5), 0.035);
}
float sdHoles(vec2 p) {
  return min(length(p - vec2(-HOLE_X, HOLE_Y)), length(p - vec2(HOLE_X, HOLE_Y))) - HOLE_R;
}
float sdSlot(vec2 p) {
  return length(vec2(max(abs(p.x) - (SLOT_HL - SLOT_R), 0.0), p.y)) - SLOT_R;
}

// Height of a sheet above its rest plane (outward): the pocket pillows over the card. The fine
// structure (welds, zip, rims) is painted in sleevePaint, its sheen driven by glint().
float sheetHeight(vec2 p) {
  float h = 0.0;
  float dS = sdSides(p);
  if (dS < 0.0) {
    float dC = sdCard(p);
    float t = dC <= 0.0 ? 1.0 : clamp(-dS / max(-dS + dC, 1e-4), 0.0, 1.0);
    float mouth = smoothstep(ZIP_B - 0.02, ZIP_B + 0.4, TOP - p.y);
    h += mouth * (0.012 * (1.0 - exp(dS / 0.08)) + PILLOW * smoothstep(0.0, 1.0, t));
  }
  return h;
}

vec2 sheetGrad(vec2 p, float e) {
  float h0 = sheetHeight(p);
  return vec2(sheetHeight(p + vec2(e, 0.0)) - h0, sheetHeight(p + vec2(0.0, e)) - h0) / e;
}

vec4 sheetNoise(vec2 p) { return texture2D(uNoise, p / TILE); }

// One clear sheet over the pocket: transmittance T, scattered light L, coverage c (0 in holes/outside)
void sheetFilm(vec2 p, float pix, vec4 nz, out float T, out float L, out float c) {
  float dO = sdOuter(p);
  c = (1.0 - smoothstep(-pix * 0.5, pix * 0.5, dO)) * smoothstep(-pix * 0.5, pix * 0.5, min(sdHoles(p), sdSlot(p)));
  // nearly clear PVC with faint extrusion streaks; the light it takes out is partly scattered
  // back (albedo ~0.3): the same film darkens a white page and lightens a dark one
  T = 0.993 - 0.007 * nz.b;
  L = 0.3 * (1.0 - T) + 0.004 * nz.b;
}

// Studio light a strip of film bent by 'tilt' toward 'dir' (badge xy) reflects, relative to what
// it reflects in the front view, where the painted tones were matched to the photo: lips, ridges
// and rims keep their look face-on and sweep with the studio as the badge turns.
float glint(vec2 dir, float tilt) {
  vec3 n = normalize(vec3(dir * tilt, 1.0));
  float e0 = envLight(reflect(vec3(0.0, 0.0, -1.0), n));
  float e = envLight(reflect(gView, normalize(gNM * vec3(n.xy, n.z * gSide))));
  return clamp(e / e0, 0.0, 2.5);
}

// Layers stacked toward the viewer. DIM: takes k of the light behind it (page and earlier layers)
// and scatters k * c back
#define DIM(k, c) { float k_ = (k); T *= 1.0 - k_; L = L * (1.0 - k_) + k_ * (c); }
// A reflection: white light g, carried with the same alpha (a valid premultiplied colour)
#define SHINE(g) { float g_ = clamp(g, 0.0, 1.0); T *= 1.0 - g_; L = L * (1.0 - g_) + g_; }

// Which outer edge is nearest: left, right, top, bottom weights (sum 1)
void sideWeights(vec2 p, out float wl, out float wr, out float wt, out float wb) {
  float ex = HW - abs(p.x - OX);
  float et = TOP - p.y, eb = p.y - BOT;
  float sv = smoothstep(-0.05, 0.05, min(et, eb) - ex);
  wl = sv * (1.0 - step(OX, p.x));
  wr = sv - wl;
  wt = (1.0 - sv) * step(et, eb);
  wb = 1.0 - sv - wt;
}

// The welded pair's structure, painted once (the sheets are fused wherever it lies): region tones,
// double cut edge, seams, zip-lock, holes, slot and the small irregularities of the photo.
// Tones were matched to ref/reference-badge.png as ratios to the page behind; the bright lips and
// strips are reflections of the studio (SHINE), so they stay bright on a dark page too.
void sleevePaint(vec2 p, float pix, vec4 nz, float onCard, out float T, out float L) {
  T = 1.0;
  L = 0.0;
  float wl, wr, wt, wb;
  sideWeights(p, wl, wr, wt, wb);
  float ws = wl + wr;
  // position along the nearest edge: the irregularities run along it
  float along = p.y * ws + p.x * (1.0 - ws);
  float d = -sdOuter(p);     // depth inside the cut edge
  // > 0 on the flange outside the seam; a hand-fed heat seal wanders by ~0.1 mm over centimetres
  float dW = sdWeld(p) + 0.02 * (vnoise(along * 0.8 + 3.0) - 0.5) + 0.007 * (vnoise(along * 2.7 + 1.0) - 0.5);
  float yb = TOP - p.y;      // depth below the top edge
  float flange = smoothstep(-pix * 0.5, pix * 0.5, dW);
  float inner = 1.0 - flange;
  float brk = smoothstep(0.35, 0.75, vnoise(along * 1.3 + 4.0));
  float brk2 = smoothstep(0.3, 0.7, vnoise(along * 2.1 + 11.0));
  float wob = vnoise(along * 3.1 + 7.0) - 0.5;
  // the side flanges are greyest along the pocket, clearer beside the header and near the bottom
  float midSide = smoothstep(ZIP_A, ZIP_B + 0.3, yb) * smoothstep(BOT + 0.3, BOT + 1.2, p.y);
  // strips bent toward the window (left), the flag (right), the ceiling and the floor
  float gWin = glint(vec2(-1.0, 0.0), 0.3);
  float gFlag = glint(vec2(1.0, 0.0), 0.3);
  float gUp = glint(vec2(0.0, 1.0), 0.3);
  float gDown = glint(vec2(0.0, -1.0), 0.3);

  // ---- region tones inside the seam: fused header, zip-lock track, its milky lower lip
  // (the track wavers a little along its length, like an extruded profile)
  float yz = yb + 0.004 * sin(p.x * 2.3 + 1.0) + 0.003 * (vnoise(p.x * 7.0) - 0.5);
  float hdr = 1.0 - smoothstep(ZIP_A - 0.01, ZIP_A + 0.01, yz);
  float kZ = hdr * (0.122 + 0.004 * nz.b + 0.012 * (nz.a - 0.5) - 0.045 * band(yb, 0.2, 0.26, 0.012));
  kZ += band(yz, ZIP_A, 1.6, 0.012) * 0.23 + band(yz, 1.6, 1.845, 0.01) * 0.36;
  kZ += band(yz, 1.845, ZIP_B, 0.012) * 0.23;
  // the strip under the lip, where the two sheets part, is still a little milky
  kZ += band(yb, ZIP_B, 2.32, 0.04) * 0.05 * (1.0 - onCard);
  // pocket margins: a faint milky film (not over the card: it has its own), clearer on the right
  kZ += smoothstep(ZIP_B, ZIP_B + 0.08, yb) * 0.012 * (1.0 - onCard) * (1.0 - 0.6 * smoothstep(CARD_X1 - 0.1, CARD_X1 + 0.1, p.x));
  DIM(inner * kZ, 0.32);
  // zip-lock ridges: dark grooves and pale crests, uneven along the track, across the seams too
  // (the ridges are pinched flat over the last ~0.5 mm before the seams)
  float zw = (inner * smoothstep(0.0, 0.06, -dW) + 0.2 * flange) * (0.75 + 0.5 * vnoise(p.x * 3.0 + 2.0));
  float zg = 0.0;
  zg += 0.08 * aline(yz - 1.462, 0.014, pix) + 0.07 * aline(yz - 1.51, 0.014, pix) + 0.05 * aline(yz - 1.555, 0.012, pix);
  zg += 0.1 * aline(yz - 1.625, 0.022, pix) + 0.1 * aline(yz - 1.675, 0.02, pix) + 0.09 * aline(yz - 1.722, 0.018, pix);
  zg += 0.07 * aline(yz - 1.767, 0.018, pix) + 0.07 * aline(yz - 1.81, 0.02, pix) + 0.05 * aline(yz - 1.85, 0.014, pix);
  DIM(zw * zg, 0.2);
  float zc = 0.12 * aline(yz - 1.48, 0.012, pix) + 0.1 * aline(yz - 1.653, 0.012, pix) + 0.06 * aline(yz - 1.70, 0.012, pix)
           + 0.06 * aline(yz - 1.745, 0.012, pix) + 0.05 * aline(yz - 1.79, 0.012, pix);
  SHINE(zw * zc * gUp);
  // the clear band below the lip catches the floor
  SHINE(inner * 0.05 * gDown * gauss(yb - 2.14, 0.06) * (1.0 - onCard));
#if QUALITY_HIGH
  // glossy, frosty specks where the interlocking teeth were scuffed
  float scuff = smoothstep(0.62, 0.92, vnoise2(p * vec2(9.0, 42.0))) * (band(p.x, -1.7, -0.8, 0.3) * 0.7 + band(p.x, 0.0, 1.9, 0.3));
  SHINE(inner * scuff * band(yz, 1.56, 1.78, 0.02) * 0.4 * gUp);
#endif

  // ---- flange outside the seam
  // left: grey, with a broken bright line mid-flange, a darker band, a bright hairline at the seam
  float kF = wl * mix(0.06, 0.15, midSide) + 0.03 * wr + 0.065 * wt;
  kF += wl * 0.1 * band(dW, 0.03, 0.085, 0.012) * midSide;
  DIM(flange * kF, 0.3);
  SHINE(flange * wl * gWin * (0.45 * brk * aline(d - 0.17, 0.014, pix) + 0.5 * aline(dW - 0.022, 0.012, pix)));
  // right: the flange curls up toward the cut and mirrors the window in two bright strips
  SHINE(flange * wr * gWin * (0.55 * aline(d - 0.105, 0.016, pix) + 0.7 * band(d, 0.155, 0.215, 0.012) * (0.8 + 0.2 * brk)));
  // bottom and top flanges: sheen from the floor and the ceiling
  SHINE(flange * wb * gDown * (0.25 * band(d, 0.05, 0.17, 0.03) + 0.45 * aline(dW - 0.03, 0.03, pix)));
  SHINE(flange * wt * gUp * 0.15 * band(d, 0.05, 0.17, 0.03));

  // ---- outer cut edge: both sheets' edges a hair apart (the double outline); side edges face
  // the dark flags, top and bottom catch the ceiling and the floor
  float rim1 = aline(d - 0.036, 0.03, pix);
  float rim2 = aline(d - 0.074 - 0.008 * wob, 0.02, pix);
  DIM(rim1 * (0.34 * wl + 0.32 * wr + 0.13 * wt + 0.13 * wb), 0.18);
  DIM(rim2 * (0.2 * wl + 0.04 * wr + 0.03), 0.2);
  DIM(aline(d - 0.01, 0.02, pix) * 0.1, 0.25);
  // the cut's rounded lip mirrors the studio as the badge turns
  SHINE(aline(d - 0.054, 0.012, pix) * 0.2 * (wl * gWin + wr * gFlag + wt * gUp + wb * gDown));

  // ---- seam: a crisp dark line, wavy like a real heat seal
  float dWw = dW + 0.003 * wob;
  DIM((0.62 * wl + 0.7 * wr + 0.45 * wt + 0.4 * wb) * aline(dWw, 0.026, pix), 0.12);
  // the film rising out of the seam: a bright lip on the left and the bottom (it mirrors the
  // window and the floor), a dark one on the right (it mirrors the flag), light under the top seam
  SHINE(inner * aline(dWw + 0.032, 0.036, pix) * (wl * 0.72 * gWin * (0.7 + 0.3 * brk2) + wb * 0.55 * gDown));
  DIM(inner * wr * band(-dW, 0.035, 0.1, 0.015) * 0.2, 0.15);
  DIM(inner * wr * 0.05 * (1.0 - smoothstep(0.07, 0.24, -dW)) * (1.0 - hdr), 0.25);
  SHINE(inner * wr * 0.3 * gFlag * aline(dWw + 0.016, 0.014, pix));
  DIM(inner * wb * 0.015 * (1.0 - smoothstep(0.05, 0.16, -dW)), 0.25);
  // right margin: the film over the card's edge mirrors the window
  // (bright at the card's edge, fading out over ~2 mm toward the seam)
  float cardR = smoothstep(CARD_X1 - 0.03, CARD_X1 + 0.005, p.x) * (exp(-max(p.x - CARD_X1, 0.0) / 0.12) + 0.12 * smoothstep(0.03, 0.08, -dW));
  SHINE(inner * 0.7 * gWin * cardR * smoothstep(CARD_Y0, CARD_Y0 + 0.6, p.y) * (1.0 - smoothstep(CARD_Y1 - 0.2, CARD_Y1 + 0.2, p.y)));

  // ---- the little irregularities of cheap PVC along the left seam: thin broken highlight lines
  // just inside it, and wet glare where the zip's welded end bunches the sheet (below the track,
  // and a softer wedge above it)
  SHINE(inner * wl * gWin * (0.35 * brk * aline(dW + 0.075, 0.008, pix) + 0.25 * brk2 * aline(dW + 0.125, 0.006, pix)) * (1.0 - hdr));
#if QUALITY_HIGH
  float gEdge = smoothstep(0.25, 0.75, vnoise(p.y * 7.0 + 2.0));
  float glare = gauss(dW + 0.08 + 0.025 * gEdge, 0.06) * band(yb, 1.9, 2.75, 0.18) * wl;
  SHINE(inner * glare * (0.6 + 0.35 * gEdge) * gWin);
  float wedge = gauss(dW + 0.05 + 0.15 * smoothstep(1.45, 0.9, yb), 0.05) * band(yb, 0.95, 1.44, 0.12) * wl;
  SHINE(inner * wedge * 0.35 * gWin);
#endif

  // ---- zip ends pinched by the side seams: the seal bulges and crimps into an irregular dark
  // mark, with glossy blobs of squeezed plastic beside it
  float zipEnd = band(yb, ZIP_A - 0.06, 1.87, 0.03) * ws;
  float cn = vnoise(p.y * 9.0 + 5.0 * wr);
  float cn2 = vnoise(p.y * 23.0 + 2.0);
  float crimp = zipEnd * (0.7 + 0.3 * cn);
  // the seal line itself swells into the track: a dark lens, widest mid-track
  float lens = sin(3.14159 * clamp((yb - ZIP_A + 0.06) / (1.93 - ZIP_A), 0.0, 1.0));
  float dWc = dW + zipEnd * (0.012 + 0.012 * cn2 + 0.02 * lens);
  DIM(0.88 * crimp * aline(dWc + 0.018, 0.02 + 0.035 * lens + 0.015 * cn, pix), 0.08);
  float blob = smoothstep(0.15, 0.6, vnoise(p.y * 11.0 + 3.0 + 7.0 * wr));
  SHINE(zipEnd * gauss(dW + 0.065 + 0.02 * cn2, 0.045) * blob * 0.85 * wl * gWin);
  // the right end bunches more: a wider wet blob beside the seam
  SHINE(zipEnd * gauss(dW + 0.1 + 0.03 * cn2, 0.07) * (0.35 + 0.65 * blob) * 0.85 * wr);
  SHINE(0.25 * zipEnd * flange * gauss(dW - 0.07, 0.04));

  // ---- punched holes: a pressed ring around the punch, its dark outer step (heavier on the lower
  // right, broken by a bright notch at the top), a pale halo outside, a fine line at the cut
  vec2 hv = p - vec2(sign(p.x) * HOLE_X, HOLE_Y);
  float hr = length(hv);
  vec2 hd = hv / max(hr, 1e-4);
  float dH = hr - HOLE_R;
  float lr = smoothstep(-0.8, 0.9, dot(hd, vec2(0.6, -0.8)));
  float notch = smoothstep(0.86, 0.98, hd.y);
  SHINE(0.3 * aline(dH - 0.005, 0.014, pix) * gUp * (1.0 - 0.5 * lr));
  DIM((0.48 + 0.34 * lr) * (1.0 - 0.8 * notch) * aline(dH - 0.052, 0.03 + 0.012 * lr, pix), 0.12);
  SHINE(0.4 * notch * aline(dH - 0.054, 0.03, pix) * gUp);
  SHINE((0.1 + 0.15 * (1.0 - lr)) * gauss(dH - 0.1, 0.035) * gWin);
  DIM(0.07 * aline(dH - 0.12, 0.02, pix) * lr, 0.3);
  // slot: rim darker along the bottom and the left cap, a bevel glint along its top
  vec2 sq = p - vec2(clamp(p.x, -(SLOT_HL - SLOT_R), SLOT_HL - SLOT_R), 0.0);
  vec2 sdir = sq / max(length(sq), 1e-4);
  float bt = smoothstep(-0.5, 0.9, dot(sdir, vec2(-0.35, -0.94)));
  float dS = sdSlot(p);
  DIM((0.32 + 0.38 * bt) * aline(dS - 0.012, 0.022, pix), 0.15);
  SHINE(0.45 * (1.0 - bt) * aline(dS - 0.038, 0.026, pix) * gUp);
  DIM(0.05 * aline(dS - 0.075, 0.02, pix), 0.3);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 cardFront(vec2 uv) {
  vec3 c = texture2D(uCard, uv).rgb;
  return uCardSRGB > 0.5 ? toSRGB(c) : c;
}
vec3 cardBack(vec2 uv, vec4 nz, float grainFade) {
  if (uHasBack > 0.5) {
    vec3 c = texture2D(uCardBack, uv).rgb;
    return uBackSRGB > 0.5 ? toSRGB(c) : c;
  }
  // plain cream stock: soft mottle, a fine fibre grain (faded out before it would shimmer) and a
  // slightly darker trimmed edge
  float g = (vnoise2(uv * vec2(270.0, 430.0)) - 0.5) * grainFade + (vnoise2(uv * vec2(60.0, 96.0)) - 0.5) * 0.5;
  vec2 ed = min(uv, 1.0 - uv) * vec2(5.4, 8.6);
  float trim = mix(0.94, 1.0, smoothstep(0.0, 0.05, min(ed.x, ed.y)));
  return vec3(0.955, 0.94, 0.895) * (0.985 + 0.03 * nz.a + 0.05 * g) * trim;
}

void main() {
  vec3 vL = isOrthographic ? normalize(vFwdLocal) : normalize(vLocal - vCamLocal);
  // s = +1 when the camera is on the front (+Z) side. Work in "side space" where the near sheet faces +z.
  float s = vL.z < 0.0 ? 1.0 : -1.0;
  vec3 vs = vec3(vL.xy, vL.z * s);
  vs.z = min(vs.z, -0.03);
  vs = normalize(vs);
  vec2 slope = vs.xy / -vs.z;

  vec2 p0 = vLocal.xy;
  vec2 fw = fwidth(p0);
  float pix = max(max(fw.x, fw.y), 1e-4);
  float e = max(pix, 0.004);

  vec3 vView = isOrthographic ? vec3(0.0, 0.0, -1.0) : normalize(vViewPos);
  mat3 nm = mat3(vNM0, vNM1, vNM2);
  gView = vView;
  gNM = nm;
  gSide = s;
  float kWave = uWaveMax * 2.0;

  // Gap between the sheets: open over the pocket, zero where they are welded or fused
  float gap = GAP * clamp(-sdPocket(p0) / 0.25, 0.0, 1.0);

  // ---------- near sheet ----------
  vec2 pN = p0 - slope * gap;
  vec4 nzN = sheetNoise(pN);
  float dPN = sdPocket(pN);
  float waveN = mix(0.35, 1.0, step(dPN, 0.0));
  vec2 gN = sheetGrad(pN, e) + (nzN.rg - 0.5) * kWave * waveN;
  vec3 nN = normalize(vec3(-gN, 1.0));
  float TN, LN, cN;
  sheetFilm(pN, pix, nzN, TN, LN, cN);
  float cosN = clamp(dot(-vs, nN), 0.0, 1.0);
  float FN = fresnel(cosN);
  vec3 rN = reflect(vView, normalize(nm * vec3(nN.xy, nN.z * s)));
  float eN = envLight(rN);
  float Tn = TN * (1.0 - FN);
  float Ln = LN + FN * eN;
  // Where the film bends (the pillow's shoulders) it works as a weak lens: less of the page shows
  // through and more of the studio does
  float kN = LENS * smoothstep(0.08, 0.55, length(gN));
  Tn *= 1.0 - kN;
  Ln += kN * eN;

  // ---------- far sheet (its inner face looks at us; it bulges away, so its slopes mirror) ----------
  vec2 pF = p0 + slope * gap;
#if QUALITY_HIGH
  vec4 nzF = sheetNoise(pF + vec2(2.37, 1.11));
  float dPF = sdPocket(pF);
  vec2 gF = -(sheetGrad(pF, e) + (nzF.rg - 0.5) * kWave * mix(0.35, 1.0, step(dPF, 0.0)));
  float TF, LF, cF;
  sheetFilm(pF, pix, nzF, TF, LF, cF);
#else
  // phones: the back sheet reuses the front sheet's film (they only part over the pocket)
  vec2 gF = -gN;
  float TF = TN, LF = LN, cF = cN;
#endif
  vec3 nF = normalize(vec3(-gF, 1.0));
  float cosF = clamp(dot(-vs, nF), 0.0, 1.0);
  float FF = fresnel(cosF);
  vec3 rF = reflect(vView, normalize(nm * vec3(nF.xy, nF.z * s)));
  float Tf = TF * (1.0 - FF);
  float Lf = LF + FF * envLight(rF) * 0.8;

  // Card contact shadow on the far sheet, a touch stronger above/left of the card
  float dCF = sdCard(pF - vec2(-0.01, 0.02));
  float shTop = smoothstep(CARD_Y1 - 0.05, CARD_Y1 + 0.01, pF.y);
  Tf *= 1.0 - mix(0.035, 0.10, shTop) * exp(-max(dCF, 0.0) / mix(0.035, 0.07, shTop)) * uHasCard;

  Tn = mix(1.0, Tn, cN); Ln *= cN;
  Tf = mix(1.0, Tf, cF); Lf *= cF;

  // ---------- punched holes and slot: clear through (alpha 0), only their cut wall shades ----------
  // The fused header is ~0.4 mm thick: seen at an angle, the wall shows between the near and the
  // far opening as a thin grey crescent.
  float inH = 1.0 - smoothstep(-pix * 0.5, pix * 0.5, sdHoles(p0 - slope * WALL_HZ));
  float outH = smoothstep(-pix * 0.5, pix * 0.5, sdHoles(p0 + slope * WALL_HZ));
  float inS = 1.0 - smoothstep(-pix * 0.5, pix * 0.5, sdSlot(p0 - slope * WALL_HZ));
  float outS = smoothstep(-pix * 0.5, pix * 0.5, sdSlot(p0 + slope * WALL_HZ));
  float wallK = max(inH * outH, inS * outS);
  float Th = 1.0 - 0.45 * wallK;
  float Lh = 0.12 * wallK * envLight(vec3(-slope, 1.0) / length(vec3(slope, 1.0)));

  // ---------- paper card (traced through the near sheet) ----------
  // The film's local tilt acts like a weak lens: offset the ray by the difference between the
  // refracted direction through the tilted sheet and through a flat one.
  vec3 d1 = refract(vs, nN, 1.0 / IOR);
  vec3 d0 = refract(vs, vec3(0.0, 0.0, 1.0), 1.0 / IOR);
  vec2 bend = (d1.xy / -d1.z - d0.xy / -d0.z) * 0.32 * uRefract;
  vec2 pC = p0 - slope * (CARD_T * 0.5) + bend;   // card's near face at z = +CARD_T/2
  float dC = sdCard(pC);
  vec2 pC2 = p0 + slope * (CARD_T * 0.5) + bend;  // far face: hit there but not on the near face = edge
  float dC2 = sdCard(pC2);
  float onFace = (1.0 - smoothstep(-pix * 0.5, pix * 0.5, dC)) * uHasCard;
  float onEdge = (1.0 - smoothstep(-pix * 0.5, pix * 0.5, dC2)) * (1.0 - onFace) * uHasCard;

  // ---------- structure of the welded pair, painted over everything ----------
  float TP, LP;
  sleevePaint(p0, pix, nzN, max(onFace, onEdge), TP, LP);
  float c0 = (1.0 - smoothstep(-pix * 0.5, pix * 0.5, sdOuter(p0))) * smoothstep(-pix * 0.5, pix * 0.5, min(sdHoles(p0), sdSlot(p0)));
  TP = mix(1.0, TP, c0);
  LP *= c0;

  vec2 uv = vec2((pC.x - CARD_X0) / (CARD_X1 - CARD_X0), (pC.y - CARD_Y0) / (CARD_Y1 - CARD_Y0));
  // fade the procedural grain of a plain back before its cells shrink under a pixel
  float grainFade = 1.0 - smoothstep(0.3, 0.7, max(fwidth(uv.x * 270.0), fwidth(uv.y * 430.0)));
  vec3 paper;
  if (s > 0.0) {
#if QUALITY_HIGH
    // slight chromatic softness where the film bends light the most
    vec2 ca = bend * 0.12 / vec2(CARD_X1 - CARD_X0, CARD_Y1 - CARD_Y0);
    paper = vec3(cardFront(uv + ca).r, cardFront(uv).g, cardFront(uv - ca).b);
#else
    paper = cardFront(uv);
#endif
  } else {
    paper = cardBack(vec2(1.0 - uv.x, uv.y), nzN, grainFade);
  }
  // Key light on the paper (fixed in the room, up-left in front): the card dims as it turns away
  vec3 nCard = normalize(vZWorld) * s;
  float shade = mix(0.62, 1.0, clamp(dot(nCard, normalize(vec3(-0.15, 0.25, 1.0))) / 0.96, 0.0, 1.0));
  paper *= shade;
  // the pocket mouth shades the top of the card
  paper *= 1.0 - 0.10 * (1.0 - smoothstep(0.0, 0.08, CARD_Y1 - pC.y));
  // hairline where the paper's cut edge catches the light
  float edgeLine = aline(dC + 0.006, 0.012, pix) * step(pC.y, CARD_Y1 - 0.02);
  paper *= 1.0 - 0.12 * edgeLine;
  vec3 edgeCol = vec3(0.80, 0.80, 0.79) * mix(0.75, 1.0, shade);
  float k = uCardFilm;
  vec3 overCard = Ln * k + mix(1.0, Tn, k) * paper;
  vec3 overEdge = Ln + Tn * edgeCol;

  // ---------- compose: premultiplied light + 1 - transmittance ----------
  float Tm = Tn * Tf * Th;
  float Lm = Ln + Tn * Lf + Lh;
  vec3 rgb = vec3(Lm);
  float a = 1.0 - Tm;
  rgb = mix(rgb, overEdge, onEdge);
  a = mix(a, 1.0, onEdge);
  rgb = mix(rgb, overCard, onFace);
  a = mix(a, 1.0, onFace);
  // matte finish: the sheets scatter most of the page behind into a soft milky white, so text
  // under the plastic reads as a faint shadow instead of a sharp, warped image (the card's
  // window stays nearly clear)
  float fr = uFrost * c0 * mix(1.0, 0.06, max(onFace, onEdge));
  vec3 milk = vec3(0.925, 0.93, 0.935) * (0.985 + 0.03 * nzN.a);
  rgb = rgb * (1.0 - fr) + fr * milk;
  a = 1.0 - (1.0 - a) * (1.0 - fr);
  // the welded structure lies on top
  rgb = LP + TP * rgb;
  a = 1.0 - TP * (1.0 - a);
  // a premultiplied colour may not exceed its alpha (WebKit clamps, Chromium adds): keep it valid
  rgb = clamp(rgb, 0.0, 1.0);
  a = clamp(max(a, max(rgb.r, max(rgb.g, rgb.b))), 0.0, 1.0);
  gl_FragColor = vec4(rgb, a);
}
`;

const BADGE_WALL_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vViewPos;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const BADGE_WALL_FS = /* glsl */ `
varying vec3 vN;
varying vec3 vViewPos;
${BADGE_GLSL_COMMON}
void main() {
  vec3 N = normalize(vN);
  vec3 V = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-vViewPos);
  if (dot(N, V) < 0.0) N = -N;
  float F = fresnel(clamp(dot(N, V), 0.0, 1.0));
  // The cut edge seen end-on: light runs along the sheet, so it reads denser and milkier than
  // the film, plus the studio's reflection
  float T = 0.55 * (1.0 - F);
  float L = 0.14 + F * envLight(reflect(-V, N));
  vec3 rgb = vec3(clamp(L, 0.0, 1.0));
  float a = clamp(max(1.0 - T, rgb.r), 0.0, 1.0);
  gl_FragColor = vec4(rgb, a);
}
`;

// Badge card art: Nicola's paper ID card (front + back) drawn on 2D canvases, so the badge
// scene can use them as textures. Layout and print look follow ref/student-card.png (a printed
// "student card" in the same holder); positions below are in a 790 x 1258 reference frame
// (that card at 4x, CR80 proportions) and scaled to the canvas.

const CARD_REF_W = 790;
const CARD_REF_H = 1258;

// One stylesheet for every face the card uses; loaded once per page.
const CARD_FONTS_HREF = "https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Inter+Tight:wght@700;800&display=swap";
const CARD_FACES = ['300 32px "DM Mono"', '400 32px "DM Mono"', '500 32px "DM Mono"', '700 32px "Inter Tight"', '800 32px "Inter Tight"'];
// Stacks end in system faces with similar proportions, so the card still draws if Google Fonts is slow
const CARD_STACK = {
  grotesk: '"Inter Tight", "Helvetica Neue", Helvetica, Arial, sans-serif',
  mono: '"DM Mono", "SF Mono", Menlo, Consolas, "Courier New", monospace',
};
const CARD_FIELDS = {
  title: "DESIGNER\nCARD",
  tag: "2026",
  subline: "ART DIRECTION / CREATIVE DEV",
  name: "NICOLA ROMEI",
  nameLabel: "NAME",
  code: "NR-26",
  codeLabel: "DESIGNER NUMBER",
  barcode: "NR-26", // Code 39: 7 symbols, 35 bars, the density of the reference
  // Back. "CODE · TITLE": the code prints in the tag slot, the title in the big face
  backTitle: "NR-26 · CLEARED FOR HIRE",
  backRows: [
    ["(clearance)", "CONCEPT → CODE"],
    ["(instagram)", "@NICOLAROMEIDESIGNER"],
    ["(other.role)", "AWWWARDS MAIN JURY, 2025–"],
    ["(awards)", "SOTD ×3 · FWA · CSSDA ×3 · GSAP ×2"],
    ["(status)", "FULL-TIME · AVAILABLE NOW"],
  ],
  backFoundLabel: "IF FOUND, REACH HERE:",
  backContact: "INFO@NICOLAROMEI.COM",
};
// Tight head-and-shoulders crop of ref/nico.png (x, y = focus in 0..1, zoom over a cover fit)
const CARD_FOCUS = { x: 0.55, y: 0.4, zoom: 3.3 };
const CARD_INK = [20, 20, 20];

// Shared layout (reference px): title block, rules, field rows and barcode sit at the same
// places on both faces
const CARD_L = {
  titleLeft: 25,
  titleBase: [153, 267],
  titleCap: 92,
  right: 747,
  tagBase: 273,
  tagCap: 30,
  rule: 288,
  fieldLeft: 45,
  fieldRule: 587,
  valueCap: 32,
  valuePitch: 23.9,
  labelCap: 10.5,
  barcode: { x0: 165, x1: 632, y0: 1113, y1: 1195 },
};

/**
 * Front of the card. Resolves to a portrait CR80 canvas (width x width*86/54).
 * opts: { photo: URL | loaded image/canvas/bitmap, photoFocus: { x, y, zoom }, fields: {...},
 *         width: px (default 1024) }
 * Never rejects: missing fonts fall back to system faces, a missing photo to a placeholder.
 */
async function createCardCanvas(opts = {}) {
  const W = Math.round(opts.width || 1024);
  const H = Math.round((W * 86) / 54);
  const f = { ...CARD_FIELDS, ...(opts.fields || {}) };
  const focus = { ...CARD_FOCUS, ...(opts.photoFocus || {}) };
  const [, photo] = await Promise.all([cardLoadFonts(3000), cardLoadPhoto(opts.photo)]);

  const canvas = cardLayer(W, H);
  const ctx = canvas.getContext("2d");
  const k = W / CARD_REF_W;
  const X = (v) => v * k;
  const Y = (v) => (v * H) / CARD_REF_H;
  const L = CARD_L;

  cardPaper(ctx, W, H, 11);
  cardPhoto(ctx, photo, { x: X(202), y: Y(405), w: X(341), h: Y(398) }, focus, k);

  const ink = cardLayer(W, H); // all type
  const marks = cardLayer(W, H); // dotted rules + barcode
  const p = ink.getContext("2d");
  const m = marks.getContext("2d");

  // Title block: heavy tight grotesk, the year in mono on the second line
  const tagLeft = cardMono(p, String(f.tag).toUpperCase(), { right: X(L.right), baseline: Y(L.tagBase), cap: X(L.tagCap), pitch: X(23), family: CARD_STACK.mono, weight: 400, sx: 0.9 }).left;
  cardTitle(p, f.title, k, Y, tagLeft);
  cardDots(m, X(30), X(L.right), Y(L.rule), k);

  // Subline: bold grotesk caps, tight
  cardText(p, String(f.subline).toUpperCase(), { left: X(42), baseline: Y(347), cap: X(27), weight: 700, family: CARD_STACK.grotesk, track: -0.035, maxW: X(L.right - 42), minSx: 0.8 });

  // Field rows: typewriter value on a dotted line, tiny bold label under it
  cardField(p, m, f.name, f.nameLabel, 897, k, Y);
  cardField(p, m, f.code, f.codeLabel, 1013, k, Y);

  cardBarcode(m, f.barcode, X(L.barcode.x0), X(L.barcode.x1), Y(L.barcode.y0), Y(L.barcode.y1));

  cardPrint(ctx, ink, marks, k);
  return canvas;
}

/**
 * Back of the card: same stock and type system, the "cleared for hire" record.
 * Synchronous, so it uses whatever fonts are loaded: call it after createCardCanvas resolves.
 */
function createCardBackCanvas(opts = {}) {
  const W = Math.round(opts.width || 1024);
  const H = Math.round((W * 86) / 54);
  const f = { ...CARD_FIELDS, ...(opts.fields || {}) };
  const canvas = cardLayer(W, H);
  const ctx = canvas.getContext("2d");
  const k = W / CARD_REF_W;
  const X = (v) => v * k;
  const Y = (v) => (v * H) / CARD_REF_H;
  const L = CARD_L;
  cardPaper(ctx, W, H, 29);

  const ink = cardLayer(W, H);
  const marks = cardLayer(W, H);
  const p = ink.getContext("2d");
  const m = marks.getContext("2d");

  // "NR-26 · CLEARED FOR HIRE": code in the tag slot, the rest as the big title
  const split = /^(.+?)\s+·\s+(.+)$/.exec(String(f.backTitle));
  const tag = split ? split[1] : "";
  const title = split ? split[2] : String(f.backTitle);
  const tagLeft = tag ? cardMono(p, tag.toUpperCase(), { right: X(L.right), baseline: Y(L.tagBase), cap: X(L.tagCap), pitch: X(23), family: CARD_STACK.mono, weight: 400, sx: 0.9 }).left : X(L.right);
  cardTitle(p, cardBalance(title.toUpperCase()), k, Y, tagLeft);
  cardDots(m, X(30), X(L.right), Y(L.rule), k);

  // Record rows: (label) in mono on the left, the value in bold caps on the right
  const rows = Array.isArray(f.backRows) ? f.backRows.slice(0, 6) : [];
  const pitch = rows.length > 5 ? 84 : 98;
  rows.forEach(([label, value], i) => {
    const base = 372 + i * pitch;
    cardMono(p, String(label), { left: X(42), baseline: Y(base), cap: X(17), pitch: X(14.6), family: CARD_STACK.mono, weight: 400, sx: 0.9, maxFill: 0.96, maxRight: X(262) });
    cardText(p, String(value).toUpperCase(), { left: X(280), baseline: Y(base), cap: X(21), weight: 700, family: CARD_STACK.grotesk, track: -0.02, maxW: X(L.right - 280), minSx: 0.84 });
    cardDots(m, X(42), X(L.right), Y(base + 28), k);
  });

  // Return line: label above, address in the typewriter face on a dotted line
  cardText(p, String(f.backFoundLabel).toUpperCase(), { left: X(L.fieldLeft), baseline: Y(968), cap: X(13.5), weight: 800, family: CARD_STACK.grotesk, track: -0.02, maxW: X(L.right - L.fieldLeft) });
  cardMono(p, String(f.backContact).toUpperCase(), { left: X(L.fieldLeft), baseline: Y(1013), cap: X(L.valueCap), pitch: X(L.valuePitch), family: CARD_STACK.mono, weight: 300, sx: 0.9, maxFill: 0.96, maxRight: X(L.right) });
  cardDots(m, X(L.fieldLeft), X(L.right), Y(1026), k);

  cardBarcode(m, f.barcode, X(L.barcode.x0), X(L.barcode.x1), Y(L.barcode.y0), Y(L.barcode.y1));

  cardPrint(ctx, ink, marks, k);
  return canvas;
}

// Two title lines from one string: an explicit "\n" wins, otherwise the split that keeps the
// longer line shortest ("CLEARED FOR HIRE" -> "CLEARED" / "FOR HIRE")
function cardBalance(text) {
  if (text.includes("\n")) return text;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return text;
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const score = Math.max(a.length, b.length);
    if (!best || score < best.score) best = { score, text: `${a}\n${b}` };
  }
  return best.text;
}

// Big two-line title. The second line stops short of the tag printed at its right end.
function cardTitle(p, title, k, Y, tagLeft) {
  const L = CARD_L;
  const lines = (Array.isArray(title) ? title : String(title).split("\n")).slice(0, 2).map((l) => l.toUpperCase());
  const bases = lines.length > 1 ? L.titleBase : [L.titleBase[1]];
  lines.forEach((line, i) => {
    const last = i === lines.length - 1;
    const maxRight = last ? tagLeft - 18 * k : L.right * k;
    cardText(p, line, { left: L.titleLeft * k, baseline: Y(bases[i]), cap: L.titleCap * k, weight: 700, family: CARD_STACK.grotesk, track: -0.05, maxW: maxRight - L.titleLeft * k, minSx: 0.9, inkLeft: true });
  });
}

// One field row: value, dotted rule, label under the rule
function cardField(p, m, value, label, base, k, Y) {
  const L = CARD_L;
  cardMono(p, String(value).toUpperCase(), { left: L.fieldLeft * k, baseline: Y(base), cap: L.valueCap * k, pitch: L.valuePitch * k, family: CARD_STACK.mono, weight: 300, sx: 0.9, maxFill: 0.96, maxRight: L.right * k });
  cardDots(m, L.fieldLeft * k, L.fieldRule * k, Y(base + 13), k);
  cardText(p, String(label).toUpperCase(), { left: L.fieldLeft * k, baseline: Y(base + 36), cap: L.labelCap * k, weight: 800, family: CARD_STACK.grotesk, track: -0.03, maxW: (L.fieldRule - L.fieldLeft) * k });
}

// Ink layers onto the stock: type lightly roughened (a clean print, edges only just soft),
// rules and barcode crisp
function cardPrint(ctx, ink, marks, k) {
  cardRoughen(ink, { k, blur: 0.45 * k, grain: 1.6 * k, amp: 0.1, soft: 0.14, voids: 0, density: 0.06, seed: 21, rgb: CARD_INK });
  cardComposite(ctx, ink, 0.96);
  cardRoughen(marks, { k, blur: 0.35 * k, grain: 1.4 * k, amp: 0.06, soft: 0.18, voids: 0, density: 0.05, seed: 25, rgb: CARD_INK });
  cardComposite(ctx, marks, 0.9);
}

// ---------------------------------------------------------------------------------------------
// Loading

function cardLoadFonts(timeout) {
  let link = document.querySelector("link[data-badge-card-fonts]");
  if (!link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CARD_FONTS_HREF;
    link.setAttribute("data-badge-card-fonts", "");
    link.__cardSheet = new Promise((res) => { link.onload = res; link.onerror = res; });
    document.head.appendChild(link);
  }
  // fonts.load only sees @font-face rules that exist, so wait for the stylesheet first
  const faces = Promise.resolve(link.__cardSheet).then(() =>
    Promise.all(CARD_FACES.map((face) => document.fonts.load(face, "Aa1·×–").catch(() => null))));
  return Promise.race([faces, new Promise((res) => setTimeout(res, timeout))]).catch(() => null);
}

async function cardLoadPhoto(src) {
  if (!src) return null;
  try {
    let img = src;
    if (typeof src === "string") {
      img = new Image();
      img.crossOrigin = "anonymous"; // the card ends up in a WebGL texture: a tainted canvas would throw there
      img.decoding = "async";
      img.src = src;
    }
    if (typeof HTMLImageElement !== "undefined" && img instanceof HTMLImageElement) {
      await Promise.race([img.decode(), new Promise((_, rej) => setTimeout(rej, 10000))]);
    }
    return (img.naturalWidth || img.videoWidth || img.width) ? img : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Noise helpers (seeded, so the card prints the same on every load)

function cardRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cardNoise(seed) {
  const hash = (x, y) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function cardLayer(W, H) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  return c;
}

// ---------------------------------------------------------------------------------------------
// Paper

// Cool white card stock: faint mottling and grain, a few fibres, a slightly darker trimmed edge
function cardPaper(ctx, W, H, seed) {
  const k = W / CARD_REF_W;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const mott = cardNoise(seed), cloud = cardNoise(seed + 1), rnd = cardRng(seed + 2);
  const base = [243, 243, 240];
  for (let y = 0; y < H; y++) {
    const vy = (y / H) * 2 - 1;
    for (let x = 0; x < W; x++) {
      const vx = (x / W) * 2 - 1;
      const m = (mott(x / (110 * k), y / (110 * k)) - 0.5) * 3 + (cloud(x / (14 * k), y / (14 * k)) - 0.5) * 1.8;
      const g = (rnd() - 0.5) * 5;
      const edge = Math.min(x, W - 1 - x, y, H - 1 - y) / k;
      const vig = (vx * vx * 0.55 + vy * vy * 0.45) * 2 + Math.max(0, 1 - edge / 7) * 5;
      const v = m + g - vig;
      const i = (y * W + x) * 4;
      d[i] = base[0] + v;
      d[i + 1] = base[1] + v;
      d[i + 2] = base[2] + v * 0.9;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Fibres: short faint strands, a few darker, most lighter than the stock
  const count = Math.round((W * H) / (2600 * k * k));
  ctx.lineCap = "round";
  for (let i = 0; i < count; i++) {
    const x = rnd() * W, y = rnd() * H;
    const len = (4 + rnd() * 14) * k, a = rnd() * Math.PI * 2, bend = (rnd() - 0.5) * len * 0.8;
    const dark = rnd() < 0.3;
    ctx.strokeStyle = dark ? `rgba(90,90,92,${0.04 + rnd() * 0.05})` : `rgba(255,255,255,${0.2 + rnd() * 0.2})`;
    ctx.lineWidth = (0.3 + rnd() * 0.4) * k;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = `rgba(60,60,60,${0.1 + rnd() * 0.2})`;
    ctx.beginPath();
    ctx.arc(rnd() * W, rnd() * H, (0.3 + rnd() * 0.6) * k, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------------------------
// Photo print

// A small glossy print stuck on the card: white border, soft drop shadow to the bottom right
function cardPhoto(ctx, img, r, focus, k) {
  const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
  const bl = 9 * k, bt = 9 * k, br = 9 * k, bb = 11 * k;
  const iw = Math.round(w - bl - br), ih = Math.round(h - bt - bb);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.26)";
  ctx.shadowBlur = 11 * k;
  ctx.shadowOffsetX = 3 * k;
  ctx.shadowOffsetY = 5 * k;
  ctx.fillStyle = "rgb(250,250,249)";
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  // contact shadow right under the print's edge
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1 * k;
  ctx.strokeRect(x + 0.5 * k, y + 0.5 * k, w - k, h - k);

  let c = cardLayer(iw, ih);
  const p = c.getContext("2d", { willReadFrequently: true });
  let ok = false;
  if (img) {
    try {
      const sw0 = img.naturalWidth || img.videoWidth || img.width;
      const sh0 = img.naturalHeight || img.videoHeight || img.height;
      const s = Math.max(iw / sw0, ih / sh0) * Math.max(1, focus.zoom || 1);
      const sw = iw / s, sh = ih / s;
      const sx = Math.min(Math.max(focus.x * sw0 - sw / 2, 0), sw0 - sw);
      const sy = Math.min(Math.max(focus.y * sh0 - sh / 2, 0), sh0 - sh);
      // Through a smaller canvas first: tames the source's film grain into a small print's
      // softness (canvas filter blur is not available in Safari)
      const soft = cardLayer(Math.max(1, Math.round(iw * 0.7)), Math.max(1, Math.round(ih * 0.7)));
      const sp = soft.getContext("2d");
      sp.imageSmoothingQuality = "high";
      sp.drawImage(img, sx, sy, sw, sh, 0, 0, soft.width, soft.height);
      p.imageSmoothingQuality = "high";
      p.drawImage(soft, 0, 0, iw, ih);
      // Print grading (getImageData throws if the photo tainted the canvas): auto levels on the
      // crop for deep blacks and clean highlights, a contrasty neutral print
      const id = p.getImageData(0, 0, iw, ih);
      const d = id.data;
      const hist = new Uint32Array(256);
      for (let i = 0; i < d.length; i += 4) hist[(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) | 0]++;
      const pct = (q) => {
        const n = (d.length / 4) * q;
        for (let v = 0, acc = 0; v < 256; v++) if ((acc += hist[v]) >= n) return v;
        return 255;
      };
      const lo = pct(0.02), hi = Math.max(lo + 24, pct(0.992)), med = pct(0.5);
      const mid = Math.min(0.85, Math.max(0.15, (med - lo) / (hi - lo)));
      const gam = Math.min(1.6, Math.max(0.55, Math.log(0.38) / Math.log(mid))); // median -> 38 %
      const lut = new Float32Array(256);
      for (let v = 0; v < 256; v++) lut[v] = 222 * Math.pow(Math.min(1, Math.max(0, (v - lo) / (hi - lo))), gam);
      for (let i = 0; i < d.length; i += 4) {
        const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
        d[i] = 12 + lut[(d[i] * 0.6 + l * 0.4) | 0];
        d[i + 1] = 12 + lut[(d[i + 1] * 0.6 + l * 0.4) | 0];
        d[i + 2] = 13 + lut[(d[i + 2] * 0.6 + l * 0.4) | 0];
      }
      p.putImageData(id, 0, 0);
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    // fresh canvas: a cross-origin photo may have tainted the first one (WebGL would reject it)
    c = cardLayer(iw, ih);
    cardPlaceholder(c.getContext("2d"), iw, ih);
  }
  ctx.drawImage(c, Math.round(x + bl), Math.round(y + bt));
  // Gloss: a faint sheen falloff across the print
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, "rgba(255,255,255,0.06)");
  g.addColorStop(1, "rgba(0,0,0,0.03)");
  ctx.fillStyle = g;
  ctx.fillRect(x + bl, y + bt, iw, ih);
}

// Neutral stand-in when the photo is missing or unusable: soft head-and-shoulders silhouette
function cardPlaceholder(p, w, h) {
  p.clearRect(0, 0, w, h);
  p.fillStyle = "rgb(206,206,204)";
  p.fillRect(0, 0, w, h);
  p.fillStyle = "rgb(178,178,176)";
  p.beginPath();
  p.ellipse(w * 0.5, h * 0.4, w * 0.2, h * 0.2, 0, 0, Math.PI * 2);
  p.fill();
  p.beginPath();
  p.ellipse(w * 0.5, h * 1.02, w * 0.46, h * 0.36, 0, Math.PI, Math.PI * 2);
  p.fill();
}

// ---------------------------------------------------------------------------------------------
// Type

function cardFontSizeForCap(ctx, weight, family, cap) {
  ctx.font = `${weight} 100px ${family}`;
  const a = ctx.measureText("H").actualBoundingBoxAscent || 71.6;
  return (100 * cap) / a;
}

// Proportional line at a cap height, glyph by glyph: o.track (em) sets the tracking, o.sx a
// horizontal scale. Too wide for o.maxW: narrower first (down to o.minSx), then smaller.
// o.inkLeft puts the first glyph's ink (not its side bearing) on o.left.
// "→" is drawn as a vector arrow: not every face has the glyph, and a fallback would print in
// another weight. Returns the ink right edge.
function cardText(p, text, o) {
  const chars = [...String(text)];
  const track = o.track || 0;
  let size = cardFontSizeForCap(p, o.weight, o.family, o.cap);
  let sx = o.sx ?? 1;
  const arrowW = (s) => s * 0.78;
  const width = () => {
    p.font = `${o.weight} ${size}px ${o.family}`;
    let w = 0;
    chars.forEach((ch, i) => {
      w += (ch === "→" ? arrowW(size) : p.measureText(ch).width) * sx;
      if (i < chars.length - 1) w += track * size * sx;
    });
    return w;
  };
  let w = width();
  if (o.maxW && w > o.maxW) {
    sx = Math.max(o.minSx ?? sx, (sx * o.maxW) / w);
    w = width();
    if (w > o.maxW) {
      size *= o.maxW / w;
      w = width();
    }
  }
  p.font = `${o.weight} ${size}px ${o.family}`;
  let x = o.left;
  if (o.inkLeft && chars.length) x += p.measureText(chars[0]).actualBoundingBoxLeft * sx;
  p.save();
  p.fillStyle = "#000";
  p.strokeStyle = "#000";
  for (const ch of chars) {
    if (ch === "→") {
      cardArrow(p, x, o.baseline, arrowW(size) * sx, o.cap, size);
      x += (arrowW(size) + track * size) * sx;
      continue;
    }
    p.setTransform(sx, 0, 0, 1, x, o.baseline);
    p.fillText(ch, 0, 0);
    p.setTransform(1, 0, 0, 1, 0, 0);
    x += (p.measureText(ch).width + track * size) * sx;
  }
  p.restore();
  return x - track * size * sx;
}

// Arrow sitting on the x-height middle, stroke weight of a bold face
function cardArrow(p, x, baseline, w, cap, size) {
  const y = baseline - cap * 0.5;
  const t = size * 0.085;
  const head = cap * 0.36;
  const x0 = x + size * 0.06, x1 = x + w - size * 0.06;
  p.save();
  p.lineWidth = t;
  p.lineCap = "butt";
  p.lineJoin = "miter";
  p.beginPath();
  p.moveTo(x0, y);
  p.lineTo(x1 - t * 0.5, y);
  p.stroke();
  p.beginPath();
  p.moveTo(x1 - head, y - head);
  p.lineTo(x1, y);
  p.lineTo(x1 - head, y + head);
  p.stroke();
  p.restore();
}

// Fixed-pitch text (typewriter rhythm): each glyph centred in its cell. Anchored at o.left or
// o.right; with o.maxRight a long left-anchored line tightens its pitch to fit. Glyphs wider
// than o.maxFill of a cell are squeezed (like M and W in a real mono face).
// Returns the ink bounds { left, right }.
function cardMono(p, text, o) {
  const size = cardFontSizeForCap(p, o.weight, o.family, o.cap);
  p.font = `${o.weight} ${size}px ${o.family}`;
  const chars = [...text];
  const n = chars.length;
  let pitch = o.pitch;
  if (o.right == null && o.maxRight != null && o.left + pitch * n > o.maxRight) pitch = (o.maxRight - o.left) / n;
  const inkW = (ch) => {
    const m = p.measureText(ch);
    return (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * o.sx;
  };
  let x0;
  if (o.right != null) x0 = o.right - pitch * n + (pitch - Math.min(inkW(chars[n - 1]), pitch)) / 2;
  else x0 = o.left - (pitch - Math.min(inkW(chars[0]), pitch)) / 2;
  p.save();
  p.fillStyle = "#000";
  let left = Infinity, right = -Infinity;
  chars.forEach((ch, i) => {
    if (ch === " ") return;
    const m = p.measureText(ch);
    let sx = o.sx;
    let w = (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * sx;
    const maxW = pitch * (o.maxFill || 1.2);
    if (w > maxW) { sx *= maxW / w; w = maxW; }
    const cx = x0 + pitch * (i + 0.5);
    p.setTransform(sx, 0, 0, 1, cx - w / 2, o.baseline);
    p.fillText(ch, m.actualBoundingBoxLeft, 0);
    left = Math.min(left, cx - w / 2);
    right = Math.max(right, cx + w / 2);
  });
  p.restore();
  return { left, right };
}

// Dotted rule: small round dots, a touch uneven
function cardDots(p, x0, x1, y, k) {
  const period = 8.2 * k, r = 1.75 * k;
  const n = Math.max(1, Math.floor((x1 - x0) / period));
  const step = (x1 - x0) / n;
  p.save();
  p.fillStyle = "#000";
  for (let i = 0; i <= n; i++) {
    p.beginPath();
    p.arc(x0 + i * step, y, r, 0, Math.PI * 2);
    p.fill();
  }
  p.restore();
}

// Code 39: 9 elements per character (bar, space, ... bar), 1 = wide; "*" starts and stops
const CARD_CODE39 = {
  0: "000110100", 1: "100100001", 2: "001100001", 3: "101100000", 4: "000110001",
  5: "100110000", 6: "001110000", 7: "000100101", 8: "100100100", 9: "001100100",
  A: "100001001", B: "001001001", C: "101001000", D: "000011001", E: "100011000",
  F: "001011000", G: "000001101", H: "100001100", I: "001001100", J: "000011100",
  K: "100000011", L: "001000011", M: "101000010", N: "000010011", O: "100010010",
  P: "001010010", Q: "000000111", R: "100000110", S: "001000110", T: "000010110",
  U: "110000001", V: "011000001", W: "111000000", X: "010010001", Y: "110010000",
  Z: "011010000", "-": "010000101", ".": "110000100", " ": "011000100", "*": "010010100",
};

// A real (scannable) Code 39 of `text`, filling x0..x1
function cardBarcode(p, text, x0, x1, y0, y1) {
  const data = String(text || "").toUpperCase().replace(/[^0-9A-Z. -]/g, "");
  if (!data) return;
  const chars = ["*", ...data, "*"];
  const R = 2.5; // wide : narrow
  const units = chars.length * (6 + 3 * R) + (chars.length - 1);
  const u = (x1 - x0) / units;
  let x = x0;
  p.save();
  p.fillStyle = "#000";
  chars.forEach((ch) => {
    const pat = CARD_CODE39[ch];
    for (let i = 0; i < 9; i++) {
      const w = (pat[i] === "1" ? R : 1) * u;
      if (i % 2 === 0) p.fillRect(x, y0, w, y1 - y0);
      x += w;
    }
    x += u; // gap between characters
  });
  p.restore();
}

// ---------------------------------------------------------------------------------------------
// Ink processing

// Ink-print roughness: blur the coverage a little, then re-threshold it against noise, so edges
// wobble by a pixel or two and solid areas get rare pin-holes, like offset print on paper.
// The layer is drawn in black; o.rgb is the ink colour written back.
function cardRoughen(layer, o) {
  const W = layer.width, H = layer.height;
  const ctx = layer.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  let a = new Float32Array(W * H);
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let i = 0, y = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      const v = d[i * 4 + 3];
      if (v) {
        a[i] = v / 255;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return;
  // On small canvases (quality "low") strokes are only a pixel or two wide: blur and roughen less,
  // keep a wider soft edge, so fine print does not erode away
  const fine = Math.min(1, Math.max(0.3, (o.k || 2) / 2));
  const amp = o.amp * fine, soft = o.soft / fine;
  const r = Math.round(o.blur * fine);
  const pad = r * 3 + 2;
  const x0 = Math.max(0, minX - pad), x1 = Math.min(W - 1, maxX + pad);
  const y0 = Math.max(0, minY - pad), y1 = Math.min(H - 1, maxY + pad);
  // Two box-blur passes (horizontal + vertical) only inside the inked bounds
  const tmp = new Float32Array(W * H);
  for (let pass = 0; r > 0 && pass < 2; pass++) {
    for (let y = y0; y <= y1; y++) {
      let acc = 0;
      const row = y * W;
      for (let x = x0 - r; x <= x0 + r; x++) acc += x >= x0 && x <= x1 ? a[row + x] : 0;
      for (let x = x0; x <= x1; x++) {
        tmp[row + x] = acc / (2 * r + 1);
        const out = x - r, inn = x + r + 1;
        acc += (inn <= x1 ? a[row + inn] : 0) - (out >= x0 ? a[row + out] : 0);
      }
    }
    for (let x = x0; x <= x1; x++) {
      let acc = 0;
      for (let y = y0 - r; y <= y0 + r; y++) acc += y >= y0 && y <= y1 ? tmp[y * W + x] : 0;
      for (let y = y0; y <= y1; y++) {
        a[y * W + x] = acc / (2 * r + 1);
        const out = y - r, inn = y + r + 1;
        acc += (inn <= y1 ? tmp[inn * W + x] : 0) - (out >= y0 ? tmp[out * W + x] : 0);
      }
    }
  }
  const n1 = cardNoise(o.seed), n2 = cardNoise(o.seed + 5), n3 = cardNoise(o.seed + 9), rnd = cardRng(o.seed + 3);
  const g = o.grain;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      const v = a[i];
      if (v <= 0.001) { d[i * 4 + 3] = 0; continue; }
      d[i * 4] = o.rgb[0];
      d[i * 4 + 1] = o.rgb[1];
      d[i * 4 + 2] = o.rgb[2];
      // threshold moves with two octaves of noise -> ragged edges
      const t = 0.5 + ((n1(x / g, y / g) - 0.5) * 0.7 + (n2(x / (g * 0.45), y / (g * 0.45)) - 0.5) * 0.3) * amp * 2;
      let cov = (v - (t - soft)) / (2 * soft);
      cov = cov <= 0 ? 0 : cov >= 1 ? 1 : cov * cov * (3 - 2 * cov);
      // uneven ink film + rare pin-holes
      const dens = o.density ?? 0.1;
      const ms = o.mottle || g * 6;
      cov *= 1 - dens + dens * n3(x / ms, y / ms);
      if (o.voids && rnd() < o.voids) cov *= 0.25;
      d[i * 4 + 3] = cov * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Multiply the (already tinted) ink layer onto the paper, so the stock's texture shows through
function cardComposite(ctx, layer, alpha, x = 0, y = 0) {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer, x, y);
  ctx.restore();
}

// =====================================================================
// BADGE RIG: badge physics
// A rigid ID badge whose split ring hangs on a fixed hook at the anchor (a ball
// joint): it swings, tilts and spins about that point. Units: cm and seconds.
// Fixed 240 Hz substeps (XPBD-style position constraints) so the result does not
// depend on the display refresh rate; the output pose is interpolated between
// substeps. Badge local frame = slot centre (where the ring holds it), hangs
// along -Y, front faces +Z. No imports: THREE is passed in.
// opts.swingLimit { pitch, roll } (rad) bounds the swing about the hook,
// opts.hoverYaw / hoverPitch (rad) soften the hover tilt.
// (The lanyard version, with a verlet strap, is physics-lanyard.js in the lab.)
// =====================================================================

function createBadgeRig(THREE, opts = {}) {
  const V3 = THREE.Vector3;

  // --- Size (cm) ---
  const bw = opts.badgeSize?.width ?? 6.65;
  const bh = opts.badgeSize?.height ?? 11.35;
  const pivotFromTop = opts.pivotFromTop ?? 0.75; // slot centre below the badge top
  const ringTop = opts.ringTop ?? 0.9; // ring top above the slot centre
  // Holder centre x in badge space. The real split ring hangs a little right of the slot: the
  // host hangs the rig from the ring and shifts the holder, so the hit box follows the holder
  // while the badge still hangs upright under its ring.
  const holderX = opts.holderX ?? 0;
  const reduced = !!opts.reducedMotion;
  let swayOn = opts.idleSway ?? !reduced;

  // --- Tuning ---
  const G = 981; // cm/s²
  const STEP = 1 / 240; // fixed substep
  const ITER = 12; // hook passes per substep
  const MAX_DT = 1 / 30; // a hidden tab or a long frame only advances this much
  const MAX_STEPS = 10;
  const DAMP_K = reduced ? 1.7 : 1; // reduced motion: settles sooner
  const M = 1; // badge mass
  const K_TWIST = 42; // torsion of the ring on its hook: brings the front back after a spin
  const C_TWIST = 8.2 * DAMP_K;
  const DAMP_LIN = 1.8 * DAMP_K; // body, edge-on motion (1/s)
  const DAMP_FACE = 3.2 * DAMP_K; // body, face-on motion: a flat card pushes air
  const DAMP_AX = 2.2 * DAMP_K; // pitch (face-on sweep)
  const DAMP_AY = 0.35 * DAMP_K; // yaw (the torsion has its own damping)
  const DAMP_AZ = 1.6 * DAMP_K; // in-plane rocking
  const GRAB_W = 30; // grab spring frequency (rad/s): stiff but not a teleport
  const GRAB_Z = 0.9; // grab spring damping ratio
  const GRAB_MAX_F = M * G * 6;
  const GRAB_LIFT = 0.9; // share of the weight the grab carries (lifted badges sat 2.8 cm under the pointer)
  const MAX_V = 420; // cm/s, keeps a wild throw on screen
  const HOOK_V = 300; // cm/s: a carried badge trails a very fast pointer instead of being yanked
  const RELEASE_V = 160; // cm/s: let go mid-carry, it swings out but never loops over its hook
  const MAX_W = 26; // rad/s
  const SPIN_MIN = 40; // cm/s of sideways flick before it starts spinning the badge
  const SPIN_R = 2.4; // cm, effective radius the flick acts on
  const SPIN_MAX = (reduced ? 0.6 : 1) * 22; // rad/s
  // Hover tilt toward the pointer; a host can soften it (a badge pinned at its top tilts the
  // whole holder about the hook, so the same angle reads stronger there)
  const HOVER_YAW = opts.hoverYaw ?? 0.15; // rad at the badge edge
  const HOVER_PITCH = opts.hoverPitch ?? 0.11; // rad at the badge top/bottom
  const SWAY_HOLD = 6; // s of idle sway after the last input, then it fades and sleeps
  const SWAY_AMP = 0.013; // fraction of the weight pushed sideways
  const SLEEP_V = 0.5; // cm/s
  const SLEEP_W = 0.02; // rad/s
  const SLEEP_AFTER = 0.5; // s of stillness

  // --- Body frame (origin = centre of mass, at the middle of the holder, a bit low for the card) ---
  const comInPivot = pivotFromTop - bh / 2 - 0.25;
  const pivotLocal = new V3(0, -comInPivot, 0);
  const ringLocal = new V3(0, -comInPivot + ringTop, 0);
  const tk = 0.25;
  const inertia = new V3((bh * bh + tk * tk) / 12, (bw * bw + tk * tk) / 12, (bw * bw + bh * bh) / 12)
    .multiplyScalar(M);
  const invI = new V3(1 / inertia.x, 1 / inertia.y, 1 / inertia.z);
  const K_PITCH = M * G * ringLocal.y; // torque per radian gravity opposes: hover pitch ≈ target
  // A tap flips the badge: a stiffer, slightly underdamped torsion turns it over in ~0.5 s
  const K_FLIP = 260;
  const C_FLIP = 2 * 0.72 * Math.sqrt(K_FLIP * inertia.y);
  const FLIP_MAX_T = 2; // s, then the normal torsion takes over whatever is left

  // --- Hook: where the ring top hangs (slides to a moved anchor across a frame's substeps) ---
  const anchor = (opts.anchor ? opts.anchor.clone() : new V3(0, 0, 0));
  const hook = anchor.clone();

  // --- Badge rigid body ---
  const x = new V3(), xp = new V3(), xl = new V3(), v = new V3(), w = new V3();
  const q = new THREE.Quaternion(), qp = new THREE.Quaternion(), ql = new THREE.Quaternion();

  // --- Output ---
  const badge = { position: new V3(), quaternion: new THREE.Quaternion() };

  // --- State ---
  let acc = 0;
  let time = 0;
  let lastInput = 0;
  let sleeping = false;
  let quiet = 0;
  let twist = 0; // accumulated rotation about the hanging axis (radians, not wrapped)
  let facing = 0; // twist the torsion pulls toward: a multiple of π (odd = back to the viewer)
  let flipT = -1; // s since the last flip, -1 when none is running
  let bounds = null; // { minX, maxX, minY, maxY }: where a drag may put the hook
  let swayEnv = 0;
  const hoverTarget = { yaw: 0, pitch: 0 };
  const hoverCur = { yaw: 0, pitch: 0 };

  const anchorFrom = new V3(); // hook at the start of a frame
  const hookTo = new V3(); // and where it gets to by the end of it

  // Grab
  let grab = null; // { local, planeN, planeP, start, end, cur, vT, samples, t0, travel }

  // --- Scratch (no allocations in the loop) ---
  const t1 = new V3(), t2 = new V3(), t3 = new V3(), t4 = new V3(), t5 = new V3();
  const F = new V3(), T = new V3(), rW = new V3(), qi = new THREE.Quaternion();
  const qr = new THREE.Quaternion(), up = new V3(0, 1, 0);
  const ray2 = new THREE.Ray();

  // I⁻¹ in world space: rotate into the body frame, scale, rotate back
  function invInertiaWorld(vec) {
    qi.copy(q).invert();
    vec.applyQuaternion(qi);
    vec.set(vec.x * invI.x, vec.y * invI.y, vec.z * invI.z);
    return vec.applyQuaternion(q);
  }

  // Inverse mass the body offers at offset r along direction n
  function bodyW(r, n) {
    t5.crossVectors(r, n).applyQuaternion(qi.copy(q).invert());
    return 1 / M + t5.x * t5.x * invI.x + t5.y * t5.y * invI.y + t5.z * t5.z * invI.z;
  }

  // q += 0.5 * (θ as a pure quaternion) * q
  function rotateBy(tx, ty, tz) {
    const { x: qx, y: qy, z: qz, w: qw } = q;
    q.set(
      qx + 0.5 * (tx * qw + ty * qz - tz * qy),
      qy + 0.5 * (-tx * qz + ty * qw + tz * qx),
      qz + 0.5 * (tx * qy - ty * qx + tz * qw),
      qw + 0.5 * (-tx * qx - ty * qy - tz * qz)
    ).normalize();
  }

  // Positional impulse J at world offset r from the centre of mass
  function applyBodyImpulse(J, r) {
    x.addScaledVector(J, 1 / M);
    t4.crossVectors(r, J);
    invInertiaWorld(t4);
    rotateBy(t4.x, t4.y, t4.z);
  }

  function reset() {
    hook.copy(anchor);
    q.identity();
    qp.identity();
    ql.identity();
    x.set(anchor.x, anchor.y - ringLocal.y, anchor.z);
    xp.copy(x);
    xl.copy(x);
    v.set(0, 0, 0);
    w.set(0, 0, 0);
    twist = 0;
    facing = 0;
    flipT = -1;
    acc = 0;
    writeOutput(1);
  }

  // Twist about the hanging axis (the badge's own +Y). Integrated from the spin so it stays
  // continuous through any swing: a swing-twist split is undefined when the badge hangs upside
  // down (lifted by its bottom) and used to inject half turns. While the badge hangs roughly
  // upright it is pulled onto the exact facing, so twist 0 always means "front facing".
  function updateTwist(h) {
    t1.set(0, 1, 0).applyQuaternion(q);
    twist += w.dot(t1) * h;
    const up = t1.y;
    if (up > 0.5 && Math.abs(q.y) + Math.abs(q.w) > 1e-6) {
      const raw = 2 * Math.atan2(q.y, q.w);
      const target = raw + Math.PI * 2 * Math.round((twist - raw) / (Math.PI * 2));
      const k = Math.min(1, (up - 0.5) / 0.4);
      twist += (target - twist) * k * (1 - Math.exp(-h * 30));
    }
  }

  // --- Constraints ---
  // The ring top on the hook: a positional correction at the ring, split between the body's
  // translation and rotation by its inverse mass there
  function pinRing() {
    rW.copy(ringLocal).applyQuaternion(q);
    t2.addVectors(x, rW).sub(hook); // ring - hook
    const len = t2.length();
    if (len < 1e-9) return;
    t2.divideScalar(len);
    t3.copy(t2).multiplyScalar(-len / bodyW(rW, t2));
    applyBodyImpulse(t3, rW);
  }

  // Swing limit (opts.swingLimit = { pitch, roll } in radians): an elliptic
  // cone around the hanging pose, pitch (toward / away from the viewer) and roll (in plane) set
  // apart. The excess is turned back about the hook over a few ms, so a throw or a hard pull ends
  // softly at the cone instead of flipping the badge over its hook.
  const LIMIT_P = opts.swingLimit?.pitch ?? 0;
  const LIMIT_R = opts.swingLimit?.roll ?? 0;
  const limitOn = LIMIT_P > 0 && LIMIT_R > 0;
  const LIMIT_K = 90; // 1/s: the excess fades in ~11 ms
  function limitSwing(h) {
    t1.copy(up).applyQuaternion(qi.copy(q).invert()); // world up in the body frame
    const s = Math.hypot(t1.x, t1.z);
    if (s < 1e-6) return;
    const tilt = Math.atan2(s, t1.y);
    const cx = t1.x / s, cz = t1.z / s; // tilt direction: x = roll, z = pitch
    const max = 1 / Math.sqrt((cx * cx) / (LIMIT_R * LIMIT_R) + (cz * cz) / (LIMIT_P * LIMIT_P));
    if (tilt <= max) return;
    t2.copy(up).applyQuaternion(q).cross(up); // body up x world up: turns the badge back upright
    if (t2.lengthSq() < 1e-12) return;
    qr.setFromAxisAngle(t2.normalize(), (tilt - max) * (1 - Math.exp(-h * LIMIT_K)));
    // About the hook, so the joint stays exact
    t3.copy(ringLocal).applyQuaternion(q).add(x);
    x.sub(t3).applyQuaternion(qr).add(t3);
    q.premultiply(qr).normalize();
  }

  // --- One fixed substep ---
  function substep(h, k, n) {
    time += h;

    // Hover tilt eases in/out (no snapping when the pointer enters or leaves)
    const e = 1 - Math.exp(-h * 9);
    hoverCur.yaw += (hoverTarget.yaw - hoverCur.yaw) * e;
    hoverCur.pitch += (hoverTarget.pitch - hoverCur.pitch) * e;

    // Idle sway only for a while after the last input, so the rig can go to sleep
    const swayTarget = swayOn && !grab && time - lastInput < SWAY_HOLD ? 1 : 0;
    swayEnv += (swayTarget - swayEnv) * (1 - Math.exp(-h / (swayTarget ? 1.4 : 0.6)));
    if (swayEnv < 2e-3 && !swayTarget) swayEnv = 0;

    // Forces and torques on the badge
    F.set(0, -G * M, 0);
    T.set(0, 0, 0);
    let swayYaw = 0;
    if (swayEnv) {
      const s = M * G * SWAY_AMP * swayEnv;
      F.x += s * (0.7 * Math.sin(time * 1.13) + 0.3 * Math.sin(time * 1.97 + 1.3));
      F.z += s * 0.6 * Math.sin(time * 1.41 + 0.4);
      swayYaw = 0.05 * swayEnv * Math.sin(time * 0.83 + 2.1);
    }

    // Torsion about the hanging axis (badge +Y), a bit stiffer when wound up
    const rel = twist - facing - hoverCur.yaw - swayYaw;
    t1.set(0, 1, 0).applyQuaternion(q);
    const wY = w.dot(t1);
    if (flipT >= 0) {
      flipT += h;
      if (flipT > FLIP_MAX_T || (Math.abs(rel) < 0.05 && Math.abs(wY) < 0.5)) flipT = -1;
    }
    if (flipT >= 0) {
      T.addScaledVector(t1, -K_FLIP * rel - C_FLIP * wY);
    } else {
      const stiff = 1 + 0.3 * (rel / Math.PI) * (rel / Math.PI);
      T.addScaledVector(t1, -K_TWIST * stiff * rel - C_TWIST * wY);
    }

    // Hover pitch acts around the badge's own X axis
    if (hoverCur.pitch) T.add(t1.set(K_PITCH * hoverCur.pitch, 0, 0).applyQuaternion(q));

    // Grab: damped spring from the grabbed point to the pointer target
    if (grab) {
      const f = (k + 1) / n;
      t1.lerpVectors(grab.start, grab.end, f); // target, interpolated across the frame
      rW.copy(grab.local).applyQuaternion(q);
      t2.addVectors(x, rW); // grabbed point
      t3.crossVectors(w, rW).add(v).sub(grab.vT); // relative velocity
      const kS = GRAB_W * GRAB_W * M;
      const cS = 2 * GRAB_Z * GRAB_W * M;
      t1.sub(t2).multiplyScalar(kS).addScaledVector(t3, -cS);
      t1.y += M * G * GRAB_LIFT; // the hand carries the weight: no sag under the pointer
      if (t1.length() > GRAB_MAX_F) t1.setLength(GRAB_MAX_F);
      F.add(t1);
      T.add(t2.crossVectors(rW, t1));
    }

    // Integrate the body (angular part in the body frame, with the gyroscopic term)
    v.addScaledVector(F, h / M);
    qi.copy(q).invert();
    t1.copy(w).applyQuaternion(qi); // ω body
    t2.copy(T).applyQuaternion(qi); // τ body
    t3.set(t1.x * inertia.x, t1.y * inertia.y, t1.z * inertia.z);
    t3.crossVectors(t1, t3);
    t1.x += (t2.x - t3.x) * invI.x * h;
    t1.y += (t2.y - t3.y) * invI.y * h;
    t1.z += (t2.z - t3.z) * invI.z * h;
    w.copy(t1).applyQuaternion(q);
    if (v.length() > MAX_V * 1.5) v.setLength(MAX_V * 1.5);
    if (w.length() > MAX_W) w.setLength(MAX_W);
    xp.copy(x);
    x.addScaledVector(v, h);
    qp.copy(q);
    rotateBy(w.x * h, w.y * h, w.z * h);

    // Constraints
    for (let it = 0; it < ITER; it++) pinRing();

    if (limitOn) limitSwing(h);

    // Velocities from positions
    const inv = 1 / h;
    v.subVectors(x, xp).multiplyScalar(inv);
    qi.copy(qp).invert().premultiply(q); // q * qp⁻¹
    w.set(qi.x, qi.y, qi.z).multiplyScalar((qi.w < 0 ? -2 : 2) * inv);

    // Air drag: a flat card moving face-on is braked much more than edge-on
    t1.set(0, 0, 1).applyQuaternion(q);
    const vn = v.dot(t1);
    v.addScaledVector(t1, -vn * (1 - Math.exp(-DAMP_FACE * h)));
    v.multiplyScalar(Math.exp(-DAMP_LIN * h));
    qi.copy(q).invert();
    t1.copy(w).applyQuaternion(qi);
    const grabDamp = grab ? 3 : 0; // a hand steadies the badge it holds
    t1.x *= Math.exp(-(DAMP_AX + grabDamp) * h);
    t1.y *= Math.exp(-(DAMP_AY + grabDamp * 0.3) * h);
    t1.z *= Math.exp(-(DAMP_AZ + grabDamp) * h);
    w.copy(t1).applyQuaternion(q);

    updateTwist(h);
  }

  // Interpolated pose between the last two substeps (smooth at any refresh rate)
  function writeOutput(alpha) {
    badge.quaternion.slerpQuaternions(ql, q, alpha);
    t1.copy(pivotLocal).applyQuaternion(ql).add(xl);
    t2.copy(pivotLocal).applyQuaternion(q).add(x);
    badge.position.lerpVectors(t1, t2, alpha);
  }

  function finite() {
    return Number.isFinite(x.x + x.y + x.z + q.x + q.y + q.z + q.w + v.x + v.y + v.z + w.x + w.y + w.z);
  }

  function update(dt) {
    if (sleeping) return;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, MAX_DT);
    acc += dt;
    const n = Math.min(MAX_STEPS, Math.floor(acc / STEP));
    if (grab) {
      // The pointer target moves linearly across this frame's substeps
      grab.start.copy(grab.cur);
      grab.vT.subVectors(grab.end, grab.start).divideScalar(Math.max(dt, 1 / 240));
      if (grab.vT.length() > MAX_V) grab.vT.setLength(MAX_V);
    }
    anchorFrom.copy(hook);
    // This frame's hook target: the anchor, reached at no more than HOOK_V
    hookTo.subVectors(anchor, hook);
    const maxStep = HOOK_V * Math.max(n * STEP, 1e-6);
    if (hookTo.length() > maxStep) hookTo.setLength(maxStep);
    hookTo.add(hook);
    for (let k = 0; k < n; k++) {
      xl.copy(x);
      ql.copy(q);
      hook.lerpVectors(anchorFrom, hookTo, (k + 1) / n);
      substep(STEP, k, n);
    }
    acc -= n * STEP;
    if (acc > STEP) acc = 0; // dropped substeps: never try to catch up
    if (grab && n > 0) grab.cur.copy(grab.end);

    if (!finite()) {
      // Never leave a broken transform on screen
      grab = null;
      reset();
    }
    writeOutput(acc / STEP);

    // Sleep once everything is still (and no sway, hover easing or grab is pending)
    const busy = grab || swayEnv > 0 ||
      Math.abs(hoverCur.yaw - hoverTarget.yaw) + Math.abs(hoverCur.pitch - hoverTarget.pitch) > 1e-3;
    const still = v.length() < SLEEP_V && w.length() < SLEEP_W;
    quiet = !busy && still ? quiet + dt : 0;
    if (quiet > SLEEP_AFTER) {
      sleeping = true;
      v.set(0, 0, 0);
      w.set(0, 0, 0);
      xl.copy(x);
      ql.copy(q);
      acc = 0;
      writeOutput(1);
    }
  }

  function wake() {
    lastInput = time;
    if (!sleeping) return;
    sleeping = false;
    quiet = 0;
  }

  // Ray against the badge's oriented box (as drawn). Returns the distance or -1.
  const boxMin = new V3(), boxMax = new V3();
  const lastHit = new V3(), lastHitLocal = new V3();
  function rayBox(ray, margin) {
    qi.copy(badge.quaternion).invert();
    ray2.origin.copy(ray.origin).sub(badge.position).applyQuaternion(qi);
    ray2.direction.copy(ray.direction).applyQuaternion(qi).normalize();
    boxMin.set(holderX - bw / 2 - margin, pivotFromTop - bh - margin, -0.35);
    boxMax.set(holderX + bw / 2 + margin, pivotFromTop + margin, 0.35);
    let tmin = -Infinity, tmax = Infinity;
    for (const a of ["x", "y", "z"]) {
      const o = ray2.origin[a], d = ray2.direction[a];
      if (Math.abs(d) < 1e-9) {
        if (o < boxMin[a] || o > boxMax[a]) return -1;
        continue;
      }
      let ta = (boxMin[a] - o) / d, tb = (boxMax[a] - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      tmin = Math.max(tmin, ta);
      tmax = Math.min(tmax, tb);
      if (tmin > tmax) return -1;
    }
    if (tmax < 0) return -1;
    const t = Math.max(tmin, 0);
    // Prefer the point on the card's mid plane (z = 0): that is where the eye sees it
    const tz = Math.abs(ray2.direction.z) > 1e-4 ? -ray2.origin.z / ray2.direction.z : t;
    const tc = tz >= tmin && tz <= tmax ? tz : t;
    if (!(tc >= 0) || !Number.isFinite(tc)) return -1; // a NaN ray (zero-size canvas) never grabs
    lastHit.copy(ray.direction).normalize().multiplyScalar(tc).add(ray.origin);
    t3.copy(ray2.direction).multiplyScalar(tc).add(ray2.origin); // local hit
    lastHitLocal.copy(t3);
    return tc;
  }

  function hitTest(ray, margin = 0.2) {
    return rayBox(ray, margin) >= 0;
  }

  function hover(ray) {
    let yaw = 0, pitch = 0;
    if (ray && !grab && rayBox(ray, 0.2) >= 0) {
      const u = Math.max(-1, Math.min(1, (lastHitLocal.x - holderX) / (bw / 2)));
      const c = pivotFromTop - bh / 2;
      const vv = Math.max(-1, Math.min(1, (lastHitLocal.y - c) / (bh / 2)));
      // The face turns toward the pointer (the body axes are mirrored when the back is shown)
      const sgn = Math.cos(facing) >= 0 ? 1 : -1;
      yaw = HOVER_YAW * u * sgn;
      pitch = -HOVER_PITCH * vv * sgn;
    }
    if (Math.abs(yaw - hoverTarget.yaw) + Math.abs(pitch - hoverTarget.pitch) > 1e-4) {
      hoverTarget.yaw = yaw;
      hoverTarget.pitch = pitch;
      wake();
    }
  }

  // Input timing: pass the event's timeStamp when there is one. Events queued behind a long
  // frame arrive in a burst, and stamping them on arrival turned a slow drag into a flick.
  const stamp = (t) => (Number.isFinite(t) ? t : performance.now());

  function pointerDown(ray, margin = 0.2, time) {
    if (rayBox(ray, margin) < 0) return false;
    const now = stamp(time);
    grab = {
      local: lastHit.clone().sub(x).applyQuaternion(qi.copy(q).invert()),
      planeN: ray.direction.clone().normalize().negate(), // plane facing the camera
      planeP: lastHit.clone(),
      start: lastHit.clone(),
      end: lastHit.clone(),
      cur: lastHit.clone(),
      vT: new V3(),
      samples: [{ t: now, x: lastHit.x, y: lastHit.y, z: lastHit.z }],
      t0: now,
      travel: 0,
      // the hook slides along its rail (the bounds) with the pointer, at this offset
      hookOff: new V3(anchor.x - lastHit.x, anchor.y - lastHit.y, 0),
      reach: lastHit.distanceTo(t1.copy(ringLocal).applyQuaternion(q).add(x)) + 2.5,
    };
    hoverTarget.yaw = hoverTarget.pitch = 0;
    wake();
    return true;
  }

  function pointerMove(ray, time) {
    if (!grab) return;
    const denom = ray.direction.dot(grab.planeN);
    if (Math.abs(denom) < 1e-6) return;
    const t = t1.subVectors(grab.planeP, ray.origin).dot(grab.planeN) / denom;
    if (!(t > 0)) return;
    t2.copy(ray.direction).multiplyScalar(t).add(ray.origin);
    // The hook follows the pointer as far as its bounds let it (with equal min and max y it
    // slides on a horizontal rail); it gets there across the next frame's substeps
    anchor.set(t2.x + grab.hookOff.x, t2.y + grab.hookOff.y, anchor.z);
    clampHook(anchor);
    // The hand pulls the badge around its hook: out of reach, the target stops at the circle
    // the badge can reach about it, and never above it
    t3.subVectors(t2, anchor);
    if (t3.length() > grab.reach) t2.copy(anchor).addScaledVector(t3, grab.reach / t3.length());
    if (t2.y > anchor.y - 1) t2.y = anchor.y - 1;
    grab.travel += t2.distanceTo(grab.end);
    grab.end.copy(t2);
    const now = stamp(time);
    grab.samples.push({ t: now, x: t2.x, y: t2.y, z: t2.z });
    while (grab.samples.length > 2 && now - grab.samples[0].t > 100) grab.samples.shift();
    wake();
  }

  // opts.cancel: the browser took the pointer away (pointercancel, blur, hidden tab): let go
  // with the current momentum but never read it as a tap or a flick
  function pointerUp(opts) {
    if (!grab) return;
    const g = grab;
    grab = null;
    const now = stamp(opts?.time);
    if (opts?.cancel) {
      if (v.length() > RELEASE_V) v.setLength(RELEASE_V);
      wake();
      return;
    }
    // Pointer speed over the last ~100 ms (zero if it had stopped before the release)
    const s = g.samples;
    const a = s[0], b = s[s.length - 1];
    let vx = 0;
    if (s.length > 1 && now - b.t < 60 && b.t - a.t > 4) vx = (b.x - a.x) / ((b.t - a.t) / 1000);

    if (g.travel < 0.35 && now - g.t0 < 350) {
      // A tap flips the badge over, turning away from the side that was touched
      flip(g.local.x - holderX >= 0 ? 1 : -1);
    } else if (Math.abs(vx) > SPIN_MIN) {
      // A sideways flick spins it like a globe: the face follows the finger
      const spin = Math.min(SPIN_MAX, (Math.abs(vx) - SPIN_MIN) / SPIN_R);
      w.addScaledVector(t1.set(0, 1, 0).applyQuaternion(q), Math.sign(vx) * spin);
      // Part of the sideways throw went into the spin
      v.x *= 0.55;
    }
    if (v.length() > RELEASE_V) v.setLength(RELEASE_V);
    if (w.length() > MAX_W) w.setLength(MAX_W);
    wake();
  }

  // Turn the badge over (dir +1: the right edge goes away from the viewer, as if pushed)
  function flip(dir = 1) {
    const sgn = Math.cos(facing) >= 0 ? 1 : -1;
    facing += Math.PI * (dir >= 0 ? 1 : -1) * sgn;
    flipT = 0;
    wake();
  }

  function clampHook(p) {
    if (!bounds) return p;
    p.x = Math.min(bounds.maxX, Math.max(bounds.minX, p.x));
    p.y = Math.min(bounds.maxY, Math.max(bounds.minY, p.y));
    return p;
  }

  // Where a drag may carry the hook. A hook already outside them slides back in.
  function setBounds(b) {
    bounds = b && [b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite) ? { ...b } : null;
    if (!bounds) return;
    if (bounds.maxX < bounds.minX) bounds.minX = bounds.maxX = (bounds.minX + bounds.maxX) / 2;
    if (bounds.maxY < bounds.minY) bounds.minY = bounds.maxY;
    const p = clampHook(anchor.clone());
    if (p.distanceToSquared(anchor) > 1e-10) setAnchor(p, true);
  }

  // keepMotion false moves the whole rig rigidly (resize); true moves only the hook
  // and the badge gets carried
  function setAnchor(vec, keepMotion = false) {
    if (!Number.isFinite(vec.x + vec.y + vec.z)) return;
    t1.subVectors(vec, anchor);
    anchor.copy(vec);
    if (!keepMotion) {
      hook.add(t1);
      x.add(t1);
      xp.add(t1);
      xl.add(t1);
      if (grab) {
        grab.start.add(t1);
        grab.end.add(t1);
        grab.cur.add(t1);
        grab.planeP.add(t1);
      }
      badge.position.add(t1);
    }
    // keepMotion: the hook slides to the new anchor across the next frame's substeps
    wake();
  }

  // Extra kick (cm/s) applied at the centre of mass, e.g. from the page scroll
  function impulse(vec) {
    if (!Number.isFinite(vec.x + vec.y + vec.z)) return;
    v.add(vec);
    if (v.length() > MAX_V) v.setLength(MAX_V); // a fast page scroll must not fling it off screen
    wake();
  }

  reset();
  lastInput = 0;

  return {
    badge,
    update,
    hitTest,
    pointerDown,
    pointerMove,
    pointerUp,
    hover,
    isSleeping: () => sleeping,
    isDragging: () => !!grab,
    wake,
    setAnchor,
    setBounds,
    flip,
    impulse,
    reset() {
      grab = null;
      reset();
      wake();
    },
    setIdleSway(on) {
      swayOn = !!on && !reduced;
      wake();
    },
    get twist() {
      return twist;
    },
    get facing() {
      return facing;
    },
    get anchor() {
      return anchor;
    },
    // where the ring top hangs right now (trails the anchor while it moves)
    get hook() {
      return hook;
    },
    // Rest pose numbers the host needs for framing
    rest: {
      pivotY: () => anchor.y - ringTop,
      centreY: () => anchor.y - ringTop + pivotFromTop - bh / 2,
      centreX: () => anchor.x + holderX,
    },
  };
}

// ---------------------------------------------------------------------
// Pointer + touch plumbing for a rig drawn on `canvas` with `camera`.
// Mouse/pen: hover tilt, drag, grab/grabbing cursor over the badge.
// Touch: a touch that starts on the badge holds it, but the first move decides: a vertical
// swipe is the browser's (it scrolls the page, touch-action pan-y), anything else drags the
// badge. A tap still flips it. Every touch off the badge scrolls the page.
// `target` (default: the canvas) is the element that listens. Pass the section
// under the canvas and give the canvas `pointer-events: none` so links and text
// in that section stay clickable/selectable everywhere except on the badge.
// ---------------------------------------------------------------------
function bindBadgeInput(THREE, { canvas, camera, rig, onWake = () => {}, touchMargin = 0.45, target = canvas }) {
  const controller = new AbortController();
  const { signal } = controller;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const el = target || canvas;
  const prevTouchAction = el.style.touchAction;
  const prevCursor = el.style.cursor;
  el.style.touchAction = "pan-y pinch-zoom";

  let mode = null; // 'mouse' | 'touch' while dragging
  let pointerId = -1;
  let touchId = -1;
  let touchX = 0, touchY = 0; // where the touch started, until its first move decides
  let touchLocked = false; // the touch is a drag (not a scroll)
  let overBadge = false;
  let lastX = 0, lastY = 0; // last client position of the dragging mouse (for page scrolls)
  let swallowClick = false; // a press on the badge: the click it ends in is not for a link under it

  // Event time in the performance.now() timebase (old engines used epoch time: ignore those)
  const stampOf = (e) => {
    const t = e.timeStamp, now = performance.now();
    return t > 0 && t <= now + 50 ? t : now;
  };
  const rayAt = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / (r.width || 1)) * 2 - 1, -((cy - r.top) / (r.height || 1)) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  };
  const setCursor = (c) => {
    if (el.style.cursor !== c) el.style.cursor = c;
  };
  const kick = () => {
    if (!rig.isSleeping()) onWake();
  };

  // cancel: the browser took the pointer (pointercancel, second finger, blur, hidden tab)
  const end = (time, cancel = false) => {
    if (!mode) return;
    const wasMouse = mode === "mouse";
    const id = pointerId;
    mode = null;
    pointerId = -1;
    touchId = -1;
    if (wasMouse && id >= 0) {
      try {
        if (el.hasPointerCapture?.(id)) el.releasePointerCapture(id);
      } catch {}
    }
    rig.pointerUp({ time, cancel });
    setCursor(overBadge ? "grab" : "");
    kick();
  };

  // --- Mouse / pen ---
  el.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    if (mode === "mouse") {
      if (e.pointerId === pointerId) {
        lastX = e.clientX;
        lastY = e.clientY;
        rig.pointerMove(rayAt(e.clientX, e.clientY), stampOf(e));
      }
      kick();
      return;
    }
    if (mode) return;
    const ray = rayAt(e.clientX, e.clientY);
    overBadge = rig.hitTest(ray);
    rig.hover(overBadge ? ray : null);
    setCursor(overBadge ? "grab" : "");
    // Mouse activity keeps the idle sway alive (the rig sleeps a while after it stops)
    rig.wake();
    kick();
  }, { signal });

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || mode || e.button !== 0) return;
    const ray = rayAt(e.clientX, e.clientY);
    swallowClick = false;
    if (!rig.pointerDown(ray, undefined, stampOf(e))) return;
    swallowClick = true;
    e.preventDefault(); // no text selection while dragging
    mode = "mouse";
    pointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    rig.hover(null);
    setCursor("grabbing");
    kick();
  }, { signal });

  const onPointerUp = (e) => {
    if (mode === "mouse" && e.pointerId === pointerId) end(stampOf(e));
  };
  const onPointerLost = (e) => {
    if (mode === "mouse" && e.pointerId === pointerId) end(stampOf(e), true);
  };
  el.addEventListener("pointerup", onPointerUp, { signal });
  el.addEventListener("click", (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, { signal, capture: true });
  el.addEventListener("pointercancel", onPointerLost, { signal });
  el.addEventListener("lostpointercapture", onPointerLost, { signal });
  // Fallback if capture was refused: a release anywhere ends the drag
  window.addEventListener("pointerup", onPointerUp, { signal });
  // The page scrolled under a held mouse (wheel, keys): the pointer moved relative to the badge
  window.addEventListener("scroll", () => {
    if (mode !== "mouse") return;
    rig.pointerMove(rayAt(lastX, lastY));
    kick();
  }, { signal, passive: true });

  el.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "touch" || mode) return;
    overBadge = false;
    rig.hover(null);
    setCursor("");
    kick();
  }, { signal });

  // --- Touch ---
  const findTouch = (list) => {
    for (let i = 0; i < list.length; i++) if (list[i].identifier === touchId) return list[i];
    return null;
  };

  el.addEventListener("touchstart", (e) => {
    if (mode === "touch") {
      // A second finger: let go, the gesture belongs to the browser
      if (e.touches.length > 1) end(stampOf(e), true);
      return;
    }
    if (mode || e.touches.length !== 1) return;
    const t = e.changedTouches[0];
    const ray = rayAt(t.clientX, t.clientY);
    if (!rig.pointerDown(ray, touchMargin, stampOf(e))) return; // not on the badge: the page scrolls
    // No preventDefault here: the page must still be able to scroll if this turns out to be a swipe
    mode = "touch";
    touchId = t.identifier;
    touchX = t.clientX;
    touchY = t.clientY;
    touchLocked = false;
    kick();
  }, { signal, passive: false });

  el.addEventListener("touchmove", (e) => {
    if (mode !== "touch") return;
    if (e.touches.length > 1) {
      end(stampOf(e), true);
      return;
    }
    const t = findTouch(e.changedTouches);
    if (!t) return;
    if (!touchLocked) {
      const dx = Math.abs(t.clientX - touchX), dy = Math.abs(t.clientY - touchY);
      // Not cancelable: the browser is already scrolling. Mostly vertical: let it scroll.
      if (!e.cancelable || (dy > dx && dy > 4)) {
        end(stampOf(e), true);
        return;
      }
      if (dx <= 4) return; // too small to tell yet
      touchLocked = true;
    }
    e.preventDefault();
    rig.pointerMove(rayAt(t.clientX, t.clientY), stampOf(e));
    kick();
  }, { signal, passive: false });

  el.addEventListener("touchend", (e) => {
    if (mode === "touch" && findTouch(e.changedTouches)) end(stampOf(e));
  }, { signal });
  el.addEventListener("touchcancel", (e) => {
    if (mode === "touch" && findTouch(e.changedTouches)) end(stampOf(e), true);
  }, { signal });

  // Focus lost or tab hidden mid-drag: drop the badge
  window.addEventListener("blur", () => {
    end(undefined, true);
    overBadge = false;
    rig.hover(null);
    setCursor("");
    kick();
  }, { signal });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) end(undefined, true);
  }, { signal });

  return {
    dispose() {
      controller.abort();
      if (mode) {
        const id = pointerId;
        mode = null;
        try {
          if (id >= 0 && el.hasPointerCapture?.(id)) el.releasePointerCapture(id);
        } catch {}
        rig.pointerUp({ cancel: true });
      }
      rig.hover(null);
      el.style.cursor = prevCursor;
      el.style.touchAction = prevTouchAction;
    },
  };
}

// =====================================================================
// ABOUT BADGE SCENE
// Production scene for <section data-badge> on the About page: the clear PVC
// holder (plastic.js) with Nicola's card (card.js) hanging by its split ring from
// an invisible hook just above the section's top edge (physics.js, pinned pivot),
// drawn on a transparent canvas laid over the section. No lanyard: the ring
// leaves the section through its top edge, like ref/mockup-section.png.
// One entry point, createAboutBadge; every helper is prefixed aboutBadge…/
// ABOUT_BADGE_… because the code is pasted into nr-port.js.
// Units: cm. Badge space: origin = slot centre, hangs along -Y, front +Z.
// World: origin = the holder's centre at rest, the camera looks down -Z at it.
// The other modules are found in scope (nr-port.js pastes them all in one file)
// or passed as opts.modules (the lab imports them).
// =====================================================================

// Production photo (same image as ref/nico.png, served with CORS *)
const ABOUT_BADGE_PHOTO = "https://cdn.prod.website-files.com/6928a718958d854622ebb4f7/695b69ca31573e0ee4653df7_nico.avif";
// Holder outline in badge space, used only if plastic.js exposes neither `holder` nor its shader
// defines (mirrors BADGE_DIM: top, bot, ox -/+ hw)
const ABOUT_BADGE_HOLDER_FALLBACK = { top: 0.809, bottom: 0.809 - 11.355, left: -0.01 - 3.405, right: -0.01 + 3.405 };
// Top of the split ring (plastic.js ringAnchor) if the badge does not expose it
const ABOUT_BADGE_RING_FALLBACK = [0.265, 1.395, 0.063];
const ABOUT_BADGE_FOV = 20; // vertical, across the section: narrow, so the badge reads flat like the photo
// Framing for the white stage box ([data-badge]) of the boxed layout (mockup slide 44): holder
// top just under the box's top edge, holder ~80 % of the box height, centred. Portrait boxes
// (phones) are width-limited: the holder takes ~52 % of the box width, the text runs below it.
const ABOUT_BADGE_FRAME = {
  top: 0.02, // holder top below the box's top edge (share of the height)
  fillH: 0.8, // holder height / box height, landscape
  fillPortrait: 0.609, // same on portrait (phones end up width-limited before this)
  fillW: 0.52, // holder width / box width at most (phones)
  portraitAt: 0.9, // aspect ratios between these blend the two heights (no jump at 1:1)
  landscapeAt: 1.2,
};
const ABOUT_BADGE_INTRO_AT = 0.35; // share of the section on screen that starts the intro
// Intro: the hook lowers the badge in from above the section. Its height eases in critically
// damped (it never dips below the rest height, so the ring top never shows), while its sideways
// travel overshoots a little and the badge swings in on the ring.
const ABOUT_BADGE_INTRO = { dx: -2.4, omegaY: 6.2, omegaX: 4.6, zetaX: 0.5, maxTime: 2.5 };
// 0.001: a section that only touches the viewport edge counts as intersecting with ratio 0;
// that step reports the first pixel coming into view
const ABOUT_BADGE_IO_STEPS = [0, 0.001, 0.05, 0.15, 0.25, 0.35, 0.5, 0.75, 1];
const ABOUT_BADGE_HOVER = { yaw: 0.1, pitch: 0.06 }; // rad at the holder's edges
// Swing cone about the hook (rad): the badge never flips over its hook out through the top edge,
// and the ring is never seen at a grazing angle right under the edge
const ABOUT_BADGE_SWING = { pitch: 0.79, roll: 1.4 }; // 45°, 80°

/**
 * createAboutBadge(THREE, opts) -> { ready, dispose(), rig, debug }
 * opts: { section (size source + input target, required), host (canvas parent, default section),
 *   photo (URL or loaded image), photoFocus, fields (card overrides), quality ('auto'|'high'|'low'),
 *   reducedMotion (default: the media query), ticker ({ add, remove }, e.g. gsap.ticker; default
 *   own requestAnimationFrame), intro (default true), avoid (element or list: text the holder
 *   moves sideways to clear, e.g. the stage's top links on phones), onError(err), modules (lab only) }
 * Resolves as soon as the scene objects exist; `ready` resolves after the first frame with the
 * card has been drawn (or right away if dispose() comes first). dispose() is safe at any time.
 */
async function createAboutBadge(THREE, opts = {}) {
  const section = opts.section || null;
  const host = opts.host || section;
  const onError = typeof opts.onError === "function" ? opts.onError : (e) => console.warn("[about-badge]", e);
  const reduced = opts.reducedMotion ?? aboutBadgeReducedMotion();
  const quality = aboutBadgeQuality(opts.quality);
  const low = quality === "low";
  const ticker = opts.ticker && typeof opts.ticker.add === "function" && typeof opts.ticker.remove === "function" ? opts.ticker : null;
  const mods = aboutBadgeModules(opts.modules);
  const avoid = [].concat(opts.avoid || []).filter((el) => el && el.nodeType === 1);
  const V3 = THREE.Vector3;

  // --- Lifecycle ---
  let disposed = false;
  let isReady = false;
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  const abort = new AbortController();
  const { signal } = abort;
  const aborted = new Promise((r) => signal.addEventListener("abort", r, { once: true }));
  let compiling = null; // pending compileAsync: GPU teardown waits for it

  // --- Scene objects (filled in below; dispose frees whatever exists) ---
  let renderer = null, canvas = null, scene = null, camera = null;
  let badge = null, rig = null, input = null;
  let cardTex = null, backTex = null;
  let ro = null, io = null;
  let holder = null; // { top, bottom, halfWidth, x, width, height } badge space
  let ring = null; // top of the split ring, badge space: the point that sits on the hook
  let hostPosition = null; // inline position we overrode on the host

  // --- Loop / visibility state ---
  let running = false, rafId = 0, last = 0;
  let inView = false, contextLost = false;
  let dirty = true, pendingResize = true;
  const t0 = performance.now();
  const stats = { ticks: 0, renders: 0, resizes: 0 };

  // --- Framing + intro state ---
  const restBase = new V3(); // the hook with the holder centred, world space
  const restAnchor = new V3(); // the hook at rest: restBase moved sideways by shiftX
  let shiftX = 0;
  const anchorNow = new V3();
  const tmp = new V3();
  let frame = { w: 1, h: 1, visH: 1, centre: 0.5, holderPx: 0, edgeY: 0 };
  let dropH = 0;
  const introOn = opts.intro !== false && !reduced;
  let introState = introOn ? "holding" : "off"; // holding -> running -> done
  let introReached = false;
  let introT = 0;

  const debug = {
    get stats() { return { ...stats }; },
    get running() { return running; },
    get inView() { return inView; },
    get ready() { return isReady; },
    get disposed() { return disposed; },
    get awake() { return !!rig && !rig.isSleeping(); },
    get introState() { return introState; },
    get frame() { return { ...frame, dropH, pixelRatio: renderer ? renderer.getPixelRatio() : 0 }; },
    get holder() { return holder; },
    get ring() { return ring; },
    get hook() { return restAnchor.clone(); },
    quality,
    reducedMotion: reduced,
    get renderer() { return renderer; },
    get scene() { return scene; },
    get camera() { return camera; },
    get badge() { return badge; },
    wake: () => { rig?.wake(); kick(); },
  };
  const handle = { ready, dispose, rig: null, debug };

  function fail(err) {
    if (disposed) return;
    try { onError(err); } catch {}
    dispose();
  }

  if (!section || !host) {
    fail(new Error("createAboutBadge: opts.section is required"));
    return handle;
  }
  const missing = Object.keys(mods).filter((k) => typeof mods[k] !== "function");
  if (missing.length) {
    fail(new Error(`createAboutBadge: missing ${missing.join(", ")}`));
    return handle;
  }

  // ------------------------------------------------------------------
  // Synchronous setup: renderer, badge (no card yet), rig, input, observers
  // ------------------------------------------------------------------
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(aboutBadgePixelRatio(low));
    canvas = renderer.domElement;
    canvas.setAttribute("aria-hidden", "true");
    // Input is bound on the section: the canvas never takes the pointer, so the section's links
    // and text stay clickable everywhere except on the badge. It lies above the section's text:
    // the badge can be carried over any of it.
    Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block", pointerEvents: "none", zIndex: "3" });
    if (getComputedStyle(host).position === "static") {
      hostPosition = host.style.position;
      host.style.position = "relative";
    }
    host.appendChild(canvas);
    canvas.addEventListener("webglcontextlost", () => {
      contextLost = true;
      stop();
    }, { signal });
    canvas.addEventListener("webglcontextrestored", () => {
      contextLost = false;
      dirty = pendingResize = true;
      kick();
    }, { signal });

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(ABOUT_BADGE_FOV, 1, 1, 200);

    badge = mods.createBadge(THREE, { renderer, quality, cardTexture: null, cardBackTexture: null });
    // Hidden until the card is on it: no blank sleeve flashes in if a frame is drawn early
    badge.group.visible = false;
    scene.add(badge.group);
    holder = aboutBadgeHolder(badge);
    ring = aboutBadgeRingTop(THREE, badge);

    // The ring's inner top sits on a fixed hook (pinned pivot): the badge swings, tilts and spins
    // about it, and the hook never moves into view. The rig's badge space has the ring at x = 0,
    // so the holder sits beside it by the ring's offset.
    // (z: the ring's top sits a bit off the sheet; the holder itself stays on the framed plane)
    restBase.set(ring.x - holder.x, ring.y - holder.top + holder.height / 2, ring.z);
    restAnchor.copy(restBase);
    anchorNow.copy(restAnchor);
    rig = mods.createBadgeRig(THREE, {
      anchor: restAnchor,
      badgeSize: { width: holder.width, height: holder.height },
      pivotFromTop: holder.top,
      ringTop: ring.y,
      holderX: holder.x - ring.x,
      reducedMotion: reduced,
      idleSway: !reduced,
      // Subtle: about the hook the whole holder tilts, the bottom swings toward the pointer
      hoverYaw: ABOUT_BADGE_HOVER.yaw,
      hoverPitch: ABOUT_BADGE_HOVER.pitch,
      swingLimit: ABOUT_BADGE_SWING,
    });
    handle.rig = rig;

    applyResize();

    input = mods.bindBadgeInput(THREE, { canvas, camera, rig, onWake: kick, target: section });

    // One resize per frame, applied in the tick (a burst of observer callbacks costs nothing)
    ro = new ResizeObserver(() => {
      pendingResize = dirty = true;
      kick();
    });
    ro.observe(section);
    if (host !== section) ro.observe(host);
    aboutBadgeWatchPixelRatio(() => {
      pendingResize = dirty = true;
      kick();
    }, signal);

    io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      // Edge-adjacent (0 px on screen) is "intersecting" too: nothing to draw there
      inView = e.isIntersecting && e.intersectionRatio > 0;
      const rootH = e.rootBounds ? e.rootBounds.height : innerHeight;
      // Ratio of the section, or of the viewport for sections taller than the screen
      if (inView && (e.intersectionRatio >= ABOUT_BADGE_INTRO_AT - 1e-3 || e.intersectionRect.height >= rootH * ABOUT_BADGE_INTRO_AT)) introReached = true;
      maybeStartIntro();
      if (inView) kick();
      else stop();
    }, { threshold: ABOUT_BADGE_IO_STEPS });
    io.observe(section);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else kick();
    }, { signal });
  } catch (err) {
    fail(err);
    return handle;
  }

  // ------------------------------------------------------------------
  // Async part: card art -> textures -> shaders -> first frame
  // ------------------------------------------------------------------
  build().catch(fail);

  async function build() {
    const width = low ? 768 : 1024;
    const photo = aboutBadgePhoto(opts.photo ?? ABOUT_BADGE_PHOTO, signal);
    // card.js waits for the photo and the fonts in parallel; an aborted photo decodes as a
    // placeholder. dispose() stops waiting right away (card.js takes no signal).
    const front = await Promise.race([
      mods.createCardCanvas({ photo, photoFocus: opts.photoFocus, fields: opts.fields, width }),
      aborted,
    ]);
    if (disposed) return;
    const back = mods.createCardBackCanvas({ fields: opts.fields, width });
    cardTex = aboutBadgeCardTexture(THREE, front, renderer);
    backTex = aboutBadgeCardTexture(THREE, back, renderer);
    badge.setCard(cardTex, backTex);
    // Upload now: the first visible frame must not stall on a 1024 x 1631 texture
    renderer.initTexture(cardTex);
    renderer.initTexture(backTex);
    badge.group.visible = true;
    if (pendingResize) applyResize();
    pose();
    if (typeof renderer.compileAsync === "function") {
      // Programs link in the background (KHR_parallel_shader_compile): no long frame on entry
      compiling = renderer.compileAsync(scene, camera).catch(() => {});
      await Promise.race([compiling, aborted]);
      if (disposed) return;
      compiling = null;
    }
    // First full frame, drawn even off-screen so the first visible frame is cheap
    if (pendingResize) applyResize();
    draw();
    dirty = false;
    await aboutBadgeNextFrame();
    if (disposed) return;
    isReady = true;
    resolveReady();
    maybeStartIntro();
    kick();
  }

  // ------------------------------------------------------------------
  // Framing
  // ------------------------------------------------------------------
  function applyResize() {
    pendingResize = false;
    stats.resizes++;
    const w = Math.max(1, Math.round(canvas.clientWidth || host.clientWidth || section.clientWidth || 1));
    const h = Math.max(1, Math.round(canvas.clientHeight || host.clientHeight || section.clientHeight || 1));
    // Browser zoom or a move to another screen changes the ratio: follow it (capped)
    renderer.setPixelRatio(aboutBadgePixelRatio(low));
    renderer.setSize(w, h, false);
    const f = aboutBadgeFraming(w, h, holder);
    frame = { w, h, ...f, edgeY: f.centre * f.visH };
    aboutBadgeAimCamera(THREE, camera, w, h, f);
    // Before the intro the badge waits fully above the section's top edge
    dropH = holder.height + ABOUT_BADGE_FRAME.top * f.visH + 1;
    const shift = (aboutBadgeClearance(canvas, avoid, w, h, f, holder) * f.visH) / h;
    const moved = Math.abs(shift - shiftX) > 1e-6;
    shiftX = shift;
    restAnchor.copy(restBase).x += shift;
    if (introState === "holding") rig.setAnchor(anchorNow.copy(restAnchor).add(tmp.set(ABOUT_BADGE_INTRO.dx, dropH, 0)), false);
    applyBounds();
    // At rest when the shift changes (rotation, a resize across a breakpoint): the hook follows
    if (moved && (introState === "done" || introState === "off") && !rig.isDragging()) {
      rig.setAnchor(anchorNow.copy(restAnchor), introState === "done");
    }
  }

  // The hook slides on a rail along the section's top edge (ring tucked under it): a drag moves
  // the badge sideways, the whole holder staying inside the section
  function applyBounds() {
    if (introState !== "done" && introState !== "off") return;
    // 4 % of the box's shorter side (on a tall phone box the height would eat the room)
    const m = 0.04 * frame.visH * Math.min(1, frame.w / frame.h);
    const halfW = (frame.visH * frame.w) / frame.h / 2;
    const hx = holder.x - ring.x;
    rig.setBounds({
      minX: -halfW + holder.width / 2 + m - hx,
      maxX: halfW - holder.width / 2 - m - hx,
      minY: restAnchor.y,
      maxY: restAnchor.y,
    });
  }

  function introOffset(t) {
    const { dx, omegaY, omegaX, zetaX } = ABOUT_BADGE_INTRO;
    // y: critically damped, always > 0 (the hook stays above its rest height)
    const sy = (1 + omegaY * t) * Math.exp(-omegaY * t);
    const sx = aboutBadgeSpring(t, omegaX, zetaX);
    return tmp.set(dx * sx, dropH * sy, 0);
  }

  function maybeStartIntro() {
    if (introState !== "holding" || !introReached || !isReady || disposed) return;
    introState = "running";
    introT = 0;
    rig.wake();
    kick();
  }

  function stepIntro(dt) {
    // Grabbed while it drops in: the hand takes over from here
    if (rig.isDragging()) {
      introState = "done";
      applyBounds();
      return;
    }
    introT += dt;
    const off = introOffset(introT);
    if (introT > ABOUT_BADGE_INTRO.maxTime || (introT > 1 && off.length() < 0.004)) {
      introState = "done";
      rig.setAnchor(anchorNow.copy(restAnchor), true);
      applyBounds();
      return;
    }
    rig.setAnchor(anchorNow.copy(restAnchor).add(off), true);
  }

  // ------------------------------------------------------------------
  // Loop: runs only while something moves, the section is on screen and the tab is visible
  // ------------------------------------------------------------------
  function canRun() {
    return isReady && !disposed && !contextLost && inView && !document.hidden && introState !== "holding";
  }
  function needsRun() {
    return dirty || pendingResize || introState === "running" || !rig.isSleeping();
  }
  function kick() {
    if (running || disposed) return;
    // Before the intro the badge waits off-screen: only a resize needs a (cheap) redraw
    if (introState === "holding") {
      if (isReady && inView && pendingResize && !document.hidden && !contextLost) start();
      return;
    }
    if (canRun() && needsRun()) start();
  }
  function start() {
    running = true;
    last = performance.now();
    if (ticker) ticker.add(tick);
    else rafId = requestAnimationFrame(rafTick);
  }
  function stop() {
    if (!running) return;
    running = false;
    if (ticker) ticker.remove(tick);
    else if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }
  function rafTick() {
    rafId = 0;
    tick();
    if (running) rafId = requestAnimationFrame(rafTick);
  }
  function tick() {
    if (!running) return;
    const holding = introState === "holding";
    if (holding ? !(isReady && inView && !document.hidden && !contextLost) : !canRun()) {
      stop();
      return;
    }
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    stats.ticks++;
    if (pendingResize) applyResize();
    if (!holding) {
      if (introState === "running") stepIntro(dt);
      rig.update(dt);
    }
    draw();
    dirty = false;
    if (holding || !needsRun()) stop();
  }

  // Rig pose -> badge group (the rig's badge space has the ring at x = 0, plastic's has the slot)
  function pose() {
    const q = rig.badge.quaternion;
    badge.group.quaternion.copy(q);
    // The ring top is drawn exactly on the hook (it rides along while the badge is carried):
    // under a hard flick the solver's joint stretches a few millimetres, enough to pull the
    // ring's top into view under the section's edge
    tmp.set(0, ring.y, 0).applyQuaternion(q);
    badge.group.position.copy(rig.hook).sub(tmp);
    tmp.set(-ring.x, 0, -ring.z).applyQuaternion(q);
    badge.group.position.add(tmp);
  }

  function draw() {
    pose();
    badge.update((performance.now() - t0) / 1000, camera);
    renderer.render(scene, camera);
    stats.renders++;
  }

  // ------------------------------------------------------------------
  // Dispose: safe at any time, also while the card is still loading
  // ------------------------------------------------------------------
  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    abort.abort(); // listeners, photo download, pending awaits in build()
    const safe = (fn) => { try { fn(); } catch {} };
    safe(() => input && input.dispose());
    safe(() => ro && ro.disconnect());
    safe(() => io && io.disconnect());
    safe(() => canvas && canvas.remove());
    if (hostPosition !== null) safe(() => (host.style.position = hostPosition));
    const pending = compiling;
    const gpu = () => {
      safe(() => badge && badge.dispose());
      safe(() => badge && badge.group.removeFromParent());
      safe(() => cardTex && cardTex.dispose());
      safe(() => backTex && backTex.dispose());
      safe(() => scene && scene.clear());
      safe(() => renderer && renderer.dispose());
      // Page transitions would pile up contexts otherwise (browsers cap them at ~16)
      safe(() => renderer && renderer.forceContextLoss());
    };
    // compileAsync polls the programs it is linking: free the GPU once it settles
    if (pending) Promise.race([pending, new Promise((r) => setTimeout(r, 4000))]).then(gpu);
    else gpu();
    resolveReady();
  }

  return handle;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

// The sibling modules: pasted into the same scope in nr-port.js, passed in by the lab pages
function aboutBadgeModules(m = {}) {
  /* eslint-disable no-undef */
  return {
    createBadge: m.createBadge || (typeof createBadge === "function" ? createBadge : null),
    createCardCanvas: m.createCardCanvas || (typeof createCardCanvas === "function" ? createCardCanvas : null),
    createCardBackCanvas: m.createCardBackCanvas || (typeof createCardBackCanvas === "function" ? createCardBackCanvas : null),
    createBadgeRig: m.createBadgeRig || (typeof createBadgeRig === "function" ? createBadgeRig : null),
    bindBadgeInput: m.bindBadgeInput || (typeof bindBadgeInput === "function" ? bindBadgeInput : null),
  };
  /* eslint-enable no-undef */
}

// Holder outline (badge space) -> { top, bottom, left, right, x (centre), halfWidth, width, height }.
// plastic.js returns it as `holder`; older builds only hand BADGE_DIM to the sleeve shader as
// defines, so read them there. Either way the framing follows any change to the holder.
function aboutBadgeHolder(badge) {
  let h = null;
  const b = badge.holder;
  if (b && [b.top, b.bottom, b.left, b.right].every(Number.isFinite)) h = { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
  else {
    badge.group.traverse((o) => {
      const d = o.material && o.material.defines;
      if (h || !d || d.TOP === undefined || d.BOT === undefined || d.HW === undefined) return;
      const hw = parseFloat(d.HW), ox = parseFloat(d.OX || 0);
      h = { top: parseFloat(d.TOP), bottom: parseFloat(d.BOT), left: ox - hw, right: ox + hw };
    });
  }
  if (!h || ![h.top, h.bottom, h.left, h.right].every(Number.isFinite) || h.right <= h.left || h.top <= h.bottom) h = { ...ABOUT_BADGE_HOLDER_FALLBACK };
  h.x = (h.left + h.right) / 2;
  h.halfWidth = (h.right - h.left) / 2;
  h.width = h.right - h.left;
  h.height = h.top - h.bottom;
  return h;
}

// Top of the split ring (badge space): the point that rests on the hook
function aboutBadgeRingTop(THREE, badge) {
  const a = badge.ringAnchor;
  if (a && a.isVector3) return a.clone();
  return new THREE.Vector3(...ABOUT_BADGE_RING_FALLBACK);
}

// Holder size and place for a w x h px section (see ABOUT_BADGE_FRAME). Returns the world height
// the section spans (visH, cm), the holder's centre as a share of the height from the top
// (centre) and the holder's height in px.
// Sideways shift (px, + = right) that keeps the holder at rest clear of the `avoid` text, measured
// glyph-tight (text nodes, not their block boxes) in the canvas's pixels. Text on the left pushes
// it right and vice versa; text on both sides, or no room in the box: as much as fits.
function aboutBadgeClearance(canvas, avoid, w, h, f, holder) {
  if (!avoid.length) return 0;
  const cr = canvas.getBoundingClientRect();
  if (!cr.width || !cr.height) return 0;
  const sx = w / cr.width, sy = h / cr.height;
  const half = (f.holderPx * holder.width) / holder.height / 2;
  const top = ABOUT_BADGE_FRAME.top * h, bottom = top + f.holderPx;
  const gap = 12;
  let right = 0, left = 0;
  const range = document.createRange();
  for (const el of avoid) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (!r.width) continue;
        const l = (r.left - cr.left) * sx, rr = (r.right - cr.left) * sx;
        const t = (r.top - cr.top) * sy, b = (r.bottom - cr.top) * sy;
        if (b <= top || t >= bottom) continue;
        if (l + rr < w) right = Math.max(right, rr + gap - (w / 2 - half));
        else left = Math.max(left, w / 2 + half - (l - gap));
      }
    }
  }
  range.detach?.();
  const room = Math.max(0, w / 2 - half - 0.04 * Math.min(w, h)); // the margin applyBounds keeps
  if (right > 0 && left > 0) return 0;
  return right > 0 ? Math.min(right, room) : -Math.min(left, room);
}

function aboutBadgeFraming(w, h, holder) {
  const F = ABOUT_BADGE_FRAME;
  const k = Math.min(1, Math.max(0, (w / h - F.portraitAt) / (F.landscapeAt - F.portraitAt)));
  const fill = F.fillPortrait + (F.fillH - F.fillPortrait) * k;
  const holderPx = Math.min(fill * h, F.fillW * w * (holder.height / holder.width));
  return { visH: (holder.height * h) / holderPx, centre: F.top + holderPx / h / 2, holderPx };
}

// The camera sits square in front of the holder's centre (the badge is seen straight on, like the
// photo) and the lens is shifted so that centre lands high in the section: an off-centre window
// (setViewOffset) of a taller frame centred on the axis. Raycasts and the sleeve shader read the
// same matrices, so input and refraction stay exact.
function aboutBadgeAimCamera(THREE, camera, w, h, f) {
  const half = THREE.MathUtils.degToRad(ABOUT_BADGE_FOV / 2);
  const dist = f.visH / 2 / Math.tan(half);
  const fullH = 2 * Math.max(f.centre, 1 - f.centre) * h;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(((f.visH * fullH) / h / 2) / dist));
  camera.aspect = w / fullH;
  camera.setViewOffset(w, fullH, 0, fullH / 2 - f.centre * h, w, h);
  camera.position.set(0, 0, dist);
  camera.quaternion.identity();
  // The badge reaches at most ~13 cm toward the lens when it is swung up
  camera.near = Math.max(1, dist - 25);
  camera.far = dist + 25;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

// Auto quality: low on touch devices, small screens and low-memory devices
function aboutBadgeQuality(q) {
  if (q === "high" || q === "low") return q;
  try {
    const coarse = matchMedia("(pointer: coarse)").matches;
    const small = Math.min(screen.width || 9999, screen.height || 9999) <= 540;
    const mem = navigator.deviceMemory;
    return coarse || small || (mem && mem <= 4) ? "low" : "high";
  } catch {
    return "high";
  }
}

function aboutBadgeReducedMotion() {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function aboutBadgePixelRatio(low) {
  return Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2);
}

// devicePixelRatio changes (zoom, another screen) do not always resize the section
function aboutBadgeWatchPixelRatio(cb, signal) {
  const arm = () => {
    if (signal.aborted) return;
    try {
      matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener("change", () => {
        cb();
        arm();
      }, { once: true, signal });
    } catch {}
  };
  arm();
}

// rAF, or a timeout in a hidden tab (rAF does not fire there)
function aboutBadgeNextFrame() {
  return new Promise((resolve) => {
    let t = 0;
    const id = requestAnimationFrame(() => {
      clearTimeout(t);
      resolve();
    });
    t = setTimeout(() => {
      cancelAnimationFrame(id);
      resolve();
    }, 150);
  });
}

// The photo is fetched here (not inside card.js) so dispose() can cancel the download
function aboutBadgePhoto(src, signal) {
  if (typeof src !== "string") return src || null;
  const img = new Image();
  img.crossOrigin = "anonymous"; // the card becomes a WebGL texture: a tainted canvas would throw
  img.decoding = "async";
  img.src = src;
  signal.addEventListener("abort", () => img.removeAttribute("src"), { once: true });
  return img;
}

function aboutBadgeCardTexture(THREE, canvas, renderer) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

// Damped spring released at 1 with no speed: 1 -> 0 with a small overshoot
function aboutBadgeSpring(t, w, z) {
  const wd = w * Math.sqrt(1 - z * z);
  return Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}

export { createAboutBadge };
