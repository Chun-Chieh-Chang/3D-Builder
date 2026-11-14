import * as THREE from 'three';

const element = (id) => document.getElementById(id);
const data = JSON.parse(element('fixture').textContent);
const canvas = element('view');
const { labels } = data;
document.documentElement.lang = data.locale;
document.title = `${data.name} · ${labels.title}`;
for (const [id, value] of Object.entries({ title: labels.title, 'assembly-name': data.name,
  'view-title': labels.iso, 'bom-title': labels.bom, hint: labels.hint,
  previous: labels.previous, next: labels.next, reset: labels.reset })) element(id).textContent = value;

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x62746c, 2.15));
  const light = new THREE.DirectionalLight(0xfff3dc, 2.5);
  light.position.set(2, 5, 4);
  scene.add(light);
  const drawing = data.meshes.map((mesh) => {
    const surface = new THREE.BufferGeometry();
    surface.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    surface.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
    surface.setIndex(mesh.indices);
    surface.computeBoundingBox();
    const segments = [];
    for (let i = 0; i < mesh.edgeRanges.length; i += 3) {
      const [start, count] = mesh.edgeRanges.slice(i, i + 2);
      for (let point = start; point < start + count - 1; point++) segments.push(...mesh.edgePoints.slice(point * 3, point * 3 + 6));
    }
    const edges = new THREE.BufferGeometry();
    edges.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
    return { surface, edges };
  });
  const surfaceMaterial = (color, transparent = false) => new THREE.MeshStandardMaterial({ color, roughness: 0.55,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, transparent, opacity: transparent ? 0.35 : 1, depthWrite: !transparent });
  const colors = [0x8caaad, 0x5b797d, 0x9da797, 0x9b8c81];
  const plain = data.parts.map(({ mesh, transparent }) => surfaceMaterial(colors[mesh % colors.length], transparent));
  const highlighted = surfaceMaterial(0xff8b42);
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x243c3f, transparent: true, opacity: 0.72 });
  const objects = data.parts.map((part, i) => {
    const { surface, edges } = drawing[part.mesh];
    const solid = new THREE.Mesh(surface, plain[i]);
    solid.add(new THREE.LineSegments(edges, edgeMaterial));
    scene.add(solid);
    return solid;
  });
  const camera = new THREE.OrthographicCamera();
  const direction = new THREE.Vector3(1, 1, 1).normalize();
  const world = new THREE.Box3();
  const projected = new THREE.Box3();
  const point = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const axes = new THREE.Matrix4().lookAt(direction, new THREE.Vector3(), camera.up).invert();
  for (const stage of data.stages) {
    data.parts.forEach((part) => {
      const { min, max } = drawing[part.mesh].surface.boundingBox;
      const pose = stage.poses[part.id];
      rotation.fromArray(pose.rotation);
      for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
        point.set(x, y, z).applyQuaternion(rotation);
        point.x += pose.position[0]; point.y += pose.position[1]; point.z += pose.position[2];
        world.expandByPoint(point);
        projected.expandByPoint(point.applyMatrix4(axes));
      }
    });
  }
  const center = world.getCenter(new THREE.Vector3());
  const radius = Math.max(1, projected.getSize(new THREE.Vector3()).length() / 2);
  camera.position.copy(center).addScaledVector(direction, radius * 2);
  camera.near = radius * 0.5;
  camera.far = radius * 4;
  camera.lookAt(center);
  camera.updateMatrixWorld();
  const viewCenter = projected.getCenter(new THREE.Vector3()).sub(center.clone().applyMatrix4(axes));
  const viewSize = projected.getSize(new THREE.Vector3());

  const rows = new Map();
  let activeItem;
  for (const row of data.bom) {
    const button = document.createElement('button');
    button.className = 'bom-row';
    button.dataset.item = row.item;
    button.setAttribute('aria-pressed', 'false');
    const item = document.createElement('span');
    item.className = 'bom-num';
    item.textContent = row.item.padStart(2, '0');
    const name = document.createElement('span');
    name.textContent = row.name;
    if (row.partNo) {
      const partNo = document.createElement('span');
      partNo.className = 'part-no';
      partNo.textContent = row.partNo;
      name.append(partNo);
    }
    const quantity = document.createElement('span');
    quantity.textContent = `× ${row.qty}`;
    button.append(item, name, quantity);
    button.addEventListener('click', () => select(activeItem === row.item ? undefined : row.item));
    element('bom').append(button);
    rows.set(row.item, button);
  }

  function draw() { renderer.render(scene, camera); }

  function select(item, part) {
    activeItem = item;
    for (const [row, button] of rows) button.setAttribute('aria-pressed', String(row === item));
    objects.forEach((solid, i) => { solid.material = item && data.parts[i].item === item ? highlighted : plain[i]; });
    const row = data.bom.find((entry) => entry.item === item);
    const shown = row ? data.parts.filter((entry) => entry.item === item).length : 0;
    element('selection').textContent = row ? `${part ? `${part.label} · ` : ''}${labels.selection.replace(/\{(shown|total|name)\}/g, (_, key) => ({ shown, total: row.qty, name: row.name })[key])}` : part?.label ?? '';
    draw();
  }

  let index = 0;
  function show(target) {
    index = target;
    const { name, poses } = data.stages[index];
    data.parts.forEach((part, i) => {
      objects[i].position.fromArray(poses[part.id].position);
      objects[i].quaternion.fromArray(poses[part.id].rotation);
    });
    element('previous').disabled = index === 0;
    element('reset').disabled = index === 0;
    element('next').disabled = index === data.stages.length - 1;
    element('stage-name').textContent = index ? `${index} / ${data.stages.length - 1}` : labels.assembled;
    element('movement').textContent = index ? name : '';
    draw();
  }

  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const halfHeight = Math.max(viewSize.y / 2, viewSize.x / (2 * aspect)) * 1.2;
    camera.left = viewCenter.x - halfHeight * aspect;
    camera.right = viewCenter.x + halfHeight * aspect;
    camera.bottom = viewCenter.y - halfHeight;
    camera.top = viewCenter.y + halfHeight;
    camera.updateProjectionMatrix();
    draw();
  }

  const ray = new THREE.Raycaster();
  function pick(x, y) {
    const box = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(2 * (x - box.left) / box.width - 1, 1 - 2 * (y - box.top) / box.height), camera);
    const hit = ray.intersectObjects(objects, false)[0];
    return hit ? data.parts[objects.indexOf(hit.object)] : undefined;
  }
  canvas.addEventListener('click', ({ clientX, clientY }) => {
    const part = pick(clientX, clientY);
    select(part?.item, part);
  });
  element('previous').onclick = () => show(index - 1);
  element('next').onclick = () => show(index + 1);
  element('reset').onclick = () => show(0);
  show(0);
  resize();
  new ResizeObserver(resize).observe(canvas);

  // The acceptance script reads the transforms and materials of the actual rendered scene.
  window.fixtureView = {
    poses: () => Object.fromEntries(data.parts.map(({ id }, i) => [id, { position: objects[i].position.toArray(), rotation: objects[i].quaternion.toArray() }])),
    highlighted: () => data.parts.filter((_, i) => objects[i].material === highlighted).map(({ id }) => id),
    visiblePoint(item) {
      const box = canvas.getBoundingClientRect();
      for (let y = Math.ceil(box.top) + 4; y < box.bottom - 4; y += 3) {
        for (let x = Math.ceil(box.left) + 4; x < box.right - 4; x += 3) {
          const part = pick(x, y);
          if (part?.item === item && [[-1, 0], [1, 0], [0, -1], [0, 1]].every(([dx, dy]) => pick(x + dx, y + dy) === part)) return { x, y };
        }
      }
    },
  };
}

try {
  start();
} catch (error) {
  canvas.hidden = true;
  element('error').textContent = labels.webgl;
  for (const button of document.querySelectorAll('nav button')) button.disabled = true;
  throw error;
}
