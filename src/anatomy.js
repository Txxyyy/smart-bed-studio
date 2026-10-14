import * as THREE from 'three';
import { DIMENSIONS } from './dimensions.js';

export const ANATOMY_LAYERS = [
  {
    id: 'comfort',
    label: '面料舒适层',
    english: 'QUILTED COMFORT',
    color: '#e8ded0',
    offset: 0.76,
    anchor: [0.76, 0.23, 0.35],
  },
  {
    id: 'airbag',
    label: '分区气囊层',
    english: 'ADAPTIVE AIR SUPPORT',
    color: '#71c6bf',
    offset: 0.39,
    anchor: [0.68, 0.15, 0.6],
  },
  {
    id: 'foundation',
    label: '基础承托层',
    english: 'FOAM FOUNDATION',
    color: '#cdbf9d',
    offset: 0.07,
    anchor: [0.76, 0.045, 0.45],
  },
];

export function createAnatomy({ root, library, softBox, soft, airGroup, innerFoam }) {
  const entries = Object.fromEntries(
    ANATOMY_LAYERS.map((meta) => {
      const group = meta.id === 'airbag' ? airGroup : new THREE.Group();
      group.name = `Anatomy_${meta.id}`;
      if (meta.id !== 'airbag') root.add(group);
      return [meta.id, { ...meta, group }];
    }),
  );
  const top = softBox(
    DIMENSIONS.width,
    0.048,
    DIMENSIONS.length,
    0.21,
    [
      library.get('side'),
      library.get('side'),
      library.get('fabric'),
      library.get('side'),
      library.get('side'),
      library.get('side'),
    ],
    entries.comfort.group,
    'Comfort_Layer',
  );
  top.userData.anatomyLayer = 'comfort';
  top.userData.explodeOffset = entries.comfort.offset;
  soft.push(top);
  innerFoam.material = library.get('foam');
  entries.foundation.group.add(innerFoam);
  innerFoam.userData.anatomyLayer = 'foundation';
  innerFoam.userData.explodeOffset = entries.foundation.offset;
  innerFoam.userData.inflate = false;
  return { entries, layers: ANATOMY_LAYERS };
}
