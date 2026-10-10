import { gsap } from 'gsap';
import './style.css';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.querySelector('#voice-core');
const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'high-performance' });
let animationFrame = 0;

const vertexSource = `
  attribute vec2 position;
  void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragmentSource = `
  precision highp float;
  uniform vec2 resolution;
  uniform vec2 pointer;
  uniform float time;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);
    uv.x += pointer.x * 0.10;
    uv.y -= pointer.y * 0.06;
    float radius = length(uv);
    vec3 color = vec3(0.0);

    vec2 cell = floor((uv + 1.7) * 18.0);
    float star = step(0.985, hash(cell));
    float flicker = 0.48 + 0.52 * sin(time * 0.8 + hash(cell) * 8.0);
    color += vec3(0.18, 0.42, 0.98) * star * flicker * smoothstep(1.7, 0.15, radius) * 0.55;

    float glow = exp(-5.2 * radius * radius);
    color += vec3(0.02, 0.11, 0.48) * glow;

    if (radius < 0.67) {
      float z = sqrt(max(0.0, 0.4489 - dot(uv, uv)));
      vec3 normal = normalize(vec3(uv.x, uv.y, z));
      vec3 light = normalize(vec3(-0.45, 0.65, 0.75));
      float diffuse = max(dot(normal, light), 0.0);
      float fresnel = pow(1.0 - normal.z, 2.6);
      float angle = atan(normal.y, normal.x);
      float bands = sin(angle * 5.0 + normal.z * 13.0 - time * 0.75 + sin(angle * 3.0 + time * 0.35));
      float line = smoothstep(0.73, 0.98, bands);
      vec3 deep = vec3(0.018, 0.065, 0.30);
      vec3 lit = vec3(0.10, 0.48, 1.0) * (0.22 + diffuse * 0.88);
      color += mix(deep, lit, diffuse) + vec3(0.12, 0.64, 1.0) * fresnel * 1.4;
      color += vec3(0.50, 0.88, 1.0) * line * (0.22 + fresnel) * 0.7;
      float specular = pow(max(dot(reflect(-light, normal), vec3(0.0, 0.0, 1.0)), 0.0), 44.0);
      color += vec3(0.75, 0.95, 1.0) * specular;
    }

    float rim = exp(-85.0 * abs(radius - 0.67));
    color += vec3(0.23, 0.68, 1.0) * rim * 0.45;
    float alpha = max(max(color.r, color.g), color.b);
    gl_FragColor = vec4(color, min(1.0, alpha * 1.55));
  }
`;

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function startVoiceCore() {
  if (!gl) return;
  try {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const resolution = gl.getUniformLocation(program, 'resolution');
    const pointer = gl.getUniformLocation(program, 'pointer');
    const time = gl.getUniformLocation(program, 'time');
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, innerWidth < 600 ? 1.2 : 1.6);
      canvas.width = Math.max(1, Math.round(box.width * dpr));
      canvas.height = Math.max(1, Math.round(box.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const move = (event) => {
      target.x = (event.clientX / innerWidth - .5) * 2;
      target.y = (event.clientY / innerHeight - .5) * 2;
    };
    const render = (milliseconds) => {
      current.x += (target.x - current.x) * .035;
      current.y += (target.y - current.y) * .035;
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform2f(pointer, current.x, current.y);
      gl.uniform1f(time, reduceMotion ? 0 : milliseconds * .001);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reduceMotion && !document.hidden) animationFrame = requestAnimationFrame(render);
    };

    resize();
    addEventListener('resize', resize, { passive: true });
    addEventListener('pointermove', move, { passive: true });
    render(0);
  } catch (error) {
    canvas.style.display = 'none';
    console.warn('Wiss voice field fallback enabled.', error);
  }
}

startVoiceCore();

gsap.set('.intro', { y: 24, opacity: 0 });
gsap.timeline({ defaults: { ease: 'power3.out' } })
  .to('.nav', { opacity: 1, y: 0, duration: .65 })
  .to('.hero-copy .intro', { y: 0, opacity: 1, duration: .78, stagger: .1 }, '-=.2')
  .to('.voice-stage', { y: 0, opacity: 1, duration: 1 }, '-=.72')
  .to('.scroll-cue', { y: 0, opacity: 1, duration: .6 }, '-=.45');

if (!reduceMotion) {
  gsap.to('.status-top', { y: -9, rotation: -1.2, duration: 2.8, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  gsap.to('.status-bottom', { y: 11, rotation: 1, duration: 3.3, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  gsap.to('.signal-track', { xPercent: -50, duration: 23, repeat: -1, ease: 'none' });
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    gsap.to(entry.target, { y: 0, opacity: 1, duration: reduceMotion ? .01 : .82, ease: 'power3.out' });
    observer.unobserve(entry.target);
  });
}, { threshold: .12 });

document.querySelectorAll('.reveal').forEach((element) => {
  gsap.set(element, { y: reduceMotion ? 0 : 28, opacity: reduceMotion ? 1 : 0 });
  if (!reduceMotion) observer.observe(element);
});

addEventListener('beforeunload', () => cancelAnimationFrame(animationFrame));
