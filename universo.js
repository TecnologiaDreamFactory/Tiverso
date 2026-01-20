// Dynamic imports will be used inside initUniverse function

/*
 * Este projeto utiliza Three.js para renderização 3D
 * Three.js - https://threejs.org/
 * Copyright (c) 2010-2024 Three.js Authors
 * Licença: MIT - https://github.com/mrdoob/three.js/blob/master/LICENSE
 */

/* PATCH MOBILE (Chrome Android)*/
const isChromeAndroid = /Chrome/i.test(navigator.userAgent) && /Android/i.test(navigator.userAgent);

// Variáveis globais para rewind
let rewindStartTime = null;
const rewindDuration = 3500; // Aumentado para 3.5s para animação mais suave no desktop
let isRewinding = false;
let rewindData = [];
let appStartTime = null; // Tempo de início da aplicação

// Constantes reutilizáveis para otimização
const MOBILE_SCALE_SMALL = 0.55;
const MOBILE_SCALE_MEDIUM = 0.7;
const MOBILE_PLANET_BOOST = 1.74;
const MOBILE_GLTF_BOOST = 1.5;
const MOBILE_PENDING_BOOST = 1.3;


// Initialize Three.js universe on demand
async function initUniverse() {
  // Dynamic imports for Three.js
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  
  // Inicializa constante reutilizável (acessível globalmente dentro do escopo)
  const VECTOR3_ONE_INSTANCE = new THREE.Vector3(1, 1, 1);
  
  // Função helper para calcular largura segura (cacheada)
  function getSafeWidth() {
    return Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0) || 768;
  }
  
  // Função helper para calcular mobile scale atual
  function getCurrentMobileScale() {
    const safeWidth = getSafeWidth();
    return safeWidth < 480 ? MOBILE_SCALE_SMALL : MOBILE_SCALE_MEDIUM;
  }
  
  // Função helper para projeção 3D → coordenadas de tela
  function projectToScreen(vec, camera) {
    vec.project(camera);
    return {
      x: (vec.x * 0.5 + 0.5) * window.innerWidth,
      y: (-(vec.y) * 0.5 + 0.5) * window.innerHeight
    };
  }

  /* Utils: sprite circular (estrelas/partículas) + cor média*/
  function createCircleSprite(color = '#ffffff', size = 64) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size/2, size/2, size*0.05, size/2, size/2, size/2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.6, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

  // Sprite circular mínimo e eficiente para pontos do loading
  function createDotSprite(size = 16) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const center = size / 2;
    const radius = center - 1;
    
    // Cria um círculo suave com bordas antialiased (branco, cor será aplicada via vertexColors)
    const grad = ctx.createRadialGradient(center, center, 0, center, center, radius);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fill();
    
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

// (mantido para uso futuro)
function computeTextureAvgColor(texture) {
  try {
    const img = texture.image;
    if (!img) return new THREE.Color(0xffffff);
    const w = Math.min(64, img.width || 64);
    const h = Math.min(64, img.height || 64);
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let r=0, g=0, b=0, count=0;
    for (let i=0; i<data.length; i+=4) {
      r += data[i]; g += data[i+1]; b += data[i+2]; count++;
    }
    r = (r / count) | 0; g = (g / count) | 0; b = (b / count) | 0;
    return new THREE.Color(r/255, g/255, b/255);
  } catch {
    return new THREE.Color(0xffffff);
  }
}

/* Loading: Star Tunnel (hiperespaço) com fade*/
const loadingDiv = document.getElementById('loading');
const loadingScene = new THREE.Scene();
const loadingCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1600);
loadingCamera.position.z = 5;

//Antialias ligado no desktop; desligado no mobile p/ estabilidade
const loadingRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: !isChromeAndroid });
loadingRenderer.setSize(window.innerWidth, window.innerHeight);
loadingDiv.appendChild(loadingRenderer.domElement);

// Sprite branco reutilizável (também usado no starfield principal)
const spriteWhite = createCircleSprite('#ffffff', 64);
// Sprite de ponto circular para loading (pequeno e eficiente)
// Usamos sprite branco e aplicamos cores via vertexColors para melhor performance
const dotSpriteWhite = createDotSprite(16);

// Parâmetros do túnel
const STAR_COUNT   = isChromeAndroid ? 800 : 2000;
const TUNNEL_MIN_R = 2.0;
const TUNNEL_MAX_R = 10.0;
const TUNNEL_DEPTH = 420;
const HYPER_SPEED  = 3.2;
const SPIRAL_SPEED = 0.002;

const starPositions = new Float32Array(STAR_COUNT * 3);
const starSpeedScale = new Float32Array(STAR_COUNT);
const starColors = new Float32Array(STAR_COUNT * 3); // RGB para cada estrela

// Distribuição cilíndrica com leve viés para bordas
for (let i = 0; i < STAR_COUNT; i++) {
  const r = Math.sqrt(Math.random()) * (TUNNEL_MAX_R - TUNNEL_MIN_R) + TUNNEL_MIN_R;
  const a = Math.random() * Math.PI * 2;
  const z = -Math.random() * TUNNEL_DEPTH - 5;
  starPositions[i*3]     = Math.cos(a) * r;
  starPositions[i*3 + 1] = Math.sin(a) * r;
  starPositions[i*3 + 2] = z;
  starSpeedScale[i] = 0.7 + Math.random() * 0.6;
  
  // Distribui cores: 60% branco, 20% azul, 20% roxo
  const rand = Math.random();
  if (rand < 0.6) {
    // Branco
    starColors[i*3] = 1.0;
    starColors[i*3 + 1] = 1.0;
    starColors[i*3 + 2] = 1.0;
  } else if (rand < 0.8) {
    // Azul
    starColors[i*3] = 0.2;
    starColors[i*3 + 1] = 0.6;
    starColors[i*3 + 2] = 1.0;
  } else {
    // Roxo
    starColors[i*3] = 0.8;
    starColors[i*3 + 1] = 0.2;
    starColors[i*3 + 2] = 1.0;
  }
}

const loadingGeom = new THREE.BufferGeometry();
loadingGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
loadingGeom.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

const loadingMat = new THREE.PointsMaterial({
  size: 0.12,
  map: dotSpriteWhite, // Usa sprite branco como base, cor vem do atributo
  vertexColors: true, // Habilita cores por vértice
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  sizeAttenuation: true
});

const starTunnel = new THREE.Points(loadingGeom, loadingMat);
loadingScene.add(starTunnel);

// Animação do túnel
let spiralAngle = 0;
(function animateLoading() {
  requestAnimationFrame(animateLoading);
  const arr = loadingGeom.attributes.position.array;

  for (let i = 0; i < STAR_COUNT; i++) {
    const idxZ = i * 3 + 2;
    arr[idxZ] += HYPER_SPEED * starSpeedScale[i];
    if (arr[idxZ] > 8) {
      arr[idxZ] = -TUNNEL_DEPTH - Math.random() * 120;
      const r = Math.sqrt(Math.random()) * (TUNNEL_MAX_R - TUNNEL_MIN_R) + TUNNEL_MIN_R;
      const a = Math.random() * Math.PI * 2;
      arr[i*3]     = Math.cos(a) * r;
      arr[i*3 + 1] = Math.sin(a) * r;
      starSpeedScale[i] = 0.7 + Math.random() * 0.6;
    }
  }

  spiralAngle += SPIRAL_SPEED;
  starTunnel.rotation.z = spiralAngle;

  loadingGeom.attributes.position.needsUpdate = true;
  loadingRenderer.render(loadingScene, loadingCamera);
})();

// Resize do loading
window.addEventListener('resize', () => {
  loadingCamera.aspect = window.innerWidth / window.innerHeight;
  loadingCamera.updateProjectionMatrix();
  loadingRenderer.setSize(window.innerWidth, window.innerHeight);
}, { passive: true });

/*Fade compartilhado com a cena principal*/
let meshLoaded = false;
let meshLoadedAt = 0;
const fadeDelayAfterLoad = 3000;   // aguarda 3s após o GLTF carregar
const loadingFadeDuration = 2000;  // duração do fade do overlay
let fadeStarted = false;
let fadeStartTime = 0;

function startLoadingFade() {
  if (fadeStarted) return;
  fadeStarted = true;
  fadeStartTime = performance.now();
  loadingDiv.style.transition = `opacity ${loadingFadeDuration}ms ease`;
  loadingDiv.style.opacity = '0';
  
  // Mostra o footer junto com o fade
  const footer = document.querySelector('footer');
  if (footer) {
    setTimeout(() => {
      footer.classList.add('show');
    }, 500); // delay de 500ms para sincronizar com o fade
  }
  
  setTimeout(() => {
    if (loadingDiv.parentNode) loadingDiv.remove();
  }, loadingFadeDuration + 50);
}

// Fallback: some após 10s mesmo se GLTF demorar
setTimeout(() => {
  if (!meshLoaded && !fadeStarted) startLoadingFade();
}, 10000);

/* Cena principal e texturas*/
const scene = new THREE.Scene();
const textureLoader = new THREE.TextureLoader();

// Texturas dos planetas (6 originais + 1 novo com planet6.webp)
const planetTextures = [
  'IMGS/planet1.webp',
  'IMGS/planet2.webp',
  'IMGS/planet3.webp',
  'IMGS/planet4.webp',
  'IMGS/planet5.webp',
  'IMGS/planet7.webp', 
  'IMGS/planet6.webp'  
];

// Nomes dos planetas
const planetNames = [
  'Chamados',
  'Segurança',
  'Boas Praticas',
  'Equipamentos',
  'Acesso ao Escritório',
  'Novidades',
  'Biblioteca de Recursos' 
];

const planets = [];
const createdSizes = [];

// Fator de tamanho no desktop (aumento de 5%)
const DESKTOP_SIZE_FACTOR = 1.05; // Aumenta 5% no desktop

