import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TriangularEngineComponent } from './triangular-engine.component';

describe('TriangularEngineComponent', () => {
  let component: TriangularEngineComponent;
  let fixture: ComponentFixture<TriangularEngineComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TriangularEngineComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TriangularEngineComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
