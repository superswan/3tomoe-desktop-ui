// js/shader-background.js - Three.js WebGL Shader Background
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";

let renderer, scene, camera, mesh, uniforms, clock;
let materialTexture, materialProcedural, currentMaterial;

const NOISE_W = 256, NOISE_H = 256;

function createNoiseTexture() {
  const noise = new Uint8Array(NOISE_W * NOISE_H * 4);
  for (let i = 0; i < NOISE_W * NOISE_H; i++) {
    const v = (Math.random() * 256) | 0;
    noise[i * 4 + 0] = v;
    noise[i * 4 + 1] = v;
    noise[i * 4 + 2] = v;
    noise[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(noise, NOISE_W, NOISE_H, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

function createShaders() {
  const vertexShader = /* glsl */ `
    precision highp float;
    in vec3 position;
    void main() {
      gl_Position = vec4(position, 1.0);
    }
  `;

  const fragmentShaderBody = `
    precision highp float;
    precision highp int;
    precision highp sampler2D;

    uniform float iTime;
    uniform vec3 iResolution;
    uniform sampler2D iChannel0;
    uniform vec3 iChannelResolution[4];
    uniform vec3 uBgColor;
    uniform float uBgDarken;
    uniform vec3 uGradTilt;
    uniform vec3 uWaveTint;
    uniform float uWaveMix;
    uniform vec2 uWaveBoost;
    uniform float uDustOn;
    uniform float uDustAmt;

    layout(location=0) out vec4 fragColor;

    #define THRESHOLD .99
    #define DUST
    #define MIN_DIST .13
    #define MAX_DIST 40.
    #define MAX_DRAWS 40

    HASH_FUNCTIONS

    float get_stars_rough(vec2 p) {
      float s = smoothstep(THRESHOLD, 1., hash12(p));
      if (s >= THRESHOLD) 
        s = pow((s - THRESHOLD) / (1. - THRESHOLD), 10.);
      return s;
    }

    float get_stars(vec2 p, float a, float t) {
      vec2 pg = floor(p), pc = p - pg, k = vec2(0, 1);
      pc *= pc * pc * (3. - 2. * pc);
      float s = mix(
        mix(get_stars_rough(pg + k.xx), get_stars_rough(pg + k.yx), pc.x),
        mix(get_stars_rough(pg + k.xy), get_stars_rough(pg + k.yy), pc.x),
        pc.y
      );
      return smoothstep(a, a + t, s) * pow(value2d(p * .1 + iTime) * .5 + .5, 8.3);
    }

    float s5(float x) { return .5 + .5 * sin(x); }
    float c5(float x) { return .5 + .5 * cos(x); }

    float get_dust(vec2 p, vec2 size, float f) {
      vec2 ar = vec2(iResolution.x / iResolution.y, 1);
      vec2 pp = p * size * ar;
      return pow(.64 + .46 * cos(p.x * 6.28), 1.7) * f * (
        get_stars(.1 * pp + iTime * vec2(20., -10.1), .11, .71) * 4. +
        get_stars(.2 * pp + iTime * vec2(30., -10.1), .1, .31) * 5. +
        get_stars(.32 * pp + iTime * vec2(40., -10.1), .1, .91) * 2.
      );
    }

    float sdf(vec3 p) {
      p *= 2.;
      float o = 4.2 * sin(.05 * p.x + iTime * .25) +
        (.04 * p.z) * sin(p.x * .11 + iTime) * 2. * sin(p.z * .2 + iTime) *
        value2d(vec2(.03, .4) * p.xz + vec2(iTime * .5, 0));
      return abs(dot(p, normalize(vec3(0, 1, 0.05))) + 2.5 + o * .5);
    }

    vec2 raymarch(vec3 o, vec3 d, float omega) {
      float t = 0., a = 0., g = MAX_DIST, dt = 0., sl = 0., emin = 0.03, ed = emin;
      int dr = 0;
      bool hit = false;
      for (int i = 0; i < 100; i++) {
        vec3 p = o + d * t;
        float ndt = sdf(p);
        if (abs(dt) + abs(ndt) < sl) { sl -= omega * sl; omega = 1.; }
        else sl = ndt * omega;
        dt = ndt;
        t += sl;
        g = (t > 10.) ? min(g, abs(dt)) : MAX_DIST;
        if ((t += dt) >= MAX_DIST) break;
        if (dt < MIN_DIST) {
          if (dr > MAX_DRAWS) break;
          dr++;
          float f = smoothstep(0.09, 0.11, (p.z * .9) / 100.);
          if (!hit) { a = .01; hit = true; }
          ed = 2. * max(emin, abs(ndt));
          a += .0135 * f;
          t += ed;
        }
      }
      g /= 3.;
      return vec2(a, max(1. - g, 0.));
    }

    void main() {
      vec2 U = gl_FragCoord.xy;
      vec2 ires = iResolution.xy, uv = U / ires;
      vec3 o = vec3(0), d = vec3((U - .5 * ires) / ires.y, 1.0);
      vec2 mg = raymarch(o, d, 1.2);
      float m = mg.x;
      
      vec3 c = uBgColor;
      c += (uv.y - 0.5) * uGradTilt;
      c *= uBgDarken;
      
      m = smoothstep(uWaveBoost.x, uWaveBoost.y, m);
      c = mix(c, uWaveTint, m * uWaveMix);
      
      c += uDustOn * get_dust(uv, vec2(2000.), mg.y) * uDustAmt;
      
      fragColor = vec4(c, 1.0);
    }
  `;

  const hashFunctionsTexture = `
    float hash12(vec2 p) {
      ivec2 pi = ivec2(mod(p.x, iChannelResolution[0].x), mod(p.y, iChannelResolution[0].y));
      return texelFetch(iChannel0, pi, 0).r;
    }
    float value2d(vec2 p) {
      return texture(iChannel0, p / iChannelResolution[0].xy).r;
    }
  `;

  const hashFunctionsProcedural = `
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float value2d(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash12(i);
      float b = hash12(i + vec2(1.0, 0.0));
      float c = hash12(i + vec2(0.0, 1.0));
      float d = hash12(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
  `;

  return {
    vertexShader,
    fragmentShaderTexture: fragmentShaderBody.replace('HASH_FUNCTIONS', hashFunctionsTexture),
    fragmentShaderProcedural: fragmentShaderBody.replace('HASH_FUNCTIONS', hashFunctionsProcedural)
  };
}

export function initShaderBackground() {
  const canvas = document.getElementById("shader-bg");
  if (!canvas) return null;
  
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const iChannel0 = createNoiseTexture();

  uniforms = {
    iTime: { value: 0.0 },
    iResolution: { value: new THREE.Vector3(1, 1, 1) },
    iChannel0: { value: iChannel0 },
    iChannelResolution: { value: [new THREE.Vector3(NOISE_W, NOISE_H, 1), new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,0)] },
    uBgColor: { value: new THREE.Vector3(0.15, 0.12, 0.22) },
    uBgDarken: { value: 0.55 },
    uGradTilt: { value: new THREE.Vector3(0.04, 0.02, 0.06) },
    uWaveTint: { value: new THREE.Vector3(0.75, 0.70, 0.85) },
    uWaveMix: { value: 0.7 },
    uWaveBoost: { value: new THREE.Vector2(0.02, 0.28) },
    uDustOn: { value: 1.0 },
    uDustAmt: { value: 0.12 },
  };

  const { vertexShader, fragmentShaderTexture, fragmentShaderProcedural } = createShaders();

  materialTexture = new THREE.RawShaderMaterial({ 
    glslVersion: THREE.GLSL3, 
    uniforms, 
    vertexShader, 
    fragmentShader: fragmentShaderTexture, 
    depthTest: false, 
    depthWrite: false 
  });
  
  materialProcedural = new THREE.RawShaderMaterial({ 
    glslVersion: THREE.GLSL3, 
    uniforms, 
    vertexShader, 
    fragmentShader: fragmentShaderProcedural, 
    depthTest: false, 
    depthWrite: false 
  });

  currentMaterial = materialTexture;
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1,-1,0, 3,-1,0, -1,3,0]), 3));
  
  mesh = new THREE.Mesh(geometry, currentMaterial);
  scene.add(mesh);

  function resize() { 
    const w = window.innerWidth, h = window.innerHeight; 
    renderer.setSize(w, h, false); 
    uniforms.iResolution.value.set(w, h, 1); 
  }
  
  window.addEventListener("resize", resize); 
  resize();

  clock = new THREE.Clock();
  
  function animate() { 
    uniforms.iTime.value = clock.getElapsedTime(); 
    renderer.render(scene, camera); 
    requestAnimationFrame(animate); 
  }
  
  animate();
  
  return { uniforms, mesh, materialTexture, materialProcedural };
}

