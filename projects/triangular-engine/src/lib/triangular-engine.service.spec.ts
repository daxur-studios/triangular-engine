import { TestBed } from '@angular/core/testing';

import { TriangularEngineService } from './triangular-engine.service';

describe('TriangularEngineService', () => {
  let service: TriangularEngineService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TriangularEngineService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
