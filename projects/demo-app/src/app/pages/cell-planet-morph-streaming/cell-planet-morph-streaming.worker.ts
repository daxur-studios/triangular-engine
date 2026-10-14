/// <reference lib="webworker" />

import { buildCellBorderLineGeometry } from 'triangular-engine/worldgen/render';
import {
  handleCellPlanetWorkerMessage,
  type CellPlanetCellGridPayload,
  type CellPlanetCellGridWorkerRequest,
  type CellPlanetCellLookupWorkerRequest,
  type CellPlanetMaterialTileWorkerRequest,
  type CellPlanetMeshWorkerRequest,
  type CellPlanetWorkerMessage,
  type CellPlanetWorkerTiming,
  type ICellPlanetMaterialTilePayload,
} from 'triangular-engine/worldgen/render/core';

export type CellPlanetMorphWorkerRequest = CellPlanetMeshWorkerRequest;
export type CellPlanetMorphMaterialTileRequest = CellPlanetMaterialTileWorkerRequest;
export type CellPlanetMorphCellLookupRequest = CellPlanetCellLookupWorkerRequest;
export type CellPlanetMorphCellGridRequest = CellPlanetCellGridWorkerRequest;
export type CellPlanetMorphCellGridPayload = CellPlanetCellGridPayload;
export type CellPlanetMorphMaterialTilePayload = ICellPlanetMaterialTilePayload;
export type CellPlanetMorphWorkerTimings = CellPlanetWorkerTiming;
export type CellPlanetMorphWorkerMessage = CellPlanetWorkerMessage;

addEventListener('message', async ({ data }: MessageEvent<CellPlanetWorkerMessage>) => {
  const { response, transfer } = await handleCellPlanetWorkerMessage(data, {
    buildCellBorderGeometry: buildCellBorderLineGeometry,
  });
  postMessage(response, transfer);
});