function hexToRgb(hex) {
  // Handle different hex formats
  if (!hex || typeof hex !== 'string') return { r: 0.15, g: 0.12, b: 0.22 };
  
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Handle 3-digit hex
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  
  // Handle 6-digit hex
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255
    };
  }
  
  return { r: 0.15, g: 0.12, b: 0.22 };
}

export function applyPresetToUniforms(params, uniforms, mesh, materialProcedural, materialTexture) {
  // Ensure params has defaults
  const defaults = {
    bgColor: '#261c38',
    bgDarken: 0.55,
    gradStrength: 0.5,
    waveMix: 0.7,
    waveTint: '#bfb3d9',
    waveBoost: 0.28,
    dustOn: true,
    dustAmt: 0.12,
    daveHoskins: false
  };
  
  const p = { ...defaults, ...params };
  
  // Apply colors safely
  const bgRgb = hexToRgb(p.bgColor);
  uniforms.uBgColor.value.set(bgRgb.r, bgRgb.g, bgRgb.b);
  
  uniforms.uBgDarken.value = p.bgDarken;
  uniforms.uGradTilt.value.set(0.04 * p.gradStrength, 0.02 * p.gradStrength, 0.06 * p.gradStrength);
  
  const waveRgb = hexToRgb(p.waveTint);
  uniforms.uWaveTint.value.set(waveRgb.r, waveRgb.g, waveRgb.b);
  
  uniforms.uWaveMix.value = p.waveMix;
  const lo = 0.02;
  const hi = p.waveBoost;
  uniforms.uWaveBoost.value.set(lo, hi);
  uniforms.uDustOn.value = p.dustOn ? 1.0 : 0.0;
  uniforms.uDustAmt.value = p.dustAmt;
  
  if (mesh && materialProcedural && materialTexture) {
    mesh.material = p.daveHoskins ? materialProcedural : materialTexture;
  }
}
