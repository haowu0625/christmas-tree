import React, { useRef, useMemo, useContext, useState, useEffect } from 'react';
import { useFrame, extend, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { shaderMaterial, Text, Line } from '@react-three/drei';
import * as random from 'maath/random/dist/maath-random.esm';
import { TreeContext, ParticleData, TreeContextType } from '../types';

// --- Foliage Material ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color('#004225'), uColorAccent: new THREE.Color('#00fa9a'), uPixelRatio: 1 },
  ` uniform float uTime; uniform float uPixelRatio; attribute float size; varying vec3 vPosition; varying float vBlink; vec3 curl(float x, float y, float z) { float eps=1.,n1,n2,a,b;x/=eps;y/=eps;z/=eps;vec3 curl=vec3(0.);n1=sin(y+cos(z+uTime));n2=cos(x+sin(z+uTime));curl.x=n1-n2;n1=sin(z+cos(x+uTime));n2=cos(y+sin(x+uTime));curl.z=n1-n2;n1=sin(x+cos(y+uTime));n2=cos(z+sin(y+uTime));curl.z=n1-n2;return curl*0.1; } void main() { vPosition=position; vec3 distortedPosition=position+curl(position.x,position.y,position.z); vec4 mvPosition=modelViewMatrix*vec4(distortedPosition,1.0); gl_Position=projectionMatrix*mvPosition; gl_PointSize=size*uPixelRatio*(60.0/-mvPosition.z); vBlink=sin(uTime*2.0+position.y*5.0+position.x); } `,
  ` uniform vec3 uColor; uniform vec3 uColorAccent; varying float vBlink; void main() { vec2 xy=gl_PointCoord.xy-vec2(0.5); float ll=length(xy); if(ll>0.5) discard; float strength=pow(1.0-ll*2.0,3.0); vec3 color=mix(uColor,uColorAccent,smoothstep(-0.8,0.8,vBlink)); gl_FragColor=vec4(color,strength); } `
);
extend({ FoliageMaterial });

// --- Shimmer Material ---
const ShimmerMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color('#ffffff') },
  ` varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); } `,
  ` uniform float uTime; uniform vec3 uColor; varying vec2 vUv; void main() { float pos = mod(uTime * 0.8, 2.5) - 0.5; float bar = smoothstep(0.0, 0.2, 0.2 - abs(vUv.x + vUv.y * 0.5 - pos)); float alpha = bar * 0.05; gl_FragColor = vec4(uColor, alpha); } `
);
extend({ ShimmerMaterial });

// --- Photo Component ---
const PolaroidPhoto: React.FC<{ url: string; position: THREE.Vector3; rotation: THREE.Euler; scale: number; id: string; shouldLoad: boolean; year: number }> = ({ url, position, rotation, scale, id, shouldLoad, year }) => {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [loadStatus, setLoadStatus] = useState<'pending' | 'loading' | 'local' | 'fallback'>('pending');

  useEffect(() => {
    if (!shouldLoad || loadStatus !== 'pending') return;
    setLoadStatus('loading');
    const loader = new THREE.TextureLoader();

    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        setTexture(tex);
        setLoadStatus('local');
      },
      undefined,
      () => {
        // 加载失败时使用随机图
        const seed = id.split('-')[1] || '55';
        const fallbackUrl = `https://picsum.photos/seed/${parseInt(seed) + 100}/400/500`;
        loader.load(fallbackUrl, (fbTex) => {
          fbTex.colorSpace = THREE.SRGBColorSpace;
          setTexture(fbTex);
          setLoadStatus('fallback');
        });
      }
    );
  }, [url, id, shouldLoad, loadStatus]);

  return (
    <group position={position} rotation={rotation} scale={scale * 1.2}>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1, 1.25, 0.02]} />
        <meshStandardMaterial color="#ffffff" roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.15, 0.015]}>
        <planeGeometry args={[0.9, 0.9]} />
        {texture ? <meshStandardMaterial map={texture} /> : <meshStandardMaterial color="#333" />}
      </mesh>
      <mesh position={[0, 0.15, 0.02]} scale={[0.9, 0.9, 1]}>
        <planeGeometry args={[1, 1]} />
        <shimmerMaterial transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
};

