import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { BehaviorSubject } from 'rxjs';
import { EngineModule } from '../../../engine.module';
import { GroupComponent } from '../../../components/object-3d/group.component';
import { provideObject3DComponent } from '../../../components/object-3d/object-3d.component';
import {
  addToScene,
  createFloor,
  getRandomQuat,
  LAYER_MOVING,
} from '../example';
import { JoltPhysicsModule } from '../jolt-physics.module';
import { JoltPhysicsComponent } from '../jolt-physics/jolt-physics.component';
import { Jolt } from '../jolt-physics/jolt-physics.service';

interface IRandomBody {
  id: string;
}

@Component({
  selector: 'joltFountain',
  imports: [JoltPhysicsModule, EngineModule],
  templateUrl: './jolt-fountain.component.html',
  styleUrl: './jolt-fountain.component.scss',
  providers: [provideObject3DComponent(JoltFountainComponent)],
})
export class JoltFountainComponent extends GroupComponent {
  readonly joltPhysicsComponent = inject(JoltPhysicsComponent);

  readonly bodies$ = new BehaviorSubject<IRandomBody[]>([]);

  constructor() {
    super();
    this.#initAsync();
  }

  async #initAsync() {
    const metaData = await this.joltPhysicsComponent.metaDataPromise;
    const scene = this.engineService.scene;

    const x = metaData.Jolt;

    let time = 0;
    // Spawning variables
    var objectTimePeriod = 0.25;
    var timeNextSpawn = time + objectTimePeriod;
    var maxNumObjects = 100;

    // Initialize this example

    // Create a basic floor

