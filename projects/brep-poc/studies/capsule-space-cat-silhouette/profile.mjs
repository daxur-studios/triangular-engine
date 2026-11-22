// Print the tube body's key numbers so length changes can be checked without
// opening a render. Run with: node profile.mjs [bodyLength]
import { params, rearTip, silhouetteExtents } from '../../src/app/part/capsule-space-cat-tube.brep.ts';

const bodyLength = Number(process.argv[2] ?? params.values.bodyLength);
const values = { ...params.values, bodyLength };
const extents = silhouetteExtents(values);
const rear = rearTip(values);

console.log(`bodyLength ${bodyLength} mm · tube radius ${values.tubeRadius} mm · head rise ${values.headRise} mm`);
console.log('rear tip      ', rear.toFixed(0), 'mm (tail base sits near +340)');
console.log('nose          ', '-727 mm');
console.log('total length  ', (rear + 727).toFixed(0), 'mm');
console.log('height        ', (extents.top - extents.bottom).toFixed(0), 'mm');
console.log('ratio         ', ((rear + 727) / (extents.top - extents.bottom)).toFixed(2));
console.log('crown / belly ', extents.top.toFixed(0), '/', extents.bottom.toFixed(0), 'mm');
console.log('head above the tube', (extents.top - (values.tubeRadius)).toFixed(0), 'mm');