// --- Main Tree System ---
const TreeSystem: React.FC = () => {
  const { state, rotationSpeed, rotationBoost, pointer, setSelectedPhotoUrl, selectedPhotoUrl, panOffset, clickTrigger } = useContext(TreeContext) as TreeContextType;
  const { camera } = useThree();
  const pointsRef = useRef<THREE.Points>(null);
  const lightsRef = useRef<THREE.InstancedMesh>(null);
  const trunkRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  const progress = useRef(0);
  const treeRotation = useRef(0);
  const currentPan = useRef({ x: 0, y: 0 });
  const [loadedCount, setLoadedCount] = useState(0);
  const [photoObjects, setPhotoObjects] = useState<any[]>([]);

  const { foliageData, photosData, lightsData } = useMemo(() => {
    const particleCount = 4500;
    const foliage = new Float32Array(particleCount * 3);
    const foliageChaos = random.inSphere(new Float32Array(particleCount * 3), { radius: 18 });
    const foliageTree = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const h = Math.random() * 14;
      const coneRadius = (14 - h) * 0.45;
      const angle = h * 3.0 + Math.random() * Math.PI * 2;
      foliageTree[i3] = Math.cos(angle) * coneRadius;
      foliageTree[i3 + 1] = h - 6;
      foliageTree[i3 + 2] = Math.sin(angle) * coneRadius;
      sizes[i] = Math.random() * 1.5 + 0.5;
    }

    const lightCount = 300;
    const lightChaos = random.inSphere(new Float32Array(lightCount * 3), { radius: 20 });
    const lightTree = new Float32Array(lightCount * 3);
    for (let i = 0; i < lightCount; i++) {
      const i3 = i * 3;
      const t = i / lightCount;
      const h = t * 13;
      const coneRadius = (14 - h) * 0.48;
      const angle = t * Math.PI * 25;
      lightTree[i3] = Math.cos(angle) * coneRadius;
      lightTree[i3 + 1] = h - 6;
      lightTree[i3 + 2] = Math.sin(angle) * coneRadius;
    }

    // --- 照片逻辑：适配 1.jpg, 2.jpg ... ---
    const photoCount = 31; // 如果照片更多，请修改这个数字
    const photos: ParticleData[] = [];
    for (let i = 0; i < photoCount; i++) {
      const t = i / (photoCount - 1 || 1);
      const h = t * 14 - 7;
      const radius = (7 - (h + 7)) * 0.4 + 1.5;
      const angle = t * Math.PI * 10;

      const phi = Math.acos(1 - 2 * (i + 0.5) / photoCount);
      const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
      const r = 12 + Math.random() * 4;

      photos.push({
        id: `photo-${i}`,
        type: 'PHOTO',
        year: 2024,
        month: "12",
        chaosPos: [r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta) * 0.6, r * Math.cos(phi)],
        treePos: [Math.cos(angle) * radius, h, Math.sin(angle) * radius],
        chaosRot: [(Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.1],
        treeRot: [0, -angle + Math.PI / 2, 0],
        scale: 1.0,
        image: `/photos/${i + 1}.jpg`,
        color: 'white'
      });
    }

    return { foliageData: { current: foliage, chaos: foliageChaos, tree: foliageTree, sizes }, photosData: photos, lightsData: { chaos: lightChaos, tree: lightTree, count: lightCount } };
  }, []);

  useEffect(() => {
    setPhotoObjects(photosData.map(p => ({ id: p.id, url: p.image!, ref: React.createRef(), data: p, pos: new THREE.Vector3(), rot: new THREE.Euler(), scale: p.scale })));
  }, [photosData]);

  useEffect(() => {
    const interval = setInterval(() => {
      setLoadedCount(prev => (prev < photoObjects.length ? prev + 1 : prev));
    }, 100);
    return () => clearInterval(interval);
  }, [photoObjects.length]);

  // 处理点击照片放大逻辑
  const photoOpenTimeRef = useRef<number>(0);
  useEffect(() => {
    if (state === 'CHAOS' && pointer) {
      const ndcX = pointer.x * 2 - 1;
      const ndcY = -(pointer.y * 2) + 1;
      let closestId: string | null = null;
      let minDist = 0.15;

      photoObjects.forEach(obj => {
        if (!obj.ref.current) return;
        const worldPos = new THREE.Vector3();
        obj.ref.current.getWorldPosition(worldPos);
        const screenPos = worldPos.clone().project(camera);
        if (screenPos.z < 1) {
          const d = Math.hypot(screenPos.x - ndcX, screenPos.y - ndcY);
          if (d < minDist) { minDist = d; closestId = obj.data.image!; }
        }
      });

      if (closestId) {
        setSelectedPhotoUrl(closestId);
        photoOpenTimeRef.current = Date.now();
      } else if (selectedPhotoUrl && Date.now() - photoOpenTimeRef.current > 1000) {
        setSelectedPhotoUrl(null);
      }
    }
  }, [clickTrigger]);

  useFrame((state3d, delta) => {
    const targetProgress = state === 'FORMED' ? 1 : 0;
    progress.current = THREE.MathUtils.damp(progress.current, targetProgress, 2.0, delta);
    const ease = progress.current * progress.current * (3 - 2 * progress.current);
    treeRotation.current += (state === 'FORMED' ? (rotationSpeed + rotationBoost) : 0.05) * delta;

    if (groupRef.current) {
      currentPan.current.x = THREE.MathUtils.lerp(currentPan.current.x, panOffset.x, 0.2);
      currentPan.current.y = THREE.MathUtils.lerp(currentPan.current.y, panOffset.y, 0.2);
      groupRef.current.position.set(currentPan.current.x, currentPan.current.y, 0);
    }

    // 树叶粒子动画
    if (pointsRef.current) {
      // @ts-ignore
      pointsRef.current.material.uniforms.uTime.value = state3d.clock.getElapsedTime();
      const pos = pointsRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < pos.length / 3; i++) {
        const i3 = i * 3;
        const tx = foliageData.tree[i3]; const ty = foliageData.tree[i3+1]; const tz = foliageData.tree[i3+2];
        const cx = foliageData.chaos[i3]; const cy = foliageData.chaos[i3+1]; const cz = foliageData.chaos[i3+2];
        pos[i3] = THREE.MathUtils.lerp(cx, tx, ease);
        pos[i3+1] = THREE.MathUtils.lerp(cy, ty, ease);
        pos[i3+2] = THREE.MathUtils.lerp(cz, tz, ease);
      }
      pointsRef.current.geometry.attributes.position.needsUpdate = true;
    }

    // 照片位置和旋转动画
    photoObjects.forEach((obj) => {
      if (!obj.ref.current) return;
      const { chaosPos, treePos, chaosRot, treeRot } = obj.data;
      const tAngle = Math.atan2(treePos[2], treePos[0]);
      const currentAngle = tAngle + (1 - ease) * 10.0 + treeRotation.current;
      const r = THREE.MathUtils.lerp(Math.hypot(chaosPos[0], chaosPos[2]), Math.hypot(treePos[0], treePos[2]), ease);
      
      obj.ref.current.position.set(
        THREE.MathUtils.lerp(chaosPos[0], r * Math.cos(currentAngle), ease),
        THREE.MathUtils.lerp(chaosPos[1], treePos[1], ease),
        THREE.MathUtils.lerp(chaosPos[2], r * Math.sin(currentAngle), ease)
      );
      obj.ref.current.rotation.y = THREE.MathUtils.lerp(chaosRot[1], -currentAngle + Math.PI / 2, ease);
    });
  });

  return (
    <group ref={groupRef}>
      <mesh ref={trunkRef} position={[0, 1, 0]}>
        <cylinderGeometry args={[0.2, 0.8, 14, 8]} />
        <meshStandardMaterial color="#3E2723" />
      </mesh>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={foliageData.current.length / 3} array={foliageData.current} itemSize={3} />
          <bufferAttribute attach="attributes-size" count={foliageData.sizes.length} array={foliageData.sizes} itemSize={1} />
        </bufferGeometry>
        <foliageMaterial transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <instancedMesh ref={lightsRef} args={[undefined, undefined, lightsData.count]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color="#ffddaa" emissive="#ffbb00" emissiveIntensity={3} />
      </instancedMesh>
      {photoObjects.map((obj, index) => (
        <group key={obj.id} ref={(el) => { obj.ref.current = el; }}>
          <PolaroidPhoto url={obj.url} position={obj.pos} rotation={obj.rot} scale={obj.scale} id={obj.id} shouldLoad={index < loadedCount} year={obj.data.year} />
        </group>
      ))}
    </group>
  );
};

export default TreeSystem;
