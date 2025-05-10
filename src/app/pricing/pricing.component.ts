import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pricing.component.html',
  styleUrls: ['./pricing.component.scss']
})
export class PricingComponent {
  isAnnual = false;

  toggleBilling(): void {
    // Any additional logic when toggling between monthly and annual billing
    console.log('Billing toggled to:', this.isAnnual ? 'Annual' : 'Monthly');
  }
}
