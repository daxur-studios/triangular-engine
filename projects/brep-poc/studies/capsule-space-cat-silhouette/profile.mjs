// Print the side profile of the loft so shape changes can be checked as
// numbers, not only as images. Run with: node profile.mjs [headRise]
import { sectionAt } from '../../src/app/part/capsule-space-cat-silhouette.brep.ts';

const headRise = Number(process.argv[2] ?? 30);
const ys = [-728, -700, -650, -600, -550, -506, -470, -436, -400, -360, -320, -300, -260, -220, -180, -140, -96, 0, 120, 235];
console.log(`headRise ${headRise}`);
console.log('y'.padStart(6), 'top'.padStart(8), 'bottom'.padStart(8), 'width'.padStart(8));
for (const y of ys) {
  const s = sectionAt(y, { headRise, cheekFullness: 115, blendLength: 340 });
  console.log(
    String(y).padStart(6),
    (s.z + s.height).toFixed(1).padStart(8),
    (s.z - s.height).toFixed(1).padStart(8),
    s.width.toFixed(1).padStart(8),
  );
}
const crown = sectionAt(-436, { headRise, cheekFullness: 115, blendLength: 340 });
const shoulder = sectionAt(-96, { headRise, cheekFullness: 115, blendLength: 340 });
console.log('back drop crown -> shoulder:', ((crown.z + crown.height) - (shoulder.z + shoulder.height)).toFixed(1), 'mm');

// Continuity: the outline must not step where the branches meet.
for (const edge of [-436, -96]) {
  const a = sectionAt(edge - 0.5, { headRise, cheekFullness: 115, blendLength: 340 });
  const b = sectionAt(edge + 0.5, { headRise, cheekFullness: 115, blendLength: 340 });
  console.log(
    `step at y=${edge}: top ${(b.z + b.height - (a.z + a.height)).toFixed(2)} mm,`,
    `bottom ${(b.z - b.height - (a.z - a.height)).toFixed(2)} mm,`,
    `width ${(b.width - a.width).toFixed(2)} mm`,
  );
}
