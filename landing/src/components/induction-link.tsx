"use client";
import { useEffect, useRef, type ReactNode } from "react";

/*
 * Link button with electric arcs crawling along its edge (WebGL). Hovering or focusing adds arcs,
 * a click sends a flash around the plate. The plate size and radius come from the real element.
 * Without WebGL the CSS look of the element stays as it is.
 */

const BLEED = 14;
const PLATES = { cobalt: [0, 0.36, 0.84], ink: [0.043, 0.063, 0.125] } as const;
const ARC: [number, number, number] = [0.36, 0.76, 1.0];
const CORE: [number, number, number] = [0.86, 0.96, 1.0];

const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
const FS = `precision highp float;
uniform vec2 u_res;uniform vec2 u_box;uniform float u_rad;
uniform float u_time;uniform float u_arcs;uniform float u_flash;
uniform vec3 u_plate;uniform vec3 u_arc;uniform vec3 u_core;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);
return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float v=0.0;float a=0.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.05+vec2(9.7,3.1);a*=0.5;}return v;}
float sdRBox(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.0))+min(max(q.x,q.y),0.0)-r;}
void main(){
  float H=u_res.y;
  vec2 p=(gl_FragCoord.xy-0.5*u_res)/H;
  vec2 hs=u_box/H;
  float r=min(u_rad/H,min(hs.x,hs.y));
  float d=sdRBox(p,hs,r);
  float t=u_time;
  float hover=clamp(u_arcs/6.0,0.0,1.0);
  float plate=1.0-smoothstep(-0.004,0.004,d);
  vec3 plateCol=u_plate+u_plate*0.12*(fbm(p*9.0)-0.5);
  plateCol+=u_arc*0.3*exp(d*12.0)*(0.25+hover*0.5);
  float a=atan(p.y,p.x);
  vec3 arcCol=vec3(0.0);
  for(int i=0;i<6;i++){
    float fi=float(i);
    float w=clamp(u_arcs-fi,0.0,1.0);
    float n1=fbm(vec2(a*2.4+fi*11.3,t*(1.6+fi*0.27)+fi*53.1));
    float off=(n1-0.5)*(0.06+u_flash*0.06);
    float seg=smoothstep(0.35,0.75,noise(vec2(a*1.8+fi*7.7,t*(0.9+fi*0.13)+fi*19.0)));
    seg=0.3+0.7*seg;
    float g=0.0042/(abs(d+off)+0.006);
    arcCol+=(u_arc*g+u_core*g*g*0.55)*w*seg;
  }
  float outerMask=1.0-smoothstep(0.04,0.15,d);
  vec3 glow=arcCol*(0.6+0.4*hover)*outerMask;
  float ring=0.006/(abs(d)+0.006);
  glow+=u_core*ring*u_flash*1.5*outerMask;
  glow+=u_core*u_flash*0.16*outerMask;
  vec3 col=min(plateCol*plate+glow,vec3(1.0));
  float alpha=clamp(plate+max(glow.r,max(glow.g,glow.b)),0.0,1.0);
  gl_FragColor=vec4(min(col,vec3(alpha)),alpha);
}`;

export function InductionLink({ href, className = "", variant = "cobalt", onClick, children }: { href: string; className?: string; variant?: keyof typeof PLATES; onClick?: () => void; children: ReactNode }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) return;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = sh(gl.VERTEX_SHADER, VS);
    const fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const U = { res: u("u_res"), box: u("u_box"), rad: u("u_rad"), time: u("u_time"), arcs: u("u_arcs"), flash: u("u_flash") };
    gl.uniform3fv(u("u_plate"), PLATES[variant]);
    gl.uniform3fv(u("u_arc"), ARC);
    gl.uniform3fv(u("u_core"), CORE);
    gl.clearColor(0, 0, 0, 0);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const maxDpr = coarse ? 1.5 : 2;
    const minGap = coarse ? 1000 / 30 : 0;
    const s = { arcs: 2.4, target: 2.4, flash: 0, crawl: Math.random() * 20, visible: false };
    let raf = 0;
    let last = performance.now();

    const draw = () => {
      const bw = el.offsetWidth;
      const bh = el.offsetHeight;
      if (!bw || !bh) return;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const w = Math.round((bw + BLEED * 2) * dpr);
      const h = Math.round((bh + BLEED * 2) * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || bh / 2;
      gl.uniform2f(U.res, w, h);
      gl.uniform2f(U.box, (bw / 2) * dpr, (bh / 2) * dpr);
      gl.uniform1f(U.rad, Math.min(radius, bh / 2) * dpr);
      gl.uniform1f(U.time, s.crawl);
      gl.uniform1f(U.arcs, s.arcs);
      gl.uniform1f(U.flash, s.flash);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      el.dataset.induction = "on";
    };

    const frame = (now: number) => {
      if (now - last < minGap) {
        raf = requestAnimationFrame(frame);
        return;
      }
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!s.visible || document.hidden) return;
      s.arcs += (s.target - s.arcs) * Math.min(1, dt * 5);
      s.flash *= Math.exp(-3.6 * dt);
      s.crawl += dt * (0.6 + (s.arcs / 6) * 1.1 + s.flash * 2.0);
      draw();
      raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (reduced) return draw();
      if (!raf && s.visible) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const io = new IntersectionObserver(([it]) => ((s.visible = it.isIntersecting), kick()), { rootMargin: "80px" });
    io.observe(el);
    const on = () => ((s.target = 5.8), kick());
    const off = () => ((s.target = 2.4), kick());
    const click = () => ((s.flash = 1), kick());
    const vis = () => kick();
    el.addEventListener("pointerenter", on);
    el.addEventListener("pointerleave", off);
    el.addEventListener("focus", on);
    el.addEventListener("blur", off);
    el.addEventListener("click", click);
    document.addEventListener("visibilitychange", vis);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerenter", on);
      el.removeEventListener("pointerleave", off);
      el.removeEventListener("focus", on);
      el.removeEventListener("blur", off);
      el.removeEventListener("click", click);
      document.removeEventListener("visibilitychange", vis);
      delete el.dataset.induction;
    };
  }, [variant]);

  return (
    <a ref={ref} href={href} onClick={onClick} data-variant={variant} className={`induction-btn ${className}`}>
      <canvas ref={canvasRef} aria-hidden className="induction-canvas" />
      {children}
    </a>
  );
}
