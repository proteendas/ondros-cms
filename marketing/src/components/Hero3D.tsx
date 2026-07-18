'use client';

/** Hero 3D scene (spec 010): an abstract take on the Ondros mark — a core
 * sphere orbited by a tilted ring and a satellite dot, slowly rotating and
 * floating. Kept deliberately light for mobile GPUs: low-poly primitives,
 * no shadows, dpr capped, frameloop stays on "always" only because the
 * motion IS the point (the gate below unmounts it entirely for
 * prefers-reduced-motion / missing WebGL).
 *
 * This module is loaded via next/dynamic({ ssr: false }) from the landing
 * page, so three.js never enters the server bundle or blocks first paint. */
import { Float } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import type { Group } from 'three';

function OrbitalMark() {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (group.current) {
      group.current.rotation.y += delta * 0.25;
      group.current.rotation.x += delta * 0.05;
    }
  });

  return (
    <Float speed={1.4} rotationIntensity={0.4} floatIntensity={0.9}>
      <group ref={group}>
        {/* Core sphere — brand indigo */}
        <mesh>
          <icosahedronGeometry args={[1.05, 3]} />
          <meshStandardMaterial color="#6366f1" roughness={0.25} metalness={0.55} />
        </mesh>
        {/* Orbital ring — echoes the logo's "O" */}
        <mesh rotation={[Math.PI / 2.6, 0, 0.4]}>
          <torusGeometry args={[1.85, 0.07, 16, 96]} />
          <meshStandardMaterial color="#a855f7" roughness={0.3} metalness={0.6} />
        </mesh>
        {/* Satellite dot — the offset dot in the logo mark */}
        <mesh position={[1.85 * Math.cos(0.9), 0.62, 1.85 * Math.sin(0.9)]}>
          <sphereGeometry args={[0.16, 24, 24]} />
          <meshStandardMaterial color="#c7d2fe" emissive="#818cf8" emissiveIntensity={0.6} />
        </mesh>
      </group>
    </Float>
  );
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Mounts the canvas only on capable, motion-friendly clients. Returning
 * null keeps the static logo fallback (rendered by the parent) in place. */
export default function Hero3D() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced && webglAvailable()) setEnabled(true);
  }, []);

  if (!enabled) return null;

  return (
    <Canvas
      className="hero-canvas"
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 5.2], fov: 42 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 5, 6]} intensity={1.1} />
      <pointLight position={[-5, -3, -4]} intensity={0.5} color="#a855f7" />
      <OrbitalMark />
    </Canvas>
  );
}