/*Criação dos 5 primeiros planetas com variação de tamanho FIXA*/
// Variações fixas determinísticas para garantir tamanhos consistentes entre carregamentos
const sizeVariations = [0.1, 0.3, 0.2, 0.4, 0.5]; // valores fixos para cada planeta
for (let i = 0; i < 5; i++) {
  const scale = [0.9, 0.75, 0.85, 0.95, 1][i];
  // Tamanho fixo baseado no índice para garantir consistência entre carregamentos
  let size = (0.45 + sizeVariations[i]) * scale;
  // Aplica aumento de 10% no desktop
  const isMobile = window.innerWidth <= 768;
  if (!isMobile) {
    size = size * DESKTOP_SIZE_FACTOR;
  }
  createdSizes.push(size);

  const geom = new THREE.SphereGeometry(size, 32, 32);
  const tex = textureLoader.load(planetTextures[i]);
  const mat = new THREE.MeshPhongMaterial({ map: tex, shininess: 20 });
  const planet = new THREE.Mesh(geom, mat);

  planet.userData.index = i + 1;
  // Distribui ângulos de forma uniforme no desktop para órbita mais organizada
  const isMobileForOrbit = window.innerWidth <= 768;
  planet.userData.angle = isMobileForOrbit ? (Math.random() * Math.PI * 2) : ((i / 5) * Math.PI * 2);
  // Velocidade reduzida no desktop (redução de 30%)
  const isMobileForSpeed = window.innerWidth <= 768;
  const speedBase = 0.001 + i * 0.0008;
  planet.userData.baseSpeed = isMobileForSpeed ? speedBase : speedBase * 0.7;
  planet.userData.speed = planet.userData.baseSpeed;
  // Salva originalScale como (1,1,1) para garantir consistência - o tamanho vem da geometria
  planet.userData.originalScale = VECTOR3_ONE_INSTANCE.clone();
  // Para comportamento de enxame (desktop) - reduzido para órbita mais organizada
  planet.userData.minDistance = size * 2.5; // distância mínima entre planetas (2.5x o tamanho)
  planet.userData.radiusOffset = 0; // offset dinâmico para evitar colisões

  // Órbitas mais organizadas no desktop: raios mais uniformes e espaçados
  const baseDist = isMobileForOrbit ? (8 + i * 2) : (7 + i * 1.8);
  const adjustedRadius = baseDist * 0.5;
  
  planet.userData.radius = adjustedRadius;
  planet.userData.originalRadius = adjustedRadius;
  planet.position.set(
    Math.cos(planet.userData.angle) * adjustedRadius,
    Math.sin(planet.userData.angle) * adjustedRadius,
    0
  );

  scene.add(planet);
  planets.push(planet);
}

/* 6º planeta – Novidades (tamanho médio, com anel)*/
let avgSize = createdSizes.reduce((a, b) => a + b, 0) / createdSizes.length;
// Aplica aumento de 10% no desktop
const isMobileForPlanets = window.innerWidth <= 768;
if (!isMobileForPlanets) {
  avgSize = avgSize * DESKTOP_SIZE_FACTOR;
}
{
  const i = 5;
  const geom = new THREE.SphereGeometry(avgSize, 32, 32);
  const tex = textureLoader.load(planetTextures[i]);
  const mat = new THREE.MeshPhongMaterial({ map: tex, shininess: 20 });
  const p6 = new THREE.Mesh(geom, mat);

  p6.userData.index = i + 1; // 6
  // Distribui ângulo de forma uniforme no desktop
  const isMobileForOrbit6 = window.innerWidth <= 768;
  p6.userData.angle = isMobileForOrbit6 ? (Math.random() * Math.PI * 2) : ((i / 7) * Math.PI * 2);
  // Velocidade reduzida no desktop (redução de 30%)
  const isMobileForSpeed6 = window.innerWidth <= 768;
  const speedBase6 = 0.0029;
  p6.userData.baseSpeed = isMobileForSpeed6 ? speedBase6 : speedBase6 * 0.7;
  p6.userData.speed = p6.userData.baseSpeed;
  // Salva originalScale como (1,1,1) para garantir consistência
  p6.userData.originalScale = VECTOR3_ONE_INSTANCE.clone();
  // Para comportamento de enxame (desktop) - reduzido para órbita mais organizada
  p6.userData.minDistance = avgSize * 2.5; // distância mínima entre planetas
  p6.userData.radiusOffset = 0; // offset dinâmico para evitar colisões

  // Órbitas mais organizadas no desktop: raios mais uniformes e espaçados
  // No desktop, planeta 6 (Saturno/Novidades) tem a órbita mais distante para evitar colisões
  let baseDist;
  if (isMobileForOrbit6) {
    baseDist = 8 + i * 2;
  } else {
    // No desktop: planeta 6 fica na posição mais externa (índice 5 de 7 planetas)
    // Calcula raio maior para o planeta 6
    baseDist = (7 + 6 * 1.8) + 2.0; // Raio maior que todos os outros
  }
  const adjustedRadius = baseDist * 0.5;
  
  p6.userData.radius = adjustedRadius;
  p6.userData.originalRadius = adjustedRadius;
  p6.position.set(
    Math.cos(p6.userData.angle) * adjustedRadius,
    Math.sin(p6.userData.angle) * adjustedRadius,
    0
  );

  // Anel no Novidades
  const ringGeo = new THREE.RingGeometry(avgSize * 1.1, avgSize * 1.6, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  p6.add(ring);

  scene.add(p6);
  planets.push(p6);
}

/* 7º planeta – Biblioteca de Recursos (mesmo comportamento dos demais */
{
  const i = 6; // sétimo
  let size = avgSize; // usa o mesmo médio pra consistência
  // O aumento de 10% já foi aplicado no avgSize, então mantém
  const geom = new THREE.SphereGeometry(size, 32, 32);
  const tex = textureLoader.load(planetTextures[i]); // IMGS/planet6.webp
  const mat = new THREE.MeshPhongMaterial({ map: tex, shininess: 20 });
  const p7 = new THREE.Mesh(geom, mat);

  p7.userData.index = i + 1; // 7
  // Distribui ângulo de forma uniforme no desktop
  const isMobileForOrbit7 = window.innerWidth <= 768;
  p7.userData.angle = isMobileForOrbit7 ? (Math.random() * Math.PI * 2) : ((i / 7) * Math.PI * 2);
  // Velocidade reduzida no desktop (redução de 30%)
  const isMobileForSpeed7 = window.innerWidth <= 768;
  const speedBase7 = 0.0018;
  p7.userData.baseSpeed = isMobileForSpeed7 ? speedBase7 : speedBase7 * 0.7;
  p7.userData.speed = p7.userData.baseSpeed;
  // Salva originalScale como (1,1,1) para garantir consistência
  p7.userData.originalScale = VECTOR3_ONE_INSTANCE.clone();
  // Para comportamento de enxame (desktop) - reduzido para órbita mais organizada
  p7.userData.minDistance = size * 2.5; // distância mínima entre planetas
  p7.userData.radiusOffset = 0; // offset dinâmico para evitar colisões

  // Órbitas mais organizadas no desktop: raios mais uniformes e espaçados
  // No desktop, planeta 7 fica antes do planeta 6 (que é o mais distante)
  let baseDist;
  if (isMobileForOrbit7) {
    baseDist = 8 + i * 2;
  } else {
    // No desktop: planeta 7 fica antes do planeta 6 (que é o mais distante)
    baseDist = 7 + (i - 1) * 1.8; // Usa índice ajustado para ficar antes do planeta 6
  }
  const adjustedRadius = baseDist * 0.5;
  
  p7.userData.radius = adjustedRadius;
  p7.userData.originalRadius = adjustedRadius;
  p7.position.set(
    Math.cos(p7.userData.angle) * adjustedRadius,
    Math.sin(p7.userData.angle) * adjustedRadius,
    0
  );

  scene.add(p7);
  planets.push(p7);
}

/* Fundo de estrelas denso (duas camadas) — mobile reduzido */
function createStarField(count, range) {
  const geom = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i*3]   = (Math.random() - 0.5) * range;
    pos[i*3+1] = (Math.random() - 0.5) * range;
    pos[i*3+2] = (Math.random() - 0.5) * range;
  }
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.15,
    map: spriteWhite,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  return new THREE.Points(geom, mat);
}

// NOVOS VALORES — muito mais leves no Chrome Android
const STARFIELD_NEAR_COUNT = isChromeAndroid ? 800 : 12000;
const STARFIELD_FAR_COUNT  = isChromeAndroid ? 500 : 10000;

const starFieldNear = createStarField(STARFIELD_NEAR_COUNT, 2000);
const starFieldFar  = createStarField(STARFIELD_FAR_COUNT, 8000);
starFieldFar.userData.animate = () => { starFieldFar.rotation.y += 0.0001; };

scene.add(starFieldNear);
scene.add(starFieldFar);

/* Câmera / Renderer / Luz */
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 10000);
const cameraOriginalZ = 20;
camera.position.set(0, 0, cameraOriginalZ);

const renderer = new THREE.WebGLRenderer({ 
  antialias: !isChromeAndroid, // desabilita antialias no Chrome Android para melhor performance
  powerPreference: "high-performance"
});
renderer.setSize(window.innerWidth, window.innerHeight);
// Cap pixel ratio to reduce GPU load on high-DPI displays
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isChromeAndroid ? 1.0 : 1.5));
renderer.shadowMap.enabled = false; // desabilita shadows para melhor performance
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0x404040));
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 5, 5);
scene.add(light);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Inicializa rewindData após os planetas serem criados
rewindData = planets.map(() => ({ startAngle: 0, endAngle: 0 }));

// Event listener do botão reset-orbit
document.getElementById('reset-orbit').addEventListener('click', () => {
  closePanel();
  if (isMobileStackMode) {
    // Para mobile, inicia rotação aleatória seguida de retorno flutuante
    startMobileReset();
    return;
  }
  // Desktop
  // Sempre faz exatamente 2 voltas completas, sincronizado com o GLTF
  const rotations = 2; // Sempre 2 voltas completas
  
  rewindStartTime = performance.now();
  isRewinding = true;
  const baseShift = Math.random() * Math.PI * 2;
  const spacing = (Math.PI * 2) / planets.length;
  planets.forEach((p, i) => {
    rewindData[i].startAngle = p.userData.angle;
    const jitter = (Math.random() - 0.5) * (spacing * 0.2);
    // Adiciona exatamente 2 voltas completas ao ângulo final (sincronizado)
    rewindData[i].endAngle = baseShift + i * spacing + jitter + (rotations * Math.PI * 2);
  });
  
  // Desktop: GLTF não faz rewind, apenas continua girando normalmente
  // Não salva rotação para rewind no desktop
});

/* GLTF central (logo) */
const loaderGLTF = new GLTFLoader();
let mesh = null;
let meshMaterial = null;
let meshInitialRotation = null; // Armazena a rotação inicial do GLTF
let meshRewindStartRotation = null; // Armazena a rotação no início do rewind para interpolação
// GLTF: redução total de ~20.5% no desktop (7% + 5% + 10% adicional)
const DESKTOP_GLTF_REDUCTION = 0.79515; // Reduz ~20.5% no desktop (0.93 * 0.95 * 0.9)
let baseScale = 0.04;
let responsiveScaleFactor = 1;
let pendingMeshScaleFactor = null;

