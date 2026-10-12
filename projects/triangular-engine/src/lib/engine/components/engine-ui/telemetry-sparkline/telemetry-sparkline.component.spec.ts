import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TelemetrySparklineComponent } from './telemetry-sparkline.component';

describe('TelemetrySparklineComponent', () => {
  let component: TelemetrySparklineComponent;
  let fixture: ComponentFixture<TelemetrySparklineComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TelemetrySparklineComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TelemetrySparklineComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component with empty bars initially', () => {
    expect(component).toBeTruthy();
    expect(component.bars().length).toBe(0);
  });

  it('computes bars with corresponding statuses based on threshold inputs', () => {
    fixture.componentRef.setInput('values', [60, 45, 20]);
    fixture.componentRef.setInput('motionTags', ['idle', 'rot', 'zoom']);
    fixture.detectChanges();

    const bars = component.bars();
    expect(bars.length).toBe(3);

    // 60 >= 55 -> good
    expect(bars[0].value).toBe(60);
    expect(bars[0].status).toBe('good');
    expect(bars[0].motionTag).toBe('idle');
    expect(bars[0].motionSymbol).toBe('·');

    // 45 < 55 and >= 30 -> warning
    expect(bars[1].value).toBe(45);
    expect(bars[1].status).toBe('warning');
    expect(bars[1].motionTag).toBe('rot');
    expect(bars[1].motionSymbol).toBe('R');

    // 20 < 30 -> critical
    expect(bars[2].value).toBe(20);
    expect(bars[2].status).toBe('critical');
    expect(bars[2].motionTag).toBe('zoom');
    expect(bars[2].motionSymbol).toBe('Z');
  });

  it('renders SVG elements and guidelines in the template', () => {
    fixture.componentRef.setInput('values', [58, 60, 59]);
    fixture.componentRef.setInput('width', 150);
    fixture.componentRef.setInput('height', 40);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const svg = compiled.querySelector('svg.sparkline-svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('width')).toBe('150');
    expect(svg?.getAttribute('height')).toBe('40');

    const rects = compiled.querySelectorAll('rect.spark-bar');
    expect(rects.length).toBe(3);

    const guidelines = compiled.querySelectorAll('line.guideline');
    expect(guidelines.length).toBe(2);
  });

  it('hides motion track when showMotionTrack is false', () => {
    fixture.componentRef.setInput('values', [60, 58]);
    fixture.componentRef.setInput('showMotionTrack', false);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const motionTrack = compiled.querySelector('.motion-track');
    expect(motionTrack).toBeNull();
  });
});
