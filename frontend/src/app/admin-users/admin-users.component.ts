import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { UserService, User } from '../services/user.service';
import { Router } from '@angular/router';
import { forkJoin, Subscription, throwError } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

declare var bootstrap: any; // For Bootstrap modal

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './admin-users.component.html',
  styleUrls: ['./admin-users.component.scss'],
})
export class AdminUsersComponent implements OnInit, OnDestroy {
  // Data
  users: User[] = [];
  filteredUsers: User[] = [];
  paginatedUsers: User[] = [];

  // Selected user for editing
  selectedUser: User | null = null;

  // States
  isLoading = true;
  isSaving = false;
  errorMessage = '';

  // Filter and sort
  searchTerm = '';
  filterRole = '';
  sortBy = 'name';
  sortDirection: 'asc' | 'desc' = 'asc';

  // Pagination
  currentPage = 1;
  pageSize = 10;
  totalPages = 1;

  // Forms
  addUserForm: FormGroup;
  editUserForm: FormGroup;

  // Selected users for bulk operations
  selectedUsers: string[] = [];

  // For template use
  Math = Math;

  // Subscriptions
  private subscriptions = new Subscription();

  constructor(
    private formBuilder: FormBuilder,
    private userService: UserService,
    private router: Router
  ) {
    // Initialize forms
    this.addUserForm = this.formBuilder.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      role: ['student'],
      emailVerified: [false],
    });

    this.editUserForm = this.formBuilder.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.minLength(6)]],
      role: ['student'],
      emailVerified: [false],
    });
  }

  ngOnInit(): void {
    this.loadUsers();

    // Listen for bootstrap modal events to reset forms
    this.setupModalListeners();
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.subscriptions.unsubscribe();
  }

  /**
   * Set up listeners for bootstrap modal events to reset forms
   */
  setupModalListeners(): void {
    if (typeof window !== 'undefined' && window.document) {
      const addUserModal = document.getElementById('addUserModal');
      if (addUserModal) {
        addUserModal.addEventListener('hidden.bs.modal', () => {
          this.addUserForm.reset({
            role: 'student',
            emailVerified: false,
          });
        });
      }

      const editUserModal = document.getElementById('editUserModal');
      if (editUserModal) {
        editUserModal.addEventListener('hidden.bs.modal', () => {
          this.selectedUser = null;
        });
      }
    }
  }

  /**
   * Load all users from the backend
   */
  loadUsers(): void {
    this.isLoading = true;
    this.errorMessage = '';

    const subscription = this.userService
      .listUsers(100) // Adjust limit as needed
      .pipe(
        catchError((error) => {
          this.errorMessage = error.message || 'Failed to load users';
          return throwError(() => error);
        }),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe({
        next: (response) => {
          this.users = response.users || [];
          this.applyFilters();
        },
      });

    this.subscriptions.add(subscription);
  }

  /**
   * Apply filters, sorting, and update pagination
   */
  applyFilters(): void {
    let result = [...this.users];

    // Apply role filter
    if (this.filterRole) {
      result = result.filter((user) => user.role === this.filterRole);
    }

    // Apply search
    if (this.searchTerm) {
      const search = this.searchTerm.toLowerCase().trim();
      result = result.filter(
        (user) =>
          user.name.toLowerCase().includes(search) ||
          user.email.toLowerCase().includes(search)
      );
    }

    // Apply sorting
    result.sort((a, b) => {
      let compareValue = 0;

      switch (this.sortBy) {
        case 'name':
          compareValue = a.name.localeCompare(b.name);
          break;
        case 'email':
          compareValue = a.email.localeCompare(b.email);
          break;
        case 'created_at':
          const aTime = a.created_at || 0;
          const bTime = b.created_at || 0;
          compareValue = aTime - bTime;
          break;
        default:
          compareValue = 0;
      }

      // Apply sort direction
      return this.sortDirection === 'asc' ? compareValue : -compareValue;
    });

    this.filteredUsers = result;
    this.totalPages = Math.ceil(this.filteredUsers.length / this.pageSize);

    // Reset to first page if current page exceeds total pages
    if (this.currentPage > this.totalPages) {
      this.currentPage = 1;
    }

    // Update paginated results
    this.updatePaginatedUsers();
  }

  /**
   * Update the paginated users list based on current page
   */
  updatePaginatedUsers(): void {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = Math.min(
      startIndex + this.pageSize,
      this.filteredUsers.length
    );
    this.paginatedUsers = this.filteredUsers.slice(startIndex, endIndex);
  }

  /**
   * Toggle sort direction and apply filters
   */
  toggleSortDirection(): void {
    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    this.applyFilters();
  }

  /**
   * Reset all filters to defaults
   */
  resetFilters(): void {
    this.searchTerm = '';
    this.filterRole = '';
    this.sortBy = 'name';
    this.sortDirection = 'asc';
    this.applyFilters();
  }

  /**
   * Set the current page for pagination
   */
  setPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) {
      return;
    }

    this.currentPage = page;
    this.updatePaginatedUsers();
  }

  /**
   * Get array of page numbers for pagination
   */
  getPageNumbers(): number[] {
    const pages: number[] = [];
    const maxVisiblePages = 5;

    if (this.totalPages <= maxVisiblePages) {
      // Show all pages if there are few
      for (let i = 1; i <= this.totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Show a window of pages centered around current page
      let startPage = Math.max(
        1,
        this.currentPage - Math.floor(maxVisiblePages / 2)
      );
      let endPage = startPage + maxVisiblePages - 1;

      if (endPage > this.totalPages) {
        endPage = this.totalPages;
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
      }

      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }
    }

    return pages;
  }

  /**
   * Get user initials for avatar
   */
  getUserInitials(user: User): string {
    if (!user.name) return '?';

    const nameParts = user.name.split(' ');
    if (nameParts.length === 1) {
      return nameParts[0].charAt(0).toUpperCase();
    }

    return (
      nameParts[0].charAt(0) + nameParts[nameParts.length - 1].charAt(0)
    ).toUpperCase();
  }

  /**
   * Get badge class based on role
   */
  getRoleBadgeClass(role: string): string {
    switch (role) {
      case 'admin':
        return 'admin-badge';
      case 'instructor':
        return 'instructor-badge';
      case 'student':
        return 'student-badge';
      default:
        return 'user-badge';
    }
  }

  /**
   * Get icon class based on role
   */
  getRoleIcon(role: string): string {
    switch (role) {
      case 'admin':
        return 'bi bi-shield-fill';
      case 'instructor':
        return 'bi bi-mortarboard-fill';
      case 'student':
        return 'bi bi-person-fill';
      default:
        return 'bi bi-person';
    }
  }

  /**
   * Select user for editing
   */
  editUser(user: User): void {
    this.selectedUser = { ...user };

    this.editUserForm.patchValue({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
      emailVerified: user.metadata?.emailVerified || false,
    });
  }

  /**
   * Add new user
   */
  addUser(): void {
    if (this.addUserForm.invalid) {
      // Mark all fields as touched to show validation errors
      Object.keys(this.addUserForm.controls).forEach((key) => {
        this.addUserForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isSaving = true;

    const newUser = {
      name: this.addUserForm.value.name,
      email: this.addUserForm.value.email,
      password: this.addUserForm.value.password,
      role: this.addUserForm.value.role,
      metadata: {
        emailVerified: this.addUserForm.value.emailVerified || false,
        createdBy: 'admin',
      },
    };

    const subscription = this.userService
      .register(newUser)
      .pipe(
        catchError((error) => {
          this.showErrorNotification(error.message || 'Failed to add user');
          return throwError(() => error);
        }),
        finalize(() => {
          this.isSaving = false;
        })
      )
      .subscribe({
        next: (user) => {
          // Add the new user to the local array
          this.users.push(user);
          this.applyFilters();

          // Show success notification
          this.showSuccessNotification(`User ${user.name} added successfully`);

          // Close modal
          this.closeModal('addUserModal');

          // Reset form (This is handled by our modal event listener)
        },
      });

    this.subscriptions.add(subscription);
  }

  /**
   * Update existing user
   */
  updateUser(): void {
    if (this.editUserForm.invalid || !this.selectedUser) {
      // Mark all fields as touched to show validation errors
      Object.keys(this.editUserForm.controls).forEach((key) => {
        this.editUserForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isSaving = true;

    const updateData: any = {
      name: this.editUserForm.value.name,
      email: this.editUserForm.value.email,
      role: this.editUserForm.value.role,
      metadata: {
        ...this.selectedUser.metadata,
        emailVerified: this.editUserForm.value.emailVerified,
      },
    };

    // Only include password if provided
    if (this.editUserForm.value.password) {
      updateData.password = this.editUserForm.value.password;
    }

    const subscription = this.userService
      .updateUser(this.selectedUser.user_id, updateData)
      .pipe(
        catchError((error) => {
          this.showErrorNotification(error.message || 'Failed to update user');
          return throwError(() => error);
        }),
        finalize(() => {
          this.isSaving = false;
        })
      )
      .subscribe({
        next: (user) => {
          // Update user in local array
          const index = this.users.findIndex((u) => u.user_id === user.user_id);
          if (index !== -1) {
            this.users[index] = user;
          }
          this.applyFilters();

          // Show success notification
          this.showSuccessNotification(
            `User ${user.name} updated successfully`
          );

          // Close modal
          this.closeModal('editUserModal');
        },
      });

    this.subscriptions.add(subscription);
  }

  /**
   * Confirm deletion with user
   */
  confirmDeleteUser(user: User): void {
    if (
      confirm(
        `Are you sure you want to delete ${user.name}? This action cannot be undone.`
      )
    ) {
      this.deleteUser(user);
    }
  }

  /**
   * Delete a user
   */
  deleteUser(user: User): void {
    const subscription = this.userService
      .deleteUser(user.user_id)
      .pipe(
        catchError((error) => {
          this.showErrorNotification(error.message || 'Failed to delete user');
          return throwError(() => error);
        })
      )
      .subscribe({
        next: () => {
          // Remove user from local array
          this.users = this.users.filter((u) => u.user_id !== user.user_id);

          // Also remove from selected users if present
          if (this.isUserSelected(user.user_id)) {
            this.selectedUsers = this.selectedUsers.filter(
              (id) => id !== user.user_id
            );
          }

          this.applyFilters();

          // Show success notification
          this.showSuccessNotification(
            `User ${user.name} deleted successfully`
          );
        },
      });

    this.subscriptions.add(subscription);
  }

  /**
   * Export users to CSV
   */
  exportUsers(): void {
    // Create CSV content
    let csvContent = 'Name,Email,Role,Status,Joined\n';

    this.filteredUsers.forEach((user) => {
      const status = user.metadata?.emailVerified ? 'Verified' : 'Unverified';
      const joinedDate = user.created_at
        ? new Date(user.created_at * 1000).toLocaleDateString()
        : 'N/A';

      csvContent += `"${user.name}","${user.email}","${user.role}","${status}","${joinedDate}"\n`;
    });

    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `users-export-${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Show success notification
    this.showSuccessNotification(
      `Exported ${this.filteredUsers.length} users to CSV`
    );
  }

  /**
   * Bulk verify emails
   */
  bulkVerifyEmails(): void {
    if (!this.selectedUsers.length) {
      this.showErrorNotification('Please select users first');
      return;
    }

    const updateOperations = this.selectedUsers
      .map((userId) => {
        const user = this.users.find((u) => u.user_id === userId);
        if (!user) return null;

        const metadata = { ...user.metadata, emailVerified: true };
        return this.userService.updateUser(userId, { metadata });
      })
      .filter((op) => op !== null);

    if (updateOperations.length) {
      this.isLoading = true;

      const subscription = forkJoin(updateOperations)
        .pipe(
          catchError((error) => {
            this.showErrorNotification(
              error.message || 'Failed to update users'
            );
            return throwError(() => error);
          }),
          finalize(() => {
            this.isLoading = false;
          })
        )
        .subscribe({
          next: () => {
            this.showSuccessNotification(
              'Email verification status updated for selected users'
            );
            this.loadUsers();
            this.clearSelection();
          },
        });

      this.subscriptions.add(subscription);
    }
  }

  /**
   * Toggle selection of a user
   */
  toggleUserSelection(userId: string, event: Event): void {
    const checkbox = event.target as HTMLInputElement;

    if (checkbox.checked) {
      this.selectedUsers.push(userId);
    } else {
      this.selectedUsers = this.selectedUsers.filter((id) => id !== userId);
    }
  }

  /**
   * Toggle selection of all users
   */
  toggleSelectAll(event: Event): void {
    const checkbox = event.target as HTMLInputElement;

    if (checkbox.checked) {
      this.selectedUsers = this.paginatedUsers.map((user) => user.user_id);
    } else {
      this.selectedUsers = [];
    }
  }

  /**
   * Clear all selected users
   */
  clearSelection(): void {
    this.selectedUsers = [];
  }

  /**
   * Check if user is selected
   */
  isUserSelected(userId: string): boolean {
    return this.selectedUsers.includes(userId);
  }

  /**
   * Check if all users are selected
   */
  areAllSelected(): boolean {
    return (
      this.paginatedUsers.length > 0 &&
      this.paginatedUsers.every((user) =>
        this.selectedUsers.includes(user.user_id)
      )
    );
  }

  /**
   * Close bootstrap modal
   */
  private closeModal(modalId: string): void {
    const modalElement = document.getElementById(modalId);
    if (modalElement) {
      const modalInstance = bootstrap.Modal.getInstance(modalElement);
      if (modalInstance) {
        modalInstance.hide();
      }
    }
  }

  /**
   * Show a success notification
   */
  private showSuccessNotification(message: string): void {
    // This is a placeholder - replace with your preferred notification method
    console.log('Success:', message);
    // Example implementation with alert
    // You might want to replace this with a proper toast notification
    alert(message);
  }

  /**
   * Show an error notification
   */
  private showErrorNotification(message: string): void {
    // This is a placeholder - replace with your preferred notification method
    console.error('Error:', message);
    // Example implementation with alert
    // You might want to replace this with a proper toast notification
    alert(message);
  }
}