    const generateObject = () => {
      let numTypes = 10;
      let objectType = Math.ceil(Math.random() * numTypes);

      let shape: Jolt.Shape;

      let colors = [
        0xff0000, 0xd9b1a3, 0x4d4139, 0xccad33, 0xf2ff40, 0x00ff00, 0x165943,
        0x567371, 0x80d5ff, 0x69778c, 0xbeb6f2, 0x7159b3, 0x73004d, 0xd90074,
        0xff8091, 0xbf3030, 0x592400, 0xa66c29, 0xb3aa86, 0x296600, 0x00e600,
        0x66ccaa, 0x00eeff, 0x3d9df2, 0x000e33, 0x3d00e6, 0xb300a7, 0xff80d5,
        0x330d17, 0x59332d, 0xff8c40, 0x33210d, 0x403c00, 0x89d96c, 0x0d3312,
        0x0d3330, 0x005c73, 0x0066ff, 0x334166, 0x1b0066, 0x4d3949, 0xbf8faf,
        0x59000c, 0x0000ff,
      ];

      switch (objectType) {
        case 1: {
          // Sphere
          let radius = 0.5 + Math.random();
          shape = new x.SphereShape(radius, undefined);
          break;
        }

        case 2: {
          // Box
          let sx = 1 + Math.random();
          let sy = 1 + Math.random();
          let sz = 1 + Math.random();
          shape = new x.BoxShape(
            new x.Vec3(sx * 0.5, sy * 0.5, sz * 0.5),
            0.05,
            undefined,
          );
          break;
        }

        case 3: {
          // Cylinder
          let radius = 0.5 + Math.random();
          let halfHeight = 0.5 + 0.5 * Math.random();
          shape = new x.CylinderShape(halfHeight, radius, 0.05, undefined);
          break;
        }

        case 4: {
          // Tapered cylinder
          let topRadius = 0.1 + Math.random();
          let bottomRadius = 0.5 + Math.random();
          let halfHeight = 0.5 * (topRadius + bottomRadius + Math.random());
          shape = new x.TaperedCylinderShapeSettings(
            halfHeight,
            topRadius,
            bottomRadius,
            undefined,
          )
            .Create()
            .Get();
          break;
        }

        case 5: {
          // Capsule
          let radius = 0.5 + Math.random();
          let halfHeight = 0.5 + 0.5 * Math.random();
          shape = new x.CapsuleShape(halfHeight, radius, undefined);
          break;
        }

        case 6: {
          // Tapered capsule
          let topRadius = 0.1 + Math.random();
          let bottomRadius = 0.5 + Math.random();
          let halfHeight = 0.5 * (topRadius + bottomRadius + Math.random());
          shape = new x.TaperedCapsuleShapeSettings(
            halfHeight,
            topRadius,
            bottomRadius,
            undefined,
          )
            .Create()
            .Get();
          break;
        }

        case 7: {
          // Convex hull
          let hull = new x.ConvexHullShapeSettings();
          for (let p = 0; p < 10; ++p)
            hull.mPoints.push_back(
              new x.Vec3(
                -0.5 + 2 * Math.random(),
                -0.5 + 2 * Math.random(),
                -0.5 + 2 * Math.random(),
              ),
            );
          shape = hull.Create().Get();
          break;
        }

        case 8: {
          // Static compound shape
          let shapeSettings = new x.StaticCompoundShapeSettings();
          let l = 1.0 + Math.random();
          let r2 = 0.5 + 0.5 * Math.random();
          let r1 = 0.5 * r2;
          shapeSettings.AddShape(
            new x.Vec3(-l, 0, 0),
            x.Quat.prototype.sIdentity(),
            new x.SphereShapeSettings(r2),
            undefined!,
          );
          shapeSettings.AddShape(
            new x.Vec3(l, 0, 0),
            x.Quat.prototype.sIdentity(),
            new x.SphereShapeSettings(r2),
            undefined!,
          );
          shapeSettings.AddShape(
            new x.Vec3(0, 0, 0),
            x.Quat.prototype.sRotation(new x.Vec3(0, 0, 1), 0.5 * Math.PI),
            new x.CapsuleShapeSettings(l, r1),
            undefined!,
          );
          shape = shapeSettings.Create().Get();
          break;
        }

        case 9: {
          // Mutable compound shape
          let shapeSettings = new x.MutableCompoundShapeSettings();
          let l = 1.0 + Math.random();
          let r2 = 0.5 + 0.5 * Math.random();
          let r1 = 0.5 * r2;
          shapeSettings.AddShape(
            new x.Vec3(-l, 0, 0),
            x.Quat.prototype.sIdentity(),
            new x.SphereShapeSettings(r2),
            undefined!,
          );
          shapeSettings.AddShape(
            new x.Vec3(l, 0, 0),
            x.Quat.prototype.sIdentity(),
            new x.BoxShapeSettings(x.Vec3.prototype.sReplicate(r2)),
            undefined!,
          );
          shapeSettings.AddShape(
            new x.Vec3(0, 0, 0),
            x.Quat.prototype.sRotation(new x.Vec3(0, 0, 1), 0.5 * Math.PI),
            new x.CapsuleShapeSettings(l, r1),
            undefined!,
          );
          shape = shapeSettings.Create().Get();
          break;
        }

        case 10: {
          // Sphere with COM offset
          let radius = 0.5;
          shape = new x.OffsetCenterOfMassShapeSettings(
            new x.Vec3(0, -0.1 * radius, 0),
            new x.SphereShapeSettings(radius, undefined),
          )
            .Create()
            .Get();
          break;
        }
      }

      // Position and rotate body
      let pos = new x.RVec3(
        (Math.random() - 0.5) * 25,
        15,
        (Math.random() - 0.5) * 25,
      );
      let rot = getRandomQuat();

      // Create physics body
      let creationSettings = new x.BodyCreationSettings(
        shape!,
        pos,
        rot,
        x.EMotionType_Dynamic,
        LAYER_MOVING,
      );
      creationSettings.mRestitution = 0.5;

      // Disable default damping
      creationSettings.mAngularDamping = 0.0;
      creationSettings.mLinearDamping = 0.0;
      let body = metaData.bodyInterface.CreateBody(creationSettings);
      Jolt.destroy(creationSettings);

      addToScene(
        this.joltPhysicsComponent.dynamicObjects,
        metaData.bodyInterface,
        scene,
        body,
        colors[objectType - 1],
      );
    };

    const onUpdate = (time: number) => {
      // Check if its time to spawn a new object
      if (
        this.joltPhysicsComponent.dynamicObjects.length < maxNumObjects &&
        time > timeNextSpawn
      ) {
        generateObject();
        timeNextSpawn = time + objectTimePeriod;
      }
    };

    this.engineService.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((deltaTime) => {
        time += deltaTime;
        //renderExampleTick(tick);
        onUpdate(time);
      });
  }
}
