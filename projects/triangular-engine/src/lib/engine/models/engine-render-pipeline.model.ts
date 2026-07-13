/** A renderer-independent owner of the engine's main scene render. */
export interface EngineRenderPipeline {
  /** Render one frame. Delta time is measured in seconds. */
  render(deltaTime: number): void;

  /** Update the pipeline's drawing-buffer dimensions and pixel ratio. */
  setSize(width: number, height: number, pixelRatio: number): void;
}
