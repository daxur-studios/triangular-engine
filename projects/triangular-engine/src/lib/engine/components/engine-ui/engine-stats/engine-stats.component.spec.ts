import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EngineStatsComponent } from './engine-stats.component';
import { EngineService, provideTriangularEngine } from '../../../services';
import { Scene } from 'three';

describe('EngineStatsComponent', () => {
  let component: EngineStatsComponent;
  let fixture: ComponentFixture<EngineStatsComponent>;
  let engineService: EngineService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EngineStatsComponent],
      providers: [provideTriangularEngine({ showFPS: true })],
    }).compileComponents();

    fixture = TestBed.createComponent(EngineStatsComponent);
    component = fixture.componentInstance;
    engineService = TestBed.inject(EngineService);
    fixture.detectChanges();
  });

  it('creates the component and starts collapsed', () => {
    expect(component).toBeTruthy();
    expect(component.expanded()).toBeFalse();
  });

  it('toggles expanded state', () => {
    component.toggleExpanded();
    expect(component.expanded()).toBeTrue();

    component.toggleExpanded();
    expect(component.expanded()).toBeFalse();
  });

  it('renders telemetry-sparkline and copy button when expanded', () => {
    component.expanded.set(true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const sparkline = compiled.querySelector('telemetry-sparkline');
    expect(sparkline).toBeTruthy();

    const copyBtn = compiled.querySelector('.copy-agent-btn');
    expect(copyBtn).toBeTruthy();
  });

  it('copies telemetry for agent and triggers visual feedback', async () => {
    const clipboardSpy = spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.resolve());

    await component.copyTelemetryForAgent();

    expect(clipboardSpy).toHaveBeenCalled();
    expect(component.copyState()).toBe('copied');
  });

  it('reports failure instead of "copied" when no clipboard path works', async () => {
    spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.reject(new Error('denied')));
    spyOn(document, 'execCommand').and.returnValue(false);
    spyOn(console, 'warn');

    await component.copyTelemetryForAgent();

    expect(component.copyState()).toBe('failed');
  });

  it('falls back to execCommand when the Clipboard API rejects', async () => {
    spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.reject(new Error('denied')));
    const execSpy = spyOn(document, 'execCommand').and.returnValue(true);
    spyOn(console, 'warn');

    await component.copyTelemetryForAgent();

    expect(execSpy).toHaveBeenCalledWith('copy');
    expect(component.copyState()).toBe('copied');
  });

  it('formats large numbers cleanly', () => {
    expect(component.formatNumber(1500000)).toBe('1.50M');
    expect(component.formatNumber(25000)).toBe('25k');
    expect(component.formatNumber(42)).toBe('42');
  });
});
