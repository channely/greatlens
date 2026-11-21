import React, { Suspense, useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';

// 把 DSL controls 应用到 clone 后的材质，避免污染 glTF 共享材质。
function applyControls(group, controls = {}) {
  group.traverse(obj => {
    if (!obj.isMesh) return;
    const cloneMat = m => {
      if (!m) return m;
      const c = m.clone();
      if (c.color && controls.color) c.color = new THREE.Color(controls.color);
      if (c.emissive && (controls.emissive || controls.color)) c.emissive = new THREE.Color(controls.emissive || controls.color).multiplyScalar(0.15);
      if (controls.emissiveIntensity != null && 'emissiveIntensity' in c) c.emissiveIntensity = controls.emissiveIntensity;
      return c;
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(cloneMat) : cloneMat(obj.material);
    obj.castShadow = true;
  });
}

// 纯 GLB 角色：无条件调用 useGLTF（满足 hooks 规则），加载失败由 ErrorBoundary 兜底。
function GlbModel({ url, controls }) {
  const gltf = useGLTF(url);
  const object = useMemo(() => {
    const g = gltf.scene.clone(true);
    applyControls(g, controls);
    return g;
  }, [gltf, JSON.stringify(controls)]);
  return <primitive object={object} />;
}

// 几何回退角色：无 GLB 或加载失败时用参数化椭球。
function FallbackModel({ controls, name }) {
  const color = controls?.color || '#8b5cf6';
  return (
    <mesh castShadow>
      <sphereGeometry args={[0.7, 24, 18]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.18} roughness={0.5} />
    </mesh>
  );
}

class ModelBoundary extends React.Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e) { console.warn('[virtual] GLB 加载失败，使用几何回退：', e?.message); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

// 角色：优先 GLB，加载失败回退几何体。
function CharacterActor({ node }) {
  const ref = useRef();
  const url = node.assetUrl;
  const hasGlb = url && /\.(glb|gltf)(\?|$)/i.test(url);
  const pos = node.transform?.position || [0, 0, 0];
  const scale = node.controls?.scale ?? node.transform?.scale ?? 1;
  const color = node.controls?.color || '#8b5cf6';

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.position.y = (node.transform?.position?.[1] ?? 0) + Math.sin(t * 1.4) * 0.03;
    if (node.controls?.rotationY != null) ref.current.rotation.y = node.controls.rotationY;
  });

  return (
    <group ref={ref} position={pos} scale={scale} visible={node.controls?.visible !== false}>
      <ModelBoundary fallback={<FallbackModel controls={node.controls} name={node.name} />}>
        <Suspense fallback={<FallbackModel controls={node.controls} name={node.name} />}>
          {hasGlb ? <GlbModel url={url} controls={node.controls} /> : <FallbackModel controls={node.controls} name={node.name} />}
        </Suspense>
      </ModelBoundary>
      <Html position={[0, 1.1, 0]} center distanceFactor={8} style={{ pointerEvents: 'none' }}>
        <div className="vp-actor-label">{node.name || node.id}</div>
      </Html>
    </group>
  );
}

// 道具（GLB）。
function PropActor({ node }) {
  const hasGlb = node.assetUrl && /\.(glb|gltf)(\?|$)/i.test(node.assetUrl);
  const scale = node.controls?.scale ?? 1;
  return (
    <group position={node.transform?.position || [0, 0, 0]} scale={scale}>
      <ModelBoundary fallback={<mesh><boxGeometry args={[0.5, 0.5, 0.5]} /><meshStandardMaterial color="#4a6d47" /></mesh>}>
        <Suspense fallback={null}>
          {hasGlb ? <GlbModel url={node.assetUrl} controls={node.controls} /> : <mesh><boxGeometry args={[0.5, 0.5, 0.5]} /><meshStandardMaterial color="#4a6d47" /></mesh>}
        </Suspense>
      </ModelBoundary>
    </group>
  );
}

// 背景：静态图（世界模型延迟）→ 平面贴图；无图则深色幕布。
function EnvironmentBackdrop({ node }) {
  const url = node?.assetRef;
  const texture = React.useMemo(() => {
    if (!url || !/\.(png|jpe?g|webp)(\?|$)/i.test(url)) return null;
    try { return new THREE.TextureLoader().load(url); } catch { return null; }
  }, [url]);
  return (
    <group>
      <mesh position={[0, 0, -4]}>
        <planeGeometry args={[30, 16]} />
        {texture ? <meshBasicMaterial map={texture} /> : <meshBasicMaterial color="#0d1a14" />}
      </mesh>
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 8, 6]} intensity={1.1} castShadow />
      <pointLight position={[-4, 2, 3]} intensity={0.5} color="#22c55e" />
      <gridHelper args={[20, 20, '#1f3a2c', '#152b20']} position={[0, -1.2, 0]} />
    </group>
  );
}

// 相机架：按当前镜头参数设定位置与 lookAt，motion 用平滑插值。
function ShotCameraRig({ shot }) {
  const { camera } = useThree();
  const lookTarget = useRef(new THREE.Vector3(0, 0.4, 0));
  const cam = shot?.camera;
  useEffect(() => {
    if (!cam) return;
    if (cam.fov && camera.isPerspectiveCamera) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  }, [cam?.fov, camera]);
  useFrame(({ clock }) => {
    if (!cam?.position) return;
    const p = cam.position;
    let [x, y, z] = p;
    const m = cam.motion;
    if (m && m.type !== 'static' && m.to && m.durationSec) {
      const phase = (clock.getElapsedTime() % m.durationSec) / m.durationSec;
      const ease = phase * phase * (3 - 2 * phase);
      x = p[0] + (m.to[0] - p[0]) * ease;
      y = p[1] + (m.to[1] - p[1]) * ease;
      z = p[2] + (m.to[2] - p[2]) * ease;
    }
    camera.position.set(x, y, z);
    const target = cam.lookAt || [0, 0.4, 0];
    lookTarget.current.set(target[0], target[1], target[2]);
    camera.lookAt(lookTarget.current);
  });
  return null;
}

function Scene({ compiled, selectedShot }) {
  const nodes = compiled?.sceneGraph?.nodes || [];
  const env = nodes.find(n => n.kind === 'environment');
  const chars = nodes.filter(n => n.kind === 'character');
  const props = nodes.filter(n => n.kind === 'prop');
  return (
    <>
      <color attach="background" args={['#0d1a14']} />
      <EnvironmentBackdrop node={env} />
      {props.map(n => <PropActor key={n.id} node={n} />)}
      {chars.map(n => <CharacterActor key={n.id} node={n} />)}
      <ShotCameraRig shot={selectedShot} />
      <OrbitControls makeDefault enablePan enableZoom enableRotate target={[0, 0.4, 0]} />
    </>
  );
}

export default function VirtualCanvas({ compiled, playhead, selectedShot }) {
  const onCreated = state => { window.__glVirtualCanvas = state.gl.domElement; };
  return (
    <div className="vp-canvas-wrap">
      <Canvas shadows camera={{ position: [0, 1.6, 5], fov: 45 }} dpr={[1, 1.5]} onCreated={onCreated}>
        <Suspense fallback={null}>
          <Scene compiled={compiled} selectedShot={selectedShot} />
        </Suspense>
      </Canvas>
      <div className="vp-canvas-hint">拖拽旋转 · 滚轮缩放 · 右键平移</div>
      {selectedShot && <div className="vp-canvas-shot">镜头 {selectedShot.id} · {selectedShot.durationSec}s</div>}
    </div>
  );
}
