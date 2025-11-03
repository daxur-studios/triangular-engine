import { EventEmitter } from '@angular/core';
import { Jolt } from '../jolt-physics/jolt-physics.service';

/**
 * Contact event interfaces for Jolt Physics contact listener callbacks.
 * These interfaces define the data emitted by rigid body contact events.
 */

export interface IContactValidateEvent {
  /** The other body involved in the contact */
  otherBody: Jolt.Body;
  /** Base offset for the collision */
  baseOffset: number;
  /** Collision shape result containing detailed collision information */
  collideShapeResult: Jolt.CollideShapeResult;
}

export interface IContactAddedEvent {
  /** The other body involved in the contact */
  otherBody: Jolt.Body;
  /** Contact manifold containing collision geometry data */
  manifold: Jolt.ContactManifold;
  /** Contact settings that can be modified to affect the collision response */
  settings: Jolt.ContactSettings;
}

export interface IContactPersistedEvent {
  /** The other body involved in the contact */
  otherBody: Jolt.Body;
  /** Contact manifold containing collision geometry data */
  manifold: Jolt.ContactManifold;
  /** Contact settings that can be modified to affect the collision response */
  settings: Jolt.ContactSettings;
}

export interface IContactRemovedEvent {
  /** Sub-shape ID pair identifying the specific shapes that were in contact */
  subShapePair: Jolt.SubShapeIDPair;
  /** The other body involved in the contact */
  otherBody: Jolt.Body;
}

/**
 * Event emitter for Jolt Physics contact events, only running calculations if there are subscribers.
 */
export class JoltEventEmitter<T> extends EventEmitter<T> {
  hasSubscribers = false;

  override subscribe(generatorOrNext?: any, error?: any, complete?: any): any {
    this.hasSubscribers = true;
    return super.subscribe(generatorOrNext, error, complete);
  }
}
