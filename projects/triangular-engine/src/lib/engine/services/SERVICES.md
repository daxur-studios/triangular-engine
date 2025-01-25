[Back to Engine Documentation](../ENGINE.md);

## EngineService Documentation

The `EngineService` is a core service within the application responsible for managing the Three.js rendering engine and facilitating interactions with the 3D scene. It encapsulates complex rendering logic, optimizes performance, and provides a structured interface for developers to integrate 3D graphics into Angular applications.

### Key Responsibilities:

- **Scene Initialization:** Instantiates and configures the Three.js scene, providing a foundation for adding objects and defining the 3D environment.
- **Camera Management:** Handles camera creation, controls, and updates, enabling developers to control the viewpoint and perspective within the 3D scene.
- **Rendering Loop:** Implements and manages the rendering loop, ensuring continuous updates to the scene and smooth animation.
- **Input Handling:** Captures and broadcasts user input events, such as keyboard, mouse, and touch interactions, facilitating user interaction with the 3D scene.
- **Performance Optimization:** Employs techniques like WebGLRenderer configuration, pixel ratio adjustment, and FPS limiting to optimize rendering performance and maintain a consistent frame rate.
- **Lifecycle Management:** Provides lifecycle hooks for initialization, play/pause control, and destruction, enabling developers to manage resources and synchronize with the Angular component lifecycle.

### Key Features:

- **Injectable Service:** Designed as an injectable Angular service, promoting modularity and reusability across components.
- **Configurable Options:** Allows customization of rendering parameters, such as WebGLRenderer settings and initial scene properties.
- **Observable-based Events:** Exposes observables for key events like tick, resize, and user input, enabling reactive programming patterns.
- **OrbitControls Integration:** Provides seamless integration with Three.js OrbitControls, enabling intuitive camera navigation.
- **CSS2DRenderer Support:** Facilitates the use of CSS2DRenderer for overlaying HTML elements on the 3D scene.

### Usage:

1. **Dependency Injection:** Inject the `EngineService` into the desired Angular component.
2. **Scene Access:** Utilize the `engineService.scene` property to add objects, lights, and other elements to the 3D scene.
3. **Camera Control:** Employ the `engineService.camera$` observable to access and manipulate the camera, or leverage the built-in `switchToOrbitControls` method for user-controlled navigation.
4. **Event Handling:** Subscribe to the service's observables, such as `tick$`, `keydown$`, and `mousemove$`, to respond to rendering updates and user interactions.

By encapsulating and managing these core functionalities, the `EngineService` simplifies the development of 3D applications within an Angular framework, allowing developers to focus on creating compelling 3D experiences.
