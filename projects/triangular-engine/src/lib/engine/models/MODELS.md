[Back to Engine Documentation](../ENGINE.md);

# Project Models Documentation

This document provides an overview of the models used in the project. Each model is responsible for managing specific aspects of the application, such as cursor handling, engine operations, frame rate control, and user interface configurations.

## Directory Structure

```
models/
├── cursor.model.ts
├── engine.model.ts
├── fps.controller.ts
├── index.ts
├── key-binding-options.ts
├── object-3d.model.ts
└── user-interface.model.ts
```

## File Descriptions

### `cursor.model.ts`

**Purpose:**  
Manages the cursor's position and movement relative to the canvas.

**Key Components:**

- **`Cursor` Class:**
  - Tracks both pixel (`x`, `y`) and normalized (`axisX`, `axisY`) cursor positions.
  - Subscribes to mouse movement events from the engine to update cursor positions.
  - Emits normalized position changes through `normalizedPosition$`.

### `engine.model.ts`

**Purpose:**  
Defines the core engine interfaces and classes responsible for rendering, scene management, and handling user inputs.

**Key Components:**

- **`IEngineOptions` Interface:**  
  Configures engine settings such as FPS display, transparency, and rendering parameters.
- **`IEngineLifecycle` Interface:**  
  Manages the engine's lifecycle events like initialization, destruction, and playback controls.
- **`IEngineCamera` Interface:**  
  Handles camera operations, allowing switching between different camera views.
- **`IEngineCore` Interface:**  
  Core functionalities including canvas management, rendering setup, scene and clock management, and cursor integration.
- **`IEngineInput` Interface:**  
  Captures and manages various user input events like keyboard and mouse interactions.
- **`IEngine` Interface:**  
  Combines `IEngineCore`, `IEngineLifecycle`, and `IEngineInput` to represent the complete engine functionality.

### `fps.controller.ts`

**Purpose:**  
Controls and monitors the frames per second (FPS) of the rendering engine.

**Key Components:**

- **`FPSController` Class:**
  - Tracks the number of frames rendered each second.
  - Updates the displayed FPS count and maintains a graph of FPS over time.
  - Subscribes to the engine's tick events to calculate FPS.

### `index.ts`

**Purpose:**  
Exports all models for easy import elsewhere in the application.

**Exports:**

- `object-3d.model`
- `engine.model`
- `fps.controller`
- `cursor.model`
- `key-binding-options`
- `user-interface.model`

### `key-binding-options.ts`

**Purpose:**  
Defines the structure for configuring key bindings within the application.

**Key Components:**

- **`IKeyBindingOptions` Interface:**
  - Specifies the keys to listen for and the corresponding action (`keydown` handler) to execute when those keys are pressed.

**Example Usage:**

```typescript
// [keyBindings]="{
    'Open Menu': {
      keys: ['Escape', 'm','p'],
      keydown: toggleMenu($event)
    }
  }"
```

### `object-3d.model.ts`

**Purpose:**  
Defines types related to 3D objects used within the engine.

**Key Components:**

- **`xyz` Type:**
  - Represents a 3D coordinate as a tuple `[number, number, number]`.

### `user-interface.model.ts`

**Purpose:**  
Configures user interface options for the application.

**Key Components:**

- **`IUserInterfaceOptions` Interface:**
  - Options to show or hide UI elements like stats and scene tree.
  - Allows defining templates for different UI sections (`top`, `bottom`, `left`, `right`, `main`).

## Summary

The `models` directory encapsulates the core functionalities of the application, including engine operations, cursor management, frame rate control, key bindings, 3D object definitions, and user interface configurations. By modularizing these components, the project ensures maintainability and scalability.