loaderGLTF.load('IMGS/Trestech.gltf', gltf => {
  // GLTF retorna um objeto com scene, animations, etc.
  // Usa a scene inteira como o objeto principal (pode conter grupos ou meshes)
  const gltfScene = gltf.scene;
  
  // Centraliza o objeto calculando o bounding box de toda a scene
  const box = new THREE.Box3().setFromObject(gltfScene);
  const center = box.getCenter(new THREE.Vector3());
  gltfScene.position.sub(center);
  
  // Aplica rotação inicial para posicionar como busto (deitado horizontalmente)
  // Rotaciona 90 graus no eixo X para deitar o objeto (de pé para horizontal)
  gltfScene.rotation.x = Math.PI / 2;
  // Posiciona como ponteiro de relógio apontando para 15:45 (112.5 graus)
  // 15:45 = 3 horas + 45 minutos = 90° + (45/60)*30° = 112.5°
  // Posição final ajustada para 0 graus (perfeito)
  gltfScene.rotation.y = 0;
  
  // Aplica material a todos os meshes do grupo
  // Preserva as cores originais (azul e branco) do GLTF
  const meshMaterials = [];
  
  gltfScene.traverse((child) => {
    if (child.isMesh) {
      // Processa materiais existentes ou cria novos
      if (Array.isArray(child.material)) {
        // Se for array de materiais, processa cada um
        child.material = child.material.map((oldMat, index) => {
          const newMat = new THREE.MeshPhongMaterial({ 
            shininess: 100,
            specular: 0x222222,
            transparent: true, 
            opacity: 0,
            side: THREE.DoubleSide
          });
          
          // Preserva a cor original do material se existir
          if (oldMat && oldMat.color) {
            newMat.color.copy(oldMat.color);
          } else {
            // Se não tiver cor, usa azul como padrão (realçado)
            newMat.color.setRGB(0.2, 0.6, 1.0); // Azul mais vibrante
          }
          
          // Garante que a cor seja azul ou branco (preserva valores próximos)
          const r = newMat.color.r;
          const g = newMat.color.g;
          const b = newMat.color.b;
          
          // Detecta se a cor é branca (valores altos) ou azul
          const isWhite = (r > 0.9 && g > 0.9 && b > 0.9);
          const isBlue = (b > r && b > g && b > 0.5);
          
          if (isWhite) {
            // Mantém branco
            newMat.color.setRGB(1.0, 1.0, 1.0);
          } else if (isBlue) {
            // Aplica azul realçado/vibrante
            newMat.color.setRGB(0.2, 0.6, 1.0); // Azul mais intenso e vibrante
          } else {
            // Se não for nem branco nem azul claro, aplica azul realçado por padrão
            newMat.color.setRGB(0.2, 0.6, 1.0);
          }
          
          meshMaterials.push(newMat);
          return newMat;
        });
      } else {
        // Material único
        const oldMat = child.material;
        const newMat = new THREE.MeshPhongMaterial({ 
          shininess: 100,
          specular: 0x222222,
          transparent: true, 
          opacity: 0,
          side: THREE.DoubleSide
        });
        
        // Preserva a cor original do material se existir
        if (oldMat && oldMat.color) {
          newMat.color.copy(oldMat.color);
          
          // Detecta se a cor é branca ou azul
          const r = newMat.color.r;
          const g = newMat.color.g;
          const b = newMat.color.b;
          
          const isWhite = (r > 0.9 && g > 0.9 && b > 0.9);
          const isBlue = (b > r && b > g && b > 0.5);
          
          if (isWhite) {
            newMat.color.setRGB(1.0, 1.0, 1.0);
          } else if (isBlue) {
            // Aplica azul realçado/vibrante
            newMat.color.setRGB(0.2, 0.6, 1.0); // Azul mais intenso e vibrante
          } else {
            newMat.color.setRGB(0.2, 0.6, 1.0);
          }
        } else {
          // Se não tiver cor, usa azul realçado como padrão
          newMat.color.setRGB(0.2, 0.6, 1.0); // Azul mais vibrante
        }
        
        child.material = newMat;
        meshMaterials.push(newMat);
      }
      
      // Força atualização do mesh
      child.matrixWorldNeedsUpdate = true;
    }
  });
  
  // Garante que pelo menos um material foi criado
  if (meshMaterials.length === 0) {
    // Sem materiais encontrados no GLTF (silencioso em produção)
  }
  
  // Se houver materiais, usa o primeiro como referência principal
  meshMaterial = meshMaterials.length > 0 ? meshMaterials[0] : null;
  
  // Usa a scene inteira como o objeto principal para transformações
  mesh = gltfScene;
  
  // Aplica escala
  mesh.scale.set(baseScale * 1.5, baseScale * 1.5, baseScale * 1.5);
  mesh.userData = { originalScale: mesh.scale.clone(), allMaterials: meshMaterials };
  
  // Salva a rotação inicial para reset
  meshInitialRotation = {
    x: mesh.rotation.x,
    y: mesh.rotation.y,
    z: mesh.rotation.z
  };
  
  scene.add(mesh);

  meshLoaded = true;
  meshLoadedAt = performance.now();

  if (pendingMeshScaleFactor !== null) {
    mesh.scale.copy(mesh.userData.originalScale.clone().multiplyScalar(pendingMeshScaleFactor));
    pendingMeshScaleFactor = null;
  }
  
  // Ajusta posição Y do GLTF se já estiver em modo mobile
  if (getSafeWidth() <= 768) {
    mesh.position.y = 3.5; // offset Y no mobile
  }
}, undefined, () => setTimeout(() => startLoadingFade(), 3000));

/* Base de Tooltip (DOM)*/
const tipping = document.getElementById('tipping');
let tippingFullText = '';
let tippingCurrent = '';
let tippingIndex = 0;
let tippingLastTime = 0;
const tippingSpeed = 80;

function startTipping(text) {
  if (isChromeAndroid) return;
  tippingFullText = text || '';
  tippingCurrent = '';
  tippingIndex = 0;
  tippingLastTime = performance.now();
  tipping.style.opacity = '1';
  tipping.style.transform = 'translateY(0px)';
}

function hideTipping() {
  if (isChromeAndroid) return;
  tipping.style.opacity = '0';
  tipping.style.transform = 'translateY(20px)';
}

/*Painel de conteúdo (DOM) */
const panel = document.createElement('div');
panel.className = 'planet-panel';
document.body.appendChild(panel);

const closeButton = document.createElement('button');
closeButton.textContent = 'Fechar';
panel.appendChild(closeButton);

const panelContent = document.createElement('div');
panel.appendChild(panelContent);

// Seta de scroll no mobile
const scrollArrow = document.createElement('div');
scrollArrow.id = 'mobile-scroll-arrow';
scrollArrow.innerHTML = '↓';
scrollArrow.style.cssText = `
  position: fixed;
  bottom: 20px;
  right: 20px;
  color: #0088ff;
  font-size: 24px;
  z-index: 101;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
  font-weight: bold;
  text-shadow: 0 2px 4px rgba(0,0,0,0.8);
`;
document.body.appendChild(scrollArrow);

function openPanel() { 
  panel.classList.add('open'); 
  panelOpen = true; 
  requestAnimationFrame(checkLogoHologramVisibility);
  // Atualiza controles para desabilitar interações no desktop
  updateControlsForMode();
  
  // Verifica se precisa mostrar seta de scroll (apenas no mobile)
  if (isMobileStackMode) {
    // Aguarda um frame para o painel estar completamente renderizado
    setTimeout(() => {
      checkScrollArrow();
    }, 100);
  }
}

// Event listener para scroll (removido e recriado a cada abertura)
let scrollArrowHandler = null;

function checkScrollArrow() {
  if (!isMobileStackMode) {
    scrollArrow.style.opacity = '0';
    return;
  }
  
  // Remove listener anterior se existir
  if (scrollArrowHandler) {
    panel.removeEventListener('scroll', scrollArrowHandler);
    scrollArrowHandler = null;
  }
  
  // Verifica se há scroll necessário
  const hasScroll = panel.scrollHeight > panel.clientHeight;
  
  if (hasScroll) {
    // Mostra seta se houver scroll
    scrollArrow.style.opacity = '1';
    
    // Cria novo handler para scroll
    scrollArrowHandler = () => {
      const isAtBottom = panel.scrollHeight - panel.scrollTop <= panel.clientHeight + 10;
      if (isAtBottom) {
        scrollArrow.style.opacity = '0';
      } else {
        scrollArrow.style.opacity = '1';
      }
    };
    
    // Adiciona listener para esconder seta quando rola até o final
    panel.addEventListener('scroll', scrollArrowHandler);
  } else {
    // Esconde seta se não houver scroll
    scrollArrow.style.opacity = '0';
  }
}
function closePanel() { 
  panel.classList.remove('open'); 
  panel.classList.remove('show-logo');
  panelOpen = false;
  panelContent.querySelectorAll('iframe').forEach(iframe => { iframe.src = iframe.src; });
  
  // Esconde seta ao fechar painel e remove listener
  scrollArrow.style.opacity = '0';
  if (scrollArrowHandler) {
    panel.removeEventListener('scroll', scrollArrowHandler);
    scrollArrowHandler = null;
  }
  
  // Retoma a ciranda quando o painel é fechado no mobile
  if (isMobileStackMode && mobileIntro.phase === 'idle') {
    mobileIntro.cirandaPaused = false;
  }
  
  // Atualiza controles para reabilitar interações no desktop
  updateControlsForMode();
}
closeButton.onclick = closePanel;

// Mapeamento dos DIVs HTML
const planetDivs = [
  document.getElementById('planet-1'),
  document.getElementById('planet-2'),
  document.getElementById('planet-3'),
  document.getElementById('planet-4'),
  document.getElementById('planet-5'),
  document.getElementById('planet-6'), 
  document.getElementById('planet-7')  
];

let panelOpen = false;

/* Raycaster*/
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function intersectAtClient(clientX, clientY) {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(planets);
}

function showPlanetPanelByIndex(index) {
  planetDivs.forEach(d => d && (d.style.display = 'none'));
  const div = planetDivs[index];
  if (div) {
    div.style.display = 'block';
    panelContent.innerHTML = '';
    panelContent.appendChild(div);
    openPanel();
  }
}

/* Responsividade Desktop / Mobile*/
let isMobileStackMode = false;
let isHalfStackMode = false;

let hasRunMobileIntro = false;
const mobileLineDuration = 2000; // duração aumentada para transição mais suave
const mobileCirandaDuration = 2000; // duração para começar a ciranda
const mobileResetOpenDuration = 1500; // duração aumentada para transição mais suave
const mobileResetRotateDuration = 2000; // duração da rotação no reset
const mobileResetReturnDuration = 1500; // duração do retorno no reset

// EASING otimizado para melhor performance
function appleEase(t) { 
  const clamped = Math.min(1, Math.max(0, t));
  return 0.5 - 0.5 * Math.cos(Math.PI * clamped);
}

// EASING mais suave para retorno (ease-out quartic)
function smoothEaseOut(t) {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 4);
}

// EASING extremamente suave para retorno (ease-out quintic + exponential)
function ultraSmoothEaseOut(t) {
  const clamped = Math.min(1, Math.max(0, t));
  // Combina quintic com exponential para desaceleração muito gradual
  const quintic = 1 - Math.pow(1 - clamped, 5);
  const exponential = 1 - Math.pow(2, -10 * clamped);
  return (quintic * 0.6 + exponential * 0.4); // mistura dos dois
}

