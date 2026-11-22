import { Fn, float, mix, transformNormalToView, uniform, uv, varying, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu';

type ScalarNode = Node<'float'>;

/** Sweeps a blunt, elliptical clay lock from the crown to an adjustable hem. */
export function createBobLockMaterial() {
  const material = new MeshStandardNodeMaterial({ color: '#4b3429', roughness: .63 });
  const hemDrop = uniform(0);
  const tipStart = .91;

  const center = Fn(([t]: [ScalarNode]) => {
    const root = vec3(.52, 4.09, .46);
    const crown = vec3(1.31, 4.28, .64);
    const side = vec3(1.50, 3.32, .65);
    const hem = vec3(1.37, .83, .56);
    const middle = mix(crown, side, t);
    const guide = mix(mix(mix(root, crown, t), middle, t), mix(middle, mix(side, hem, t), t), t);
    // Leave the crown and its tangents fixed. All length change happens below it.
    return guide.sub(vec3(0, hemDrop.mul(t.smoothstep(.42, 1)), 0));
  });

  const surface = Fn(([t, theta]: [ScalarNode, ScalarNode]) => {
    const tangent = center(t.add(.001)).sub(center(t.sub(.001))).normalize();
    const widthAxis = tangent.cross(vec3(.93, 0, .37)).normalize();
    const outside = widthAxis.cross(tangent);
    const tip = t.sub(tipStart).div(1 - tipStart).clamp(0, 1);
    const rolloff = float(1).sub(tip.mul(tip)).max(0).sqrt();
    const radius = t.smoothstep(0, .13).mul(rolloff);
    const width = mix(float(.37), float(.29), t).mul(radius);
    const depth = mix(float(.25), float(.20), t).mul(radius);
    return center(t).add(outside.mul(theta.cos().mul(depth))).add(widthAxis.mul(theta.sin().mul(width)));
  });

  // Concentrate grid rows around the end cap so the silhouette stays rounded.
  const capStart = .8;
  const axial = uv().y;
  const capAngle = axial.sub(capStart).max(0).mul((Math.PI / 2) / (1 - capStart));
  const progress = axial.min(capStart).mul(tipStart / capStart).add(capAngle.sin().mul(1 - tipStart));
  const angle = uv().x.mul(Math.PI * 2);
  material.positionNode = surface(progress, angle);
  // Light the swept surface using its own tangents, including the rounded tip.
  const t = progress.clamp(.002, .998);
  const around = surface(t, angle.add(.01)).sub(surface(t, angle.sub(.01)));
  const along = surface(t.add(.001), angle).sub(surface(t.sub(.001), angle));
  const surfaceNormal = around.cross(along).normalize();
  material.normalNode = varying(transformNormalToView(surfaceNormal)).normalize();

  return { material, hemDrop };
}
