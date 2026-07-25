# triangular-engine/scatter

Deterministic, streamed environment scattering for terrain vegetation, rocks,
billboards, and other repeated scene objects.

Import scatter APIs from `triangular-engine/scatter`; do not reach into the
package's internal folders.

Scatter is renderer- and physics-optional. Consumers provide layer
definitions, suitability rules, and assets; the library keeps placement
deterministic as cells stream and LODs change.

Current API decisions and implementation status are tracked in
[`docs/runbook/005_scatter_sublibrary.md`](../../../docs/runbook/005_scatter_sublibrary.md).
