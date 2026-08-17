import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  CATEGORIES,
  DEMOS,
  DemoIndexComponent,
} from './demo-index.component';

describe('DemoIndexComponent', () => {
  let component: DemoIndexComponent;
  let fixture: ComponentFixture<DemoIndexComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DemoIndexComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(DemoIndexComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should have all 39 demos and 7 categories configured', () => {
    expect(DEMOS.length).toBe(39);
    expect(CATEGORIES.length).toBe(7);
    expect(component.totalDemosCount).toBe(39);
    expect(component.gemsCount).toBeGreaterThan(0);
    expect(component.labsCount).toBeGreaterThan(0);
    expect(component.archivedCount).toBeGreaterThan(0);
  });


  it('should compute entry-point tags with counts', () => {
    const tags = component.allTags();
    expect(tags.length).toBeGreaterThan(0);

    const animalsTag = tags.find((t) => t.tag === 'animals');
    expect(animalsTag).toBeDefined();
    expect(animalsTag!.count).toBeGreaterThanOrEqual(5);

    const joltTag = tags.find((t) => t.tag === 'jolt');
    expect(joltTag).toBeDefined();
    expect(joltTag!.count).toBeGreaterThanOrEqual(8);
  });

  it('should filter demos by tier', () => {
    component.selectTier('gem');
    expect(component.selectedTier()).toBe('gem');
    const filtered = component.filteredDemos();
    expect(filtered.length).toBe(component.gemsCount);
    expect(filtered.every((d) => d.tier === 'gem')).toBeTrue();

    component.selectTier('archived');
    expect(component.filteredDemos().length).toBe(component.archivedCount);
    expect(component.filteredDemos().every((d) => d.tier === 'archived')).toBeTrue();
  });

  it('should filter demos by entry-point tag', () => {
    component.selectTag('animals');
    expect(component.selectedTag()).toBe('animals');
    const filtered = component.filteredDemos();
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((d) => d.entryPoints.includes('animals'))).toBeTrue();

    // Toggle off tag
    component.selectTag('animals');
    expect(component.selectedTag()).toBe('all');
  });

  it('should filter demos by category', () => {
    component.selectCategory('water');
    expect(component.selectedCategory()).toBe('water');
    const filtered = component.filteredDemos();
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((d) => d.categoryId === 'water')).toBeTrue();
  });

  it('should search demos across title, description, and tags', () => {
    component.setSearchQuery('Gerstner');
    let filtered = component.filteredDemos();
    expect(filtered.length).toBeGreaterThan(0);
    expect(
      filtered.some((d) => d.title.includes('Water') || d.description.includes('Gerstner')),
    ).toBeTrue();

    component.setSearchQuery('boids');
    filtered = component.filteredDemos();
    expect(filtered.length).toBeGreaterThan(0);
    expect(
      filtered.some((d) => d.description.toLowerCase().includes('boids')),
    ).toBeTrue();
  });

  it('should detect when filters are active and clear them', () => {
    expect(component.hasActiveFilters()).toBeFalse();

    component.setSearchQuery('test');
    expect(component.hasActiveFilters()).toBeTrue();

    component.clearAllFilters();
    expect(component.hasActiveFilters()).toBeFalse();
    expect(component.searchQuery()).toBe('');
    expect(component.selectedTier()).toBe('all');
    expect(component.selectedCategory()).toBe('all');
    expect(component.selectedTag()).toBe('all');
  });

  it('should group filtered demos into category sections', () => {
    const groups = component.categoryGroups();
    expect(groups.length).toBe(7);
    expect(groups.every((g) => g.demos.length > 0)).toBeTrue();
  });
});
