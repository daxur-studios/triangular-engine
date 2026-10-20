import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TEST_RESULTS_FETCH } from 'triangular-engine/testing';
import { TestResultsPageComponent } from './test-results-page.component';

describe('TestResultsPageComponent', () => {
  it('hosts the results component and reads the runs from the dev receiver', async () => {
    const fetcher = jasmine.createSpy('fetch').and.callFake(async () => new Response(JSON.stringify({ runs: [] })));
    await TestBed.configureTestingModule({
      imports: [TestResultsPageComponent],
      providers: [provideRouter([]), { provide: TEST_RESULTS_FETCH, useValue: fetcher }],
    }).compileComponents();
    const fixture = TestBed.createComponent(TestResultsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('tri-test-results')).not.toBeNull();
    expect(fetcher.calls.mostRecent().args[0]).toBe('/__triangular-test-sink/runs?limit=300');
  });
});
