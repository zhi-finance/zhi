"use client";

// A carved stone seal (印章) bearing 智 in raised relief, its face inked vermilion.
// The seal is Zhi's idea in one object: you sign the rule tree; the chain only stamps
// trades that pass. Studio-lit, no bloom, no particles.

import { ContactShadows, Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { ZHI_BBOX, ZHI_PATH } from "@/lib/glyph";

const FACE = 1.9; // seal face size (world units)
const DEPTH = 2.6; // seal body length

function useStoneTextures() {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const size = 512;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d")!;
    const img = g.createImageData(size, size);
    // value noise with a few octaves: stone grain + faint veins
    const rnd = (x: number, y: number) => {
      const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const noise = (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = rnd(xi, yi), b = rnd(xi + 1, yi), cc = rnd(xi, yi + 1), d = rnd(xi + 1, yi + 1);
      return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let n = 0, amp = 0.5, f = 4 / size;
        for (let o = 0; o < 5; o++) {
          n += noise(x * f * 8, y * f * 8) * amp;
          amp *= 0.5;
          f *= 2;
        }
        const vein = Math.abs(Math.sin((x * 0.012 + y * 0.02 + n * 3.2) * Math.PI));
        const v = Math.min(255, Math.max(0, 120 + (n - 0.5) * 120 + (vein < 0.06 ? 50 : 0)));
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }, []);
}

function useGlyphGeometry() {
  return useMemo(() => {
    const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${ZHI_PATH}"/></svg>`);
    const shapes = data.paths.flatMap((p) => SVGLoader.createShapes(p));
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: 70, bevelEnabled: true, bevelThickness: 6, bevelSize: 4, bevelSegments: 2, curveSegments: 6 });
    // center the glyph, flip y (font units are y-down), scale to the face
    const cx = (ZHI_BBOX.x1 + ZHI_BBOX.x2) / 2, cy = (ZHI_BBOX.y1 + ZHI_BBOX.y2) / 2;
    geo.translate(-cx, -cy, 0);
    const s = (FACE * 0.72) / Math.max(ZHI_BBOX.x2 - ZHI_BBOX.x1, ZHI_BBOX.y2 - ZHI_BBOX.y1);
    geo.scale(s, -s, s);
    // the y-flip mirrors every triangle; swap two vertices per face to restore outward winding
    const pos = geo.getAttribute("position");
    const uv = geo.getAttribute("uv");
    for (let i = 0; i < pos.count; i += 3) {
      for (const attr of [pos, uv]) {
        if (!attr) continue;
        for (let c = 0; c < attr.itemSize; c++) {
          const a = attr.getComponent(i + 1, c);
          attr.setComponent(i + 1, c, attr.getComponent(i + 2, c));
          attr.setComponent(i + 2, c, a);
        }
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, []);
}

function Seal({ stamp }: { stamp: React.RefObject<number> }) {
  const group = useRef<THREE.Group>(null!);
  const grain = useStoneTextures();
  const glyph = useGlyphGeometry();

  const stone = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#2a2926",
        roughness: 0.62,
        metalness: 0.0,
        clearcoat: 0.35,
        clearcoatRoughness: 0.4,
        roughnessMap: grain ?? undefined,
        bumpMap: grain ?? undefined,
        bumpScale: 0.6,
        map: grain ?? undefined,
      }),
    [grain],
  );
  const ink = useMemo(() => new THREE.MeshStandardMaterial({ color: "#c63d26", roughness: 0.78, metalness: 0, bumpMap: grain ?? undefined, bumpScale: 0.3 }), [grain]);
  if (grain) grain.repeat.set(1.4, 1.4);

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime;
    const px = s.pointer.x, py = s.pointer.y;
    // idle drift + pointer tilt, damped
    const ty = -0.55 + px * 0.35 + Math.sin(t * 0.35) * 0.06;
    const tx = 0.18 - py * 0.22 + Math.sin(t * 0.27) * 0.03;
    group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, ty, 3, dt);
    group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, tx, 3, dt);
    // scroll-driven "stamp": the seal pushes toward the viewer
    const k = stamp.current ?? 0;
    group.current.position.z = THREE.MathUtils.damp(group.current.position.z, k * 1.4, 6, dt);
    group.current.position.y = Math.sin(t * 0.6) * 0.05;
  });

  return (
    <group ref={group}>
      {/* body: the seal extends away from the viewer; the carved face points at the camera */}
      <RoundedBox args={[FACE, FACE, DEPTH]} radius={0.09} smoothness={5} position={[0, 0, -DEPTH / 2]} material={stone} castShadow />
      {/* raised frame around the face (朱文 border) */}
      {[
        [0, FACE / 2 - 0.08, FACE - 0.1, 0.09],
        [0, -FACE / 2 + 0.08, FACE - 0.1, 0.09],
        [FACE / 2 - 0.08, 0, 0.09, FACE - 0.1],
        [-FACE / 2 + 0.08, 0, 0.09, FACE - 0.1],
      ].map(([x, y, w, h], i) => (
        <mesh key={i} position={[x, y, 0.035]} material={ink}>
          <boxGeometry args={[w, h, 0.07]} />
        </mesh>
      ))}
      <mesh geometry={glyph} material={ink} position={[0, 0.02, 0]} />
    </group>
  );
}

export default function SealScene({ paused = false, stamp }: { paused?: boolean; stamp: React.RefObject<number> }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={paused ? "never" : "always"}
      shadows
      camera={{ position: [0.35, 0.15, 7.1], fov: 34 }}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      aria-hidden
    >
      <ambientLight intensity={0.15} />
      <directionalLight position={[3.5, 4, 5]} intensity={2.4} color="#fff4e8" castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-5, 1, -3]} intensity={1.3} color="#cfd8e0" />
      <spotLight position={[0, -4, 3]} intensity={6} angle={0.6} penumbra={1} color="#ffffff" />
      <Environment resolution={256}>
        <Lightformer intensity={1.6} color="#ffffff" position={[0, 5, -4]} scale={[10, 2, 1]} />
        <Lightformer intensity={0.8} color="#ffffff" position={[-5, 0, 2]} rotation-y={Math.PI / 2} scale={[6, 6, 1]} />
        <Lightformer intensity={0.5} color="#ffd9c8" position={[5, -1, 1]} rotation-y={-Math.PI / 2} scale={[6, 4, 1]} />
      </Environment>
      <Seal stamp={stamp} />
      <ContactShadows position={[0, -1.45, -1.3]} opacity={0.55} scale={9} blur={2.6} far={3} color="#000000" />
    </Canvas>
  );
}