// EASING suave para entrada (ease-in-out cubic)
function smoothEaseInOut(t) {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 
    ? 4 * clamped * clamped * clamped 
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

let mobileIntro = {
  active: false,
  phase: 'idle', // 'line', 'ciranda', 'idle', 'reset'
  t0: 0,
  baseAngles: [], // posições finais no círculo
  initialPositions: [], // posições iniciais dos planetas
  queuePositions: [], // posições na fila inicial
  queueDistribution: [], // distribuição aleatória (esquerda/direita) para cada planeta
  cirandaRadius: 6, // raio da ciranda
  cirandaSpeed: 0.002, // velocidade da ciranda
  cirandaAngle: 0, // ângulo atual da ciranda
  cirandaYOffset: 3.5, // offset Y para subir a ciranda no mobile (cria distância do botão)
  cirandaStartAngles: [], // ângulos salvos para o reset
  cirandaStartPositions: [], // posições reais salvos para o reset (evita tranco)
  cirandaPaused: false, // flag para pausar a ciranda quando planeta é tocado
  nameLabels: [], // elementos DOM para nomes dos planetas no mobile
  // Spinning: interação de girar os planetas
  spinning: {
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    centerX: 0,
    centerY: 0,
    currentAngle: 0,
    targetAngle: 0,
    velocity: 0, // velocidade angular para inércia
    damping: 0.92 // amortecimento da inércia
  }
};

// posição do empilhamento (x fixo, y decrescente) - MANTIDO PARA COMPATIBILIDADE
function stackPosByRank(rank) {
  const x = isHalfStackMode ? -5.8 : -4.1;
  const y = 7 - rank * 3.2;
  return new THREE.Vector3(x, y, 0);
}

// NOVO: Posicionamento em círculo ao redor do GLTF para mobile
function layoutMobileCircular() {
  const centerX = 0; // centro do GLTF
  const centerY = 3.5; // deslocado para cima para criar distância do botão
  const centerZ = 0;
  const radius = 6; // raio menor para ficar mais próximo do GLTF
  
  planets.forEach((planet, index) => {
    // Distribui os planetas uniformemente em um círculo
    const angle = (index / planets.length) * Math.PI * 2;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    const z = centerZ;
    
    planet.position.set(x, y, z);
  });
}

// EMPILHAMENTO CUSTOM (7º planeta no topo, depois Chamados…) - MANTIDO PARA COMPATIBILIDADE
function layoutMobileStack() {
  // ordem de exibição no stack (índices do array planets):
  // 6 = novo planeta (Biblioteca), 0..5 = restantes na ordem original
  const order = planets.length === 7 ? [6,0,1,2,3,4,5] : planets.map((_, i) => i);
  order.forEach((pIndex, rank) => {
    const p = planets[pIndex];
    const t = stackPosByRank(rank);
    p.position.set(t.x, t.y, t.z);
  });
}

function layoutDesktopOrbit() {
  planets.forEach(p => {
    const r = p.userData.radius;
    p.position.set(
      Math.cos(p.userData.angle) * r,
      Math.sin(p.userData.angle) * r,
      0
    );
  });
}

function startMobileIntro() {
  if (!isMobileStackMode) return;
  mobileIntro.active = true;
  mobileIntro.phase = 'line'; // começa entrando em fila
  mobileIntro.t0 = performance.now();

  // Garante que as posições dos planetas estejam atualizadas antes de salvar
  planets.forEach(p => p.updateMatrixWorld(true));
  
  // Salva posições iniciais dos planetas (onde estão agora)
  mobileIntro.initialPositions = planets.map(p => {
    const pos = p.position.clone();
    return pos;
  });

  // Distribuição aleatória: 3 na esquerda e 4 na direita, ou 4 na esquerda e 3 na direita
  const leftCount = Math.random() < 0.5 ? 3 : 4; // aleatório: 3 ou 4
  const rightCount = planets.length - leftCount; // o restante vai para o outro lado
  
  // Cria array de índices e embaralha
  const indices = planets.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  
  // Define quais planetas vão para esquerda e quais para direita
  const leftIndices = indices.slice(0, leftCount);
  const rightIndices = indices.slice(leftCount);
  
  // Cria array de distribuição (true = esquerda, false = direita)
  mobileIntro.queueDistribution = planets.map((_, i) => leftIndices.includes(i));
  
  // Posições finais da fila: distribuição aleatória entre esquerda e direita
  // Calcula espaçamento baseado na quantidade de planetas em cada lado para centralização
  const leftSpacing = leftCount === 3 ? 3.5 : 2.5; // maior espaçamento para 3 planetas
  const rightSpacing = rightCount === 3 ? 3.5 : 2.5; // maior espaçamento para 3 planetas
  
  // Offset Y adicional para subir tudo no mobile (cria distância do botão)
  const mobileYOffset = 3.5;
  
  // Calcula offset Y para centralizar verticalmente
  const leftTotalHeight = (leftCount - 1) * (leftCount === 3 ? 3.5 : 2.5);
  const rightTotalHeight = (rightCount - 1) * (rightCount === 3 ? 3.5 : 2.5);
  const leftStartY = 6 - (leftTotalHeight / 2) + mobileYOffset; // centraliza verticalmente + offset
  const rightStartY = 6 - (rightTotalHeight / 2) + mobileYOffset; // centraliza verticalmente + offset
  
  mobileIntro.queuePositions = planets.map((p, i) => {
    const isLeft = mobileIntro.queueDistribution[i];
    const sideIndex = isLeft 
      ? leftIndices.indexOf(i) 
      : rightIndices.indexOf(i);
    
    const x = isLeft ? -5 : 5; // esquerda: -5, direita: 5
    const spacing = isLeft ? leftSpacing : rightSpacing;
    const startY = isLeft ? leftStartY : rightStartY;
    const y = startY - sideIndex * spacing; // fila vertical centralizada
    return new THREE.Vector3(x, y, 0);
  });
  
  // Posições finais: círculo para a ciranda
  mobileIntro.baseAngles = planets.map((_, i) => (i / planets.length) * Math.PI * 2);
  mobileIntro.cirandaAngle = 0;
}

// Função para reset no mobile: abre, gira e volta para fila
// Labels de nomes dos planetas no mobile DESABILITADOS (poluição visual)
function createMobilePlanetLabels() {
  if (!isMobileStackMode) return;
  
  // Remove labels existentes se houver
  mobileIntro.nameLabels.forEach(label => {
    if (label && label.parentNode) {
      label.parentNode.removeChild(label);
    }
  });
  mobileIntro.nameLabels = [];
  
  // NÃO cria labels no mobile para evitar poluição visual
  // Labels desabilitados conforme solicitado
}

// Atualiza posições dos labels seguindo os planetas
function updateMobilePlanetLabels() {
  if (!isMobileStackMode || !mobileIntro.nameLabels || mobileIntro.nameLabels.length === 0) return;
  
  planets.forEach((planet, index) => {
    const label = mobileIntro.nameLabels[index];
    if (!label) return;
    
    // Projeta posição 3D do planeta para coordenadas de tela
    planet.updateMatrixWorld(true); // Garante matriz atualizada
    const vec = new THREE.Vector3().setFromMatrixPosition(planet.matrixWorld);
    const screenPos = projectToScreen(vec, camera);
    const px = screenPos.x;
    const py = screenPos.y;
    
    // Posiciona label abaixo do planeta (offset Y positivo)
    // Usa left e top fixos, transform apenas para scale e centralização
    // Sempre usa translateX(-50%) para centralizar horizontalmente
    const zoomScale = planet.userData.zoomScale || 1;
    label.style.left = `${px}px`;
    label.style.top = `${py + 40}px`; // 40px abaixo do planeta
    label.style.transform = `translateX(-50%) translateY(0) scale(${zoomScale})`;
    label.style.transformOrigin = 'center center';
  });
}

function startMobileReset() {
  if (!isMobileStackMode) return;
  mobileIntro.active = true;
  mobileIntro.phase = 'reset'; // fase de reset
  mobileIntro.t0 = performance.now();
  
  // Limpa posições finais da rotação anterior (se existirem)
  mobileIntro.rotateEndPositions = [];
  
  // Salva a rotação atual do GLTF para interpolação suave no mobile (não reseta ainda)
  // Garante que o GLTF dará exatamente 2 voltas completas no eixo Z, sincronizado com os planetas
  if (mesh && meshInitialRotation) {
    meshRewindStartRotation = {
      x: mesh.rotation.x,
      y: mesh.rotation.y,
      z: mesh.rotation.z
    };
  }
  
  // Garante que as posições dos planetas estejam atualizadas antes de salvar
  planets.forEach(p => p.updateMatrixWorld(true));
  
  // Salva posições atuais reais dos planetas (não apenas ângulos)
  mobileIntro.cirandaStartPositions = planets.map((p, i) => {
    return p.position.clone(); // salva posição atual real
  });
  
  // Salva ângulos atuais dos planetas na ciranda (ajustado para offset Y)
  const yOffset = mobileIntro.cirandaYOffset || 3.5;
  mobileIntro.cirandaStartAngles = planets.map((p, i) => {
    const pos = p.position;
    // Ajusta o ângulo considerando o offset Y
    const adjustedY = pos.y - yOffset;
    return Math.atan2(adjustedY, pos.x); // ângulo atual ajustado
  });
  
  // Cria nova distribuição aleatória para o reset (3 e 4, ou 4 e 3)
  const leftCount = Math.random() < 0.5 ? 3 : 4; // aleatório: 3 ou 4
  const rightCount = planets.length - leftCount; // o restante vai para o outro lado
  
  // Cria array de índices e embaralha
  const indices = planets.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  
  // Define quais planetas vão para esquerda e quais para direita
  const leftIndices = indices.slice(0, leftCount);
  const rightIndices = indices.slice(leftCount);
  
  // Cria array de distribuição (true = esquerda, false = direita)
  mobileIntro.queueDistribution = planets.map((_, i) => leftIndices.includes(i));
  
  // Atualiza posições da fila com nova distribuição aleatória
  // Calcula espaçamento baseado na quantidade de planetas em cada lado para centralização
  const leftSpacing = leftCount === 3 ? 3.5 : 2.5; // maior espaçamento para 3 planetas
  const rightSpacing = rightCount === 3 ? 3.5 : 2.5; // maior espaçamento para 3 planetas
  
  // Offset Y adicional para subir tudo no mobile (cria distância do botão)
  const mobileYOffset = 3.5;
  
  // Calcula offset Y para centralizar verticalmente
  const leftTotalHeight = (leftCount - 1) * (leftCount === 3 ? 3.5 : 2.5);
  const rightTotalHeight = (rightCount - 1) * (rightCount === 3 ? 3.5 : 2.5);
  const leftStartY = 6 - (leftTotalHeight / 2) + mobileYOffset; // centraliza verticalmente + offset
  const rightStartY = 6 - (rightTotalHeight / 2) + mobileYOffset; // centraliza verticalmente + offset
  
  mobileIntro.queuePositions = planets.map((p, i) => {
    const isLeft = mobileIntro.queueDistribution[i];
    const sideIndex = isLeft 
      ? leftIndices.indexOf(i) 
      : rightIndices.indexOf(i);
    
    const x = isLeft ? -5 : 5; // esquerda: -5, direita: 5
    const spacing = isLeft ? leftSpacing : rightSpacing;
    const startY = isLeft ? leftStartY : rightStartY;
    const y = startY - sideIndex * spacing; // fila vertical centralizada
    return new THREE.Vector3(x, y, 0);
  });
}

function applyResponsiveScale() {
  // Usa função helper para calcular largura segura
  const safeWidth = getSafeWidth();
  
  let scaleFactor = 1;
  if (safeWidth < 480) scaleFactor = MOBILE_SCALE_SMALL;
  else if (safeWidth < 768) scaleFactor = MOBILE_SCALE_MEDIUM;
  else if (safeWidth < 1024) scaleFactor = 0.9;

  scaleFactor = Math.max(0.4, scaleFactor);
  const isMobile = safeWidth <= 768;

  // No mobile, garante um scaleFactor fixo e consistente para evitar variações
  // Usa função helper para calcular mobile scale
  let mobileScaleFactor = scaleFactor;
  if (isMobile) {
    mobileScaleFactor = getCurrentMobileScale();
    // Garante que o mobileScaleFactor seja sempre o mesmo para a mesma largura
    // Arredonda para evitar imprecisões de ponto flutuante
    mobileScaleFactor = Math.round(mobileScaleFactor * 1000) / 1000; // arredonda para 3 casas decimais
  }

  // GLTF Scaling
  if (mesh && mesh.userData?.originalScale) {
    const mobileBoost = isMobile ? MOBILE_GLTF_BOOST : 1.0;
    let finalScale = isMobile ? mobileScaleFactor * mobileBoost : scaleFactor * mobileBoost;
    // Aplica redução de ~20.5% no desktop
    if (!isMobile) {
      finalScale = finalScale * DESKTOP_GLTF_REDUCTION;
    }
    mesh.scale.copy(mesh.userData.originalScale.clone().multiplyScalar(finalScale));
    
    // Ajusta posição Y do GLTF no mobile para criar distância do botão
        if (isMobile) {
          mesh.position.y = 3.5; // offset Y no mobile
        } else {
          mesh.position.y = 0; // posição original no desktop
        }
  } else {
    // Aplica redução de ~20.5% no desktop
    let pendingFactor = isMobile ? (mobileScaleFactor * MOBILE_PENDING_BOOST) : (scaleFactor * 1.0);
    if (!isMobile) {
      pendingFactor = pendingFactor * DESKTOP_GLTF_REDUCTION;
    }
    pendingMeshScaleFactor = pendingFactor;
  }

  // Planets scaling - garante que originalScale esteja definido
  planets.forEach(p => {
    // Garante que originalScale esteja sempre definido como (1,1,1) antes de aplicar scaling
    // Isso garante que o tamanho base venha da geometria, não de escalas anteriores
    if (!p.userData.originalScale) {
      p.userData.originalScale = VECTOR3_ONE_INSTANCE.clone();
    }
    
    // Sempre reseta para originalScale (1,1,1) antes de aplicar novo scaling para garantir consistência
    p.userData.originalScale.copy(VECTOR3_ONE_INSTANCE);
    
    if (p.userData.originalScale) {
      const mobilePlanetBoost = isMobile ? MOBILE_PLANET_BOOST : 1.0;
      // Se está em animação de zoom, não sobrescreve o zoom
      const zoomScale = (isMobile && p.userData.zoomScale !== undefined) ? p.userData.zoomScale : 1.0;
      const finalPlanetScale = isMobile ? (mobileScaleFactor * mobilePlanetBoost * zoomScale) : (scaleFactor * mobilePlanetBoost);
      // O aumento de 10% no desktop já foi aplicado na criação da geometria
      // Garante precisão ao aplicar o scale - sempre parte de (1,1,1)
      p.scale.copy(p.userData.originalScale.clone().multiplyScalar(finalPlanetScale));
    }
    if (typeof p.userData.originalRadius !== 'undefined') {
      const finalRadiusScale = isMobile ? mobileScaleFactor : scaleFactor;
      p.userData.radius = p.userData.originalRadius * finalRadiusScale;
    }
  });

  // Camera - usa mobileScaleFactor no mobile para consistência
  const cameraScale = isMobile ? mobileScaleFactor : scaleFactor;
  camera.position.z = cameraScale < 1 ? (cameraOriginalZ / cameraScale) : cameraOriginalZ;
  camera.updateProjectionMatrix();

  const shouldStack = isMobile;
  if (shouldStack !== isMobileStackMode) {
    isMobileStackMode = shouldStack;
    if (isMobileStackMode) {
      isHalfStackMode = false;
      layoutMobileCircular(); // MUDANÇA: usar layout circular em vez de empilhamento
      // Cria labels de nomes dos planetas no mobile
      createMobilePlanetLabels();
      if (!hasRunMobileIntro) {
        startMobileIntro();
        hasRunMobileIntro = true;
      }
    } else {
      layoutDesktopOrbit();
      // Remove labels quando sair do mobile
      if (mobileIntro.nameLabels && mobileIntro.nameLabels.length > 0) {
        const labelsContainer = document.getElementById('mobile-planet-labels');
        if (labelsContainer) labelsContainer.remove();
        mobileIntro.nameLabels = [];
      }
    }
  } else {
    if (isMobileStackMode) {
      layoutMobileCircular(); // MUDANÇA: usar layout circular em vez de empilhamento
      // Garante que labels existem
      if (!mobileIntro.nameLabels || mobileIntro.nameLabels.length === 0) {
        createMobilePlanetLabels();
      }
    } else {
      layoutDesktopOrbit();
    }
  }

  updateControlsForMode();
}
applyResponsiveScale();
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  applyResponsiveScale();
}, { passive: true });

