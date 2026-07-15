import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-demo-index',
  imports: [RouterLink],
  templateUrl: './demo-index.component.html',
  styleUrl: './demo-index.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoIndexComponent {}