/* Interações Desktop*/
window.addEventListener('click', (event) => {
  // Desabilita interações quando painel está aberto (apenas no desktop)
  if (panelOpen && !isMobileStackMode) return;
  if (mobileIntro.active) return;
  const isUI = event.target.closest('.btn') || event.target.closest('.planet-panel');
  if (isUI) return;
  const hit = intersectAtClient(event.clientX, event.clientY);
  if (hit.length > 0) showPlanetPanelByIndex(hit[0].object.userData.index - 1);
});

/* Interações Mobile — tooltip desativado no Chrome Android */
let spinningTouchStartTime = 0;
let spinningTouchStartPos = null;
const SPINNING_THRESHOLD = 30; // pixels mínimos de movimento para iniciar spinning
const SPINNING_TIME_THRESHOLD = 150; // ms mínimos de toque para iniciar spinning

window.addEventListener('touchstart', (ev) => {
  if (!ev.touches || ev.touches.length === 0) return;
  if (panelOpen) return;
  if (mobileIntro.active) return;

  const t = ev.touches[0];
  const hit = intersectAtClient(t.clientX, t.clientY);
  if (hit.length > 0) {
    // Inicializa dados do spinning
    if (isMobileStackMode && mobileIntro.phase === 'idle') {
      spinningTouchStartTime = performance.now();
      spinningTouchStartPos = { x: t.clientX, y: t.clientY };
      mobileIntro.spinning.active = false;
      mobileIntro.spinning.startX = t.clientX;
      mobileIntro.spinning.startY = t.clientY;
      mobileIntro.spinning.lastX = t.clientX;
      mobileIntro.spinning.lastY = t.clientY;
      mobileIntro.spinning.centerX = window.innerWidth / 2;
      mobileIntro.spinning.centerY = window.innerHeight / 2;
      mobileIntro.spinning.currentAngle = mobileIntro.cirandaAngle;
      mobileIntro.spinning.targetAngle = mobileIntro.cirandaAngle;
      mobileIntro.spinning.velocity = 0;
      mobileIntro.cirandaPaused = true;
    }
    
    if (!isChromeAndroid) {
      const obj = hit[0].object;
      const name = planetNames[obj.userData.index - 1];
      const vec = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
      const screenPos = projectToScreen(vec, camera);
      const px = screenPos.x;
      const py = screenPos.y;

      tipping.style.left = `${px - 20}px`;
      tipping.style.top = `${py - 60}px`;
      startTipping(name);
      setTimeout(() => hideTipping(), 1000);
    }
  }
}, { passive: true });

// Event listener para touchmove - detecta movimento de spinning
window.addEventListener('touchmove', (ev) => {
  if (!isMobileStackMode || mobileIntro.phase !== 'idle' || panelOpen || mobileIntro.active) return;
  if (!ev.touches || ev.touches.length === 0) return;
  
  const t = ev.touches[0];
  
  // Se não há posição inicial de spinning, não processa
  if (!spinningTouchStartPos) return;
  
  const hit = intersectAtClient(t.clientX, t.clientY);
  
  // Calcula o ângulo do movimento em relação ao centro da tela
  const centerX = mobileIntro.spinning.centerX;
  const centerY = mobileIntro.spinning.centerY;
  const currentAngle = Math.atan2(t.clientY - centerY, t.clientX - centerX);
  const lastAngle = Math.atan2(mobileIntro.spinning.lastY - centerY, mobileIntro.spinning.lastX - centerX);
  
  let deltaAngle = currentAngle - lastAngle;
  // Normaliza o delta para o intervalo [-PI, PI]
  if (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
  if (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;
  
  // Verifica se o movimento é suficiente para iniciar spinning
  const timeSinceStart = performance.now() - spinningTouchStartTime;
  const totalDistance = Math.sqrt(
    Math.pow(t.clientX - spinningTouchStartPos.x, 2) + 
    Math.pow(t.clientY - spinningTouchStartPos.y, 2)
  );
  
  // Verifica se há movimento circular significativo
  const movementDistance = Math.sqrt(
    Math.pow(t.clientX - mobileIntro.spinning.lastX, 2) + 
    Math.pow(t.clientY - mobileIntro.spinning.lastY, 2)
  );
  
  if (!mobileIntro.spinning.active) {
    // Inicia spinning se houver movimento suficiente e tempo mínimo
    if (timeSinceStart > SPINNING_TIME_THRESHOLD && totalDistance > SPINNING_THRESHOLD && Math.abs(deltaAngle) > 0.01) {
      mobileIntro.spinning.active = true;
      ev.preventDefault(); // Previne scroll quando spinning está ativo
    }
  }
  
  if (mobileIntro.spinning.active) {
    ev.preventDefault(); // Previne scroll durante spinning
    
    // Atualiza o ângulo da ciranda baseado no movimento circular
    mobileIntro.spinning.targetAngle += deltaAngle;
    mobileIntro.spinning.currentAngle = mobileIntro.spinning.targetAngle;
    
    // Calcula velocidade para inércia (baseada no deltaAngle e distância do movimento)
    if (Math.abs(deltaAngle) > 0.001 && movementDistance > 2) {
      // Velocidade proporcional ao deltaAngle e à distância do movimento
      mobileIntro.spinning.velocity = deltaAngle * (1 + movementDistance * 0.01) * 0.4;
    }
    
    mobileIntro.spinning.lastX = t.clientX;
    mobileIntro.spinning.lastY = t.clientY;
  }
}, { passive: false });

window.addEventListener('touchend', (ev) => {
  if (panelOpen) return;
  if (mobileIntro.active) return;
  const t = ev.changedTouches?.[0];
  if (!t) return;
  
  // Se estava fazendo spinning, aplica inércia e depois retoma movimento normal
  if (mobileIntro.spinning.active) {
    mobileIntro.spinning.active = false;
    mobileIntro.cirandaAngle = mobileIntro.spinning.currentAngle;
    
    // Aplica inércia se houver velocidade significativa
    if (Math.abs(mobileIntro.spinning.velocity) > 0.0005) {
      // A inércia será aplicada no loop de animação
      // Não retoma a ciranda imediatamente, deixa a inércia acabar primeiro
      mobileIntro.cirandaPaused = true; // Mantém pausado durante inércia
    } else {
      // Se não há inércia significativa, retoma movimento normal imediatamente
      mobileIntro.spinning.velocity = 0;
      mobileIntro.cirandaPaused = false;
    }
    
    spinningTouchStartPos = null;
    return; // Não abre painel se estava fazendo spinning
  }
  
  // Se não estava fazendo spinning, verifica se deve abrir painel
  // Mas só se o toque foi rápido (tap) e não houve movimento significativo
  const timeSinceStart = performance.now() - spinningTouchStartTime;
  const totalDistance = spinningTouchStartPos ? 
    Math.sqrt(
      Math.pow(t.clientX - spinningTouchStartPos.x, 2) + 
      Math.pow(t.clientY - spinningTouchStartPos.y, 2)
    ) : 0;
  
  // Se foi um tap rápido (não spinning), abre o painel
  if (timeSinceStart < 300 && totalDistance < SPINNING_THRESHOLD) {
    const hit = intersectAtClient(t.clientX, t.clientY);
    if (hit.length > 0) {
      showPlanetPanelByIndex(hit[0].object.userData.index - 1);
      // Mantém pausado enquanto o painel está aberto
    } else {
      // Se não tocou em nenhum planeta, retoma a ciranda
      if (isMobileStackMode && !panelOpen && mobileIntro.phase === 'idle') {
        mobileIntro.cirandaPaused = false;
      }
    }
  } else {
    // Se houve movimento mas não foi spinning ativo, retoma ciranda
    if (isMobileStackMode && !panelOpen && mobileIntro.phase === 'idle') {
      mobileIntro.cirandaPaused = false;
    }
  }
  
  spinningTouchStartPos = null;
}, { passive: true });

/*Hover Desktop (com frenagem)*/
function updateHoverTooltip() {
  if (isChromeAndroid) return;

  // No desktop, desabilita hover quando painel está aberto
  if (isMobileStackMode) {
    // Mobile: usa a lógica original
  if (panelOpen || mobileIntro.active) {
    document.body.style.cursor = 'default';
    hideTipping();
    return;
    }
  } else {
    // Desktop: bloqueia completamente quando painel está aberto
    if (panelOpen) {
      document.body.style.cursor = 'default';
      hideTipping();
      // Restaura velocidades dos planetas ao normal (remove frenagem)
      planets.forEach(p => {
        p.userData.speed = p.userData.baseSpeed;
      });
      return;
    }
    if (mobileIntro.active) {
      document.body.style.cursor = 'default';
      hideTipping();
      return;
    }
  }

  raycaster.setFromCamera(pointer, camera);
  const intersect = raycaster.intersectObjects(planets);

  if (intersect.length > 0) {
    const obj = intersect[0].object;
    obj.userData.speed = obj.userData.baseSpeed * 0.05; // Frenagem ao hover

    const vec = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
    const screenPos = projectToScreen(vec, camera);
    const px = screenPos.x;
    const py = screenPos.y;

    document.body.style.cursor = 'pointer';
    tipping.style.left = `${px + 10}px`;
    tipping.style.top = `${py - 30}px`;

    const name = planetNames[obj.userData.index - 1];
    if (tippingFullText !== name) startTipping(name);
  } else {
    document.body.style.cursor = 'default';
    hideTipping();
    // Restaura velocidades quando não há hover
    planets.forEach(p => {
      if (p.userData.speed !== p.userData.baseSpeed) {
        p.userData.speed = THREE.MathUtils.lerp(p.userData.speed, p.userData.baseSpeed, 0.1);
      }
    });
  }
}
window.addEventListener('mousemove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}, { passive: true });

/*Reset de Órbita (com easing Apple Smooth)*/

/*BLOQUEIO DE CONTROLES NO MOBILE + ROTAÇÃO DO GLTF (sem inércia)*/
function updateControlsForMode() {
  if (isMobileStackMode) {
    controls.enabled = false;
    controls.enableZoom = false;
    controls.enableRotate = false;
    controls.enablePan = false;
    controls.target.set(0, 0, 0);
    camera.lookAt(0, 0, 0);
    controls.update();
    renderer.domElement.style.touchAction = 'none';
  } else {
    // Desktop: desabilita controles quando painel está aberto
    if (panelOpen) {
      controls.enabled = false;
      controls.enableZoom = false;
      controls.enableRotate = false;
      controls.enablePan = false;
  } else {
    controls.enabled = true;
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.enablePan = true;
    }
    renderer.domElement.style.touchAction = '';
  }
}

// Interação do GLTF no mobile (arrastar = rotacionar X/Y) — COM FLUIDEZ
const gltfDrag = { 
  active: false, 
  lastX: 0, 
  lastY: 0,
  targetRotationX: 0,
  targetRotationY: 0,
  currentRotationX: 0,
  currentRotationY: 0
};
const GLTF_DRAG_SENS = 0.0045; // Sensibilidade aumentada para mais fluidez

function onGltfTouchStart(e) {
  if (!isMobileStackMode || !mesh) return;
  if (!e.touches || e.touches.length === 0) return;
  
  const t = e.touches[0];
  
  // PRIMEIRO: Verifica se não está tocando um planeta (prioridade para spinning)
  const planetHit = intersectAtClient(t.clientX, t.clientY);
  if (planetHit.length > 0) {
    // Se tocou em um planeta, não ativa o drag do GLTF
    return;
  }
  
  // SEGUNDO: Verifica se o toque está próximo do GLTF (raio menor)
  pointer.x = (t.clientX / window.innerWidth) * 2 - 1;
  pointer.y = (-(t.clientY) / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  
  // Faz raycast no GLTF (pode ser um grupo, então usa intersectObjects)
  const gltfHit = raycaster.intersectObject(mesh, true);
  if (gltfHit.length === 0) {
    // Não tocou no GLTF
    return;
  }
  
  // TERCEIRO: Verifica se está dentro de um raio menor (reduzido para 60% do tamanho visual)
  const hitPoint = gltfHit[0].point;
  const gltfCenter = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
  const distanceFromCenter = hitPoint.distanceTo(gltfCenter);
  
  // Calcula o raio máximo permitido (60% do tamanho do bounding box do GLTF)
  const boundingBox = new THREE.Box3().setFromObject(mesh);
  const gltfSize = boundingBox.getSize(new THREE.Vector3());
  const maxRadius = Math.max(gltfSize.x, gltfSize.y, gltfSize.z) * 0.3; // 30% do maior eixo (raio menor)
  
  if (distanceFromCenter > maxRadius) {
    // Toque está muito longe do centro do GLTF, não ativa
    return;
  }
  
  // Se passou todas as verificações, ativa o drag do GLTF
  gltfDrag.active = true;
  gltfDrag.lastX = t.clientX;
  gltfDrag.lastY = t.clientY;
  // Inicializa as rotações alvo com a rotação atual
  gltfDrag.targetRotationX = mesh.rotation.x;
  gltfDrag.targetRotationY = mesh.rotation.y;
  gltfDrag.currentRotationX = mesh.rotation.x;
  gltfDrag.currentRotationY = mesh.rotation.y;
}
function onGltfTouchMove(e) {
  if (!isMobileStackMode || !mesh) return;
  if (!gltfDrag.active) return;
  if (!e.touches || e.touches.length === 0) return;
  e.preventDefault();
  const t = e.touches[0];
  const dx = t.clientX - gltfDrag.lastX;
  const dy = t.clientY - gltfDrag.lastY;
  gltfDrag.lastX = t.clientX;
  gltfDrag.lastY = t.clientY;
  
  // Atualiza rotações alvo (mais fluido)
  gltfDrag.targetRotationY += dx * GLTF_DRAG_SENS;
  gltfDrag.targetRotationX += dy * GLTF_DRAG_SENS;
  
  // Limita inclinação X
  const maxTilt = Math.PI / 2.5;
  gltfDrag.targetRotationX = Math.max(-maxTilt, Math.min(maxTilt, gltfDrag.targetRotationX));
  
  // Aplica suavização imediata para fluidez
  const smoothFactor = 0.3; // quanto maior, mais direto (0.3 = suave e fluido)
  gltfDrag.currentRotationX += (gltfDrag.targetRotationX - gltfDrag.currentRotationX) * smoothFactor;
  gltfDrag.currentRotationY += (gltfDrag.targetRotationY - gltfDrag.currentRotationY) * smoothFactor;
  
  mesh.rotation.x = gltfDrag.currentRotationX;
  mesh.rotation.y = gltfDrag.currentRotationY;
}
function onGltfTouchEnd() {
  if (!isMobileStackMode) return;
  gltfDrag.active = false;
}
renderer.domElement.addEventListener('touchstart', onGltfTouchStart, { passive: false });
renderer.domElement.addEventListener('touchmove',  onGltfTouchMove,  { passive: false });
renderer.domElement.addEventListener('touchend',   onGltfTouchEnd,   { passive: true  });

/* ============================================================
   Logo holográfico: visibilidade por scroll (>=85%)

function checkLogoHologramVisibility() {
  if (!panelOpen) {
    panel.classList.remove('show-logo');
    return;
  }
  const scrollPos = panel.scrollTop + panel.clientHeight;
  const threshold = panel.scrollHeight * 0.85;
  if (scrollPos >= threshold) {
    panel.classList.add('show-logo');
  } else {
    panel.classList.remove('show-logo');
  }
}
panel.addEventListener('scroll', checkLogoHologramVisibility);  */

/*Loop de Animação*/
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // GLTF: gira sozinho sempre (apenas quando não está sendo arrastado no mobile)
  if (mesh) {
    // Materiais só precisam de update quando realmente mudarem - removido update desnecessário a cada frame
    
    if (isMobileStackMode && gltfDrag.active) {
      // Durante o arrasto, não gira automaticamente - apenas segue o movimento do usuário
      // Continua suavizando a rotação se necessário
      const smoothFactor = 0.15;
      gltfDrag.currentRotationX += (gltfDrag.targetRotationX - gltfDrag.currentRotationX) * smoothFactor;
      gltfDrag.currentRotationY += (gltfDrag.targetRotationY - gltfDrag.currentRotationY) * smoothFactor;
      mesh.rotation.x = gltfDrag.currentRotationX;
      mesh.rotation.y = gltfDrag.currentRotationY;
    } else {
      // Rotação automática: gira como hélice/cata-vento (eixo Z - perpendicular ao plano)
      // Sentido da direita para esquerda (positivo)
      mesh.rotation.z += 0.005;
    }
  }

  // Fade do loading
  if (meshLoaded && !fadeStarted) {
    if (performance.now() - meshLoadedAt >= fadeDelayAfterLoad) startLoadingFade();
  }
  if (fadeStarted && mesh && mesh.userData && mesh.userData.allMaterials) {
    const t = Math.min(1, (performance.now() - fadeStartTime) / loadingFadeDuration);
    // Aplica fade em todos os materiais do GLTF
    mesh.userData.allMaterials.forEach(mat => {
      if (mat) {
        // Preserva a cor original, apenas atualiza opacidade
        mat.opacity = t;
        mat.needsUpdate = true;
      }
    });
  } else if (fadeStarted && meshMaterial) {
    const t = Math.min(1, (performance.now() - fadeStartTime) / loadingFadeDuration);
    // Preserva a cor original, apenas atualiza opacidade
    meshMaterial.opacity = t;
    meshMaterial.needsUpdate = true;
  }

  // typing do tipping (desktop)
  if (!isChromeAndroid && tippingFullText && tippingIndex < tippingFullText.length && performance.now() - tippingLastTime > tippingSpeed) {
    tippingCurrent += tippingFullText[tippingIndex];
    tipping.textContent = tippingCurrent;
    tippingIndex++;
    tippingLastTime = performance.now();
  }

  const now = performance.now();

  if (isMobileStackMode) {
    if (mobileIntro.active) {
      if (mobileIntro.phase === 'line') {
        // FASE 1: Planetas entram em fila - transição suave
        const t = Math.min(1, (now - mobileIntro.t0) / mobileLineDuration);
        const te = smoothEaseInOut(t); // easing mais suave para transição inicial
        
        planets.forEach((p, i) => {
          const startPos = mobileIntro.initialPositions[i];
          const targetPos = mobileIntro.queuePositions[i];
          
          // Interpola suave da posição inicial para a fila
          p.position.lerpVectors(startPos, targetPos, te);
          
          // Garante que a atualização seja suave
          p.updateMatrixWorld(false);
        });
        
        if (t >= 1) {
          mobileIntro.phase = 'ciranda';
          mobileIntro.t0 = now;
        }
      } else if (mobileIntro.phase === 'ciranda') {
        // FASE 2: Transição da fila para o círculo da ciranda - ZOOM IN (nomes aparecem)
        const t = Math.min(1, (now - mobileIntro.t0) / mobileCirandaDuration);
        const te = appleEase(t);
        const radius = mobileIntro.cirandaRadius;
        
        // Zoom in: de 0.85 para 1.0 (planetas voltam ao normal, nomes aparecem)
        const planetZoomScale = 0.85 + (0.15 * te); // 0.85 -> 1.0
        
        // Calcula mobileScale uma vez para este frame (otimização)
        const currentMobileScale = getCurrentMobileScale();
        
        planets.forEach((p, i) => {
          const queuePos = mobileIntro.queuePositions[i];
          const baseAngle = mobileIntro.baseAngles[i];
          const circleX = Math.cos(baseAngle) * radius;
          const circleY = Math.sin(baseAngle) * radius;
          
          // Interpola da fila para o círculo (com offset Y para subir)
          const yOffset = mobileIntro.cirandaYOffset || 3.5;
          const x = queuePos.x + (circleX - queuePos.x) * te;
          const y = queuePos.y + (circleY + yOffset - queuePos.y) * te;
          p.position.set(x, y, 0);
          
          // Aplica zoom in no planeta (de 0.85 para 1.0)
          p.userData.zoomScale = planetZoomScale;
          const baseScale = p.userData.originalScale || VECTOR3_ONE_INSTANCE.clone();
          p.scale.copy(baseScale.clone().multiplyScalar(planetZoomScale * (currentMobileScale * MOBILE_PLANET_BOOST)));
          
          // Nomes desabilitados no mobile (labels não são mais criados)
        });
        
        if (t >= 1) {
          mobileIntro.active = false;
          mobileIntro.phase = 'idle';
          // Garante zoom final de 1.0
          const finalMobileScale = getCurrentMobileScale();
          planets.forEach((p, i) => {
            p.userData.zoomScale = 1.0;
            const baseScale = p.userData.originalScale || VECTOR3_ONE_INSTANCE.clone();
            p.scale.copy(baseScale.clone().multiplyScalar(finalMobileScale * MOBILE_PLANET_BOOST));
            // Nomes desabilitados no mobile
          });
        }
      } else if (mobileIntro.phase === 'reset') {
        // Reset: abre, gira e volta para fila
        const elapsed = now - mobileIntro.t0;
        const radius = mobileIntro.cirandaRadius;
        const totalResetDuration = mobileResetOpenDuration + mobileResetRotateDuration + mobileResetReturnDuration;
        const overallT = Math.min(1, elapsed / totalResetDuration); // Progresso geral (0 a 1)
        const overallTe = appleEase(overallT); // Easing geral para interpolação suave do GLTF
        
        // Calcula mobileScale uma vez para este frame (otimização)
        const currentMobileScale = getCurrentMobileScale();
        
        // Inicializa posições finais da FASE 2 se ainda não existirem
        if (!mobileIntro.rotateEndPositions) {
          mobileIntro.rotateEndPositions = [];
        }
        
        if (elapsed < mobileResetOpenDuration) {
          // FASE 1: Abrir (expandir o círculo) - apenas nomes desaparecem
          const t = elapsed / mobileResetOpenDuration;
          const te = smoothEaseInOut(t); // easing mais suave para evitar tranco
          const expandedRadius = radius * 1.5; // expande 50%
          
          // Planetas mantêm tamanho quase normal (zoom mínimo de 0.85)
          const planetZoomScale = 1.0 - (0.15 * te); // 1.0 -> 0.85 (redução leve)
        
          planets.forEach((p, i) => {
            // Usa posição inicial real para transição suave
            const startPos = mobileIntro.cirandaStartPositions[i] || p.position.clone();
            const startAngle = mobileIntro.cirandaStartAngles[i];
            const currentRadius = radius + (expandedRadius - radius) * te;
            const yOffset = mobileIntro.cirandaYOffset || 3.5;
            
            // Calcula posição alvo
            const targetX = Math.cos(startAngle) * currentRadius;
            const targetY = Math.sin(startAngle) * currentRadius + yOffset;
            const targetPos = new THREE.Vector3(targetX, targetY, 0);
            
            // Interpola suave da posição atual para a alvo
            p.position.lerpVectors(startPos, targetPos, te);
            p.updateMatrixWorld(false);
            
            // Aplica zoom leve no planeta (não fica muito pequeno)
            p.userData.zoomScale = planetZoomScale;
            const baseScale = p.userData.originalScale || VECTOR3_ONE_INSTANCE.clone();
            p.scale.copy(baseScale.clone().multiplyScalar(planetZoomScale * (currentMobileScale * MOBILE_PLANET_BOOST)));
          });
          
          // Interpola suave da rotação do GLTF durante FASE 1
          // Volta diretamente à posição original sem giros extras
          if (mesh && meshInitialRotation && meshRewindStartRotation) {
            mesh.rotation.x = THREE.MathUtils.lerp(meshRewindStartRotation.x, meshInitialRotation.x, overallTe);
            mesh.rotation.y = THREE.MathUtils.lerp(meshRewindStartRotation.y, meshInitialRotation.y, overallTe);
            mesh.rotation.z = THREE.MathUtils.lerp(meshRewindStartRotation.z, meshInitialRotation.z, overallTe);
          }
        } else if (elapsed < mobileResetOpenDuration + mobileResetRotateDuration) {
          // FASE 2: Girar (rotação completa) - planetas mantêm tamanho, nomes escondidos
          // Agora faz exatamente 2 voltas completas (4π) sincronizado com o GLTF
          const t = (elapsed - mobileResetOpenDuration) / mobileResetRotateDuration;
          const te = appleEase(t);
          const rotationAngle = te * Math.PI * 4; // 2 voltas completas (4π radianos)
          const expandedRadius = radius * 1.5;
          const planetZoomScale = 0.85; // mantém tamanho quase normal
          
          planets.forEach((p, i) => {
            const startAngle = mobileIntro.cirandaStartAngles[i];
            const currentAngle = startAngle + rotationAngle;
            const yOffset = mobileIntro.cirandaYOffset || 3.5;
            const x = Math.cos(currentAngle) * expandedRadius;
            const y = Math.sin(currentAngle) * expandedRadius + yOffset;
            p.position.set(x, y, 0);
            
            // Salva posição final da rotação para usar na FASE 3 (sempre atualiza no último frame)
            // Calcula posição final (2 voltas completas = 4π)
            const finalAngle = startAngle + Math.PI * 4; // 2 voltas completas
            const finalX = Math.cos(finalAngle) * expandedRadius;
            const finalY = Math.sin(finalAngle) * expandedRadius + yOffset;
            mobileIntro.rotateEndPositions[i] = new THREE.Vector3(finalX, finalY, 0);
            
            // Mantém tamanho quase normal
            p.userData.zoomScale = planetZoomScale;
            const baseScale = p.userData.originalScale || VECTOR3_ONE_INSTANCE.clone();
            p.scale.copy(baseScale.clone().multiplyScalar(planetZoomScale * (currentMobileScale * MOBILE_PLANET_BOOST)));
          });
          
          // Interpola suave da rotação do GLTF durante FASE 2
          // Volta diretamente à posição original sem giros extras
          if (mesh && meshInitialRotation && meshRewindStartRotation) {
            mesh.rotation.x = THREE.MathUtils.lerp(meshRewindStartRotation.x, meshInitialRotation.x, overallTe);
            mesh.rotation.y = THREE.MathUtils.lerp(meshRewindStartRotation.y, meshInitialRotation.y, overallTe);
            mesh.rotation.z = THREE.MathUtils.lerp(meshRewindStartRotation.z, meshInitialRotation.z, overallTe);
          }
        } else if (elapsed < mobileResetOpenDuration + mobileResetRotateDuration + mobileResetReturnDuration) {
          // FASE 3: Voltar para fila - planetas mantêm tamanho, nomes escondidos
          const t = (elapsed - mobileResetOpenDuration - mobileResetRotateDuration) / mobileResetReturnDuration;
          const te = appleEase(t);
          const planetZoomScale = 0.85; // mantém tamanho quase normal durante retorno
          
          planets.forEach((p, i) => {
            // Usa posição final da FASE 2 como ponto de partida (não a posição atual)
            const startPos = mobileIntro.rotateEndPositions[i] || p.position.clone();
            const targetPos = mobileIntro.queuePositions[i];
            
            // Interpola suave da posição final da rotação para a fila
            p.position.lerpVectors(startPos, targetPos, te);
            
            // Mantém tamanho quase normal durante retorno
            p.userData.zoomScale = planetZoomScale;
            const baseScale = p.userData.originalScale || VECTOR3_ONE_INSTANCE.clone();
            p.scale.copy(baseScale.clone().multiplyScalar(planetZoomScale * (currentMobileScale * MOBILE_PLANET_BOOST)));
          });
          
          // Interpola suave da rotação do GLTF durante FASE 3 (completa a interpolação)
          // Volta diretamente à posição original sem giros extras, de forma suave
          if (mesh && meshInitialRotation && meshRewindStartRotation) {
            mesh.rotation.x = THREE.MathUtils.lerp(meshRewindStartRotation.x, meshInitialRotation.x, overallTe);
            mesh.rotation.y = THREE.MathUtils.lerp(meshRewindStartRotation.y, meshInitialRotation.y, overallTe);
            mesh.rotation.z = THREE.MathUtils.lerp(meshRewindStartRotation.z, meshInitialRotation.z, overallTe);
          }
        } else {
          // Reset completo - volta para fila e reinicia a ciranda
          planets.forEach((p, i) => {
            p.position.copy(mobileIntro.queuePositions[i]);
          });
          
          // Limpa posições finais da rotação
          mobileIntro.rotateEndPositions = [];
          
          // Garante que o GLTF está na posição inicial final
          if (mesh && meshInitialRotation) {
            mesh.rotation.x = meshInitialRotation.x;
            mesh.rotation.y = meshInitialRotation.y;
            mesh.rotation.z = meshInitialRotation.z;
          }
          
          // Reinicia a ciranda automaticamente
          mobileIntro.phase = 'ciranda';
          mobileIntro.t0 = now;
          mobileIntro.cirandaAngle = 0;
        }
      }
      } else {
          // Estado idle: Ciranda contínua ao redor do GLTF
        if (!panelOpen) {
          const radius = mobileIntro.cirandaRadius;
          
          // Garante que baseAngles está definido
          if (!mobileIntro.baseAngles || mobileIntro.baseAngles.length === 0) {
            mobileIntro.baseAngles = planets.map((_, i) => (i / planets.length) * Math.PI * 2);
          }
          
          // Spinning: aplica rotação manual ou inércia
          if (mobileIntro.spinning.active) {
            // Durante spinning ativo, usa o ângulo atual do spinning
            mobileIntro.cirandaAngle = mobileIntro.spinning.currentAngle;
          } else if (Math.abs(mobileIntro.spinning.velocity) > 0.0001) {
            // Aplica inércia após soltar
            mobileIntro.spinning.velocity *= mobileIntro.spinning.damping;
            mobileIntro.spinning.currentAngle += mobileIntro.spinning.velocity;
            mobileIntro.cirandaAngle = mobileIntro.spinning.currentAngle;
            
            // Quando a inércia acabar, retoma movimento normal
            if (Math.abs(mobileIntro.spinning.velocity) < 0.0001) {
              mobileIntro.spinning.velocity = 0;
              mobileIntro.cirandaPaused = false;
            }
          } else if (!mobileIntro.cirandaPaused) {
            // Movimento normal da ciranda
            mobileIntro.cirandaAngle += mobileIntro.cirandaSpeed;
            if (mobileIntro.cirandaAngle > Math.PI * 2) mobileIntro.cirandaAngle -= Math.PI * 2;
            if (mobileIntro.cirandaAngle < 0) mobileIntro.cirandaAngle += Math.PI * 2;
          }
          
          // Normaliza o ângulo para o intervalo [0, 2*PI] (redundância removida - já normalizado acima)
          
          // Posiciona os planetas na ciranda (mesmo se pausado, mantém na posição atual)
          // Zoom in completo (1.0) quando em idle
          const yOffset = mobileIntro.cirandaYOffset || 3.5;
          planets.forEach((p, index) => {
            const baseAngle = mobileIntro.baseAngles[index];
            const currentAngle = baseAngle + mobileIntro.cirandaAngle;
            const x = Math.cos(currentAngle) * radius;
            const y = Math.sin(currentAngle) * radius + yOffset;
            p.position.set(x, y, 0);
            
          // Garante zoom in completo (1.0) em idle
          if (p.userData.zoomScale !== 1.0) {
            p.userData.zoomScale = 1.0;
            const baseScale = p.userData.originalScale || VECTOR3_ONE_INSTANCE.clone();
            const currentMobileScale = getCurrentMobileScale();
            p.scale.copy(baseScale.clone().multiplyScalar(currentMobileScale * MOBILE_PLANET_BOOST));
          }
            
            // Nomes desabilitados no mobile
          });
        } else {
          // Se o painel está aberto, também pausa a ciranda
          mobileIntro.cirandaPaused = true;
        }
      }
    } else {
      // Desktop: órbitas (com easing na volta do reset)
      if (isRewinding) {
        const t = Math.min(1, (now - rewindStartTime) / rewindDuration);
        const e = appleEase(t);
        
        // Calcula posições orbitais base
        // Sincronizado com o GLTF: ambos usam o mesmo progresso 'e' e fazem exatamente 2 voltas
        planets.forEach((p, i) => {
          // Interpola o ângulo, que já inclui exatamente 2 voltas completas (4π radianos)
          // Não normaliza durante a interpolação para manter sincronização perfeita
          p.userData.angle = THREE.MathUtils.lerp(rewindData[i].startAngle, rewindData[i].endAngle, e);
          
          // Usa o ângulo diretamente (com as voltas completas incluídas) para cálculo da posição
          // Math.cos e Math.sin funcionam corretamente com valores maiores que 2π
          const r = p.userData.radius;
          const baseX = Math.cos(p.userData.angle) * r;
          const baseY = Math.sin(p.userData.angle) * r;
          p.position.set(baseX, baseY, 0);
          
          // Normaliza apenas no final para manter consistência (mas não durante a animação)
          // Isso garante que após a animação, os valores estejam normalizados
          if (e >= 1) {
            // Normaliza apenas quando a animação terminar
            const twoPi = Math.PI * 2;
            p.userData.angle = ((p.userData.angle % twoPi) + twoPi) % twoPi;
          }
        });
        
        // Desktop: GLTF continua girando normalmente (sem rewind)
        // Apenas os planetas fazem o rewind, o GLTF mantém sua rotação automática contínua
        
        // Aplica comportamento de enxame mesmo durante o reset
        planets.forEach((p, i) => {
          let totalRepulsionX = 0;
          let totalRepulsionY = 0;
          
          planets.forEach((other, j) => {
            if (i === j) return;
            
            const dx = p.position.x - other.position.x;
            const dy = p.position.y - other.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            const minDist = (p.userData.minDistance || 0) + (other.userData.minDistance || 0);
            
            if (distance > 0 && distance < minDist) {
              // Força de repulsão reduzida no desktop para órbita mais organizada
              const repulsionForce = isMobileStackMode ? 0.15 : 0.05; // força muito menor no desktop
              const force = (minDist - distance) / minDist;
              const normalizedX = dx / distance;
              const normalizedY = dy / distance;
              
              totalRepulsionX += normalizedX * force * repulsionForce;
              totalRepulsionY += normalizedY * force * repulsionForce;
            }
          });
          
          // Aplica repulsão
          p.position.x += totalRepulsionX;
          p.position.y += totalRepulsionY;
        });
        
        if (t >= 1) {
          isRewinding = false;
          // Desktop: GLTF continua girando normalmente (sem reset)
        }
      } else {
      // Comportamento de enxame: evita colisões entre planetas
      planets.forEach((p, i) => {
        // Calcula repulsão de outros planetas
        let totalRepulsionX = 0;
        let totalRepulsionY = 0;
        
        planets.forEach((other, j) => {
          if (i === j) return; // não compara com ele mesmo
          
          const dx = p.position.x - other.position.x;
          const dy = p.position.y - other.position.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          // Distância mínima combinada
          const minDist = (p.userData.minDistance || 0) + (other.userData.minDistance || 0);
          
          if (distance > 0 && distance < minDist) {
            // Força de repulsão (inversamente proporcional à distância)
            // Reduzida no desktop para órbita mais organizada
            const repulsionForce = isMobileStackMode ? 0.15 : 0.05; // força muito menor no desktop
            const force = (minDist - distance) / minDist;
            const normalizedX = dx / distance;
            const normalizedY = dy / distance;
            
            totalRepulsionX += normalizedX * force * repulsionForce;
            totalRepulsionY += normalizedY * force * repulsionForce;
          }
        });
        
        // Aplica o movimento orbital normal
        const target = p.userData.baseSpeed;
        p.userData.speed = THREE.MathUtils.lerp(p.userData.speed, target, 0.08);
        p.userData.angle += p.userData.speed;
        
        // Calcula posição orbital base
        const baseRadius = p.userData.radius;
        const baseX = Math.cos(p.userData.angle) * baseRadius;
        const baseY = Math.sin(p.userData.angle) * baseRadius;
        
        // Aplica repulsão para evitar colisões
        const finalX = baseX + totalRepulsionX;
        const finalY = baseY + totalRepulsionY;
        
        p.position.set(finalX, finalY, 0);
      });
    }
  }

  updateHoverTooltip();

  // Labels de nomes desabilitados no mobile (não atualiza mais)

  if (starFieldFar?.userData?.animate) starFieldFar.userData.animate();

  renderer.render(scene, camera);
}
  animate();

} // End of initUniverse function

// Initialize universe after DOM is ready, with a small delay to prioritize initial paint
document.addEventListener('DOMContentLoaded', () => {
  // Inicializa o tempo de início da aplicação quando o DOM está pronto
  if (appStartTime === null) {
    appStartTime = performance.now();
  }
  
  // Check for reduced motion preference
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    return; // Reduced motion preference detected, skipping 3D animations
  }
  
  // Small delay to allow initial paint to complete
  setTimeout(() => {
    initUniverse().catch(console.error);
  }, 500);
});
