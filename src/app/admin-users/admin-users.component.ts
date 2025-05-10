import { Component, OnInit } from '@angular/core';
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
import { forkJoin } from 'rxjs';

declare var bootstrap: any; // For Bootstrap modal

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './admin-users.component.html',
  styleUrls: ['./admin-users.component.scss'],
})
export class AdminUsersComponent implements OnInit {
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

  // Pagination
  currentPage = 1;
  pageSize = 10;
  totalPages = 1;

  // Forms
  addUserForm: FormGroup;
  editUserForm: FormGroup;

  // For template use
  Math = Math;

  constructor(
    private formBuilder: FormBuilder,
    private userService: UserService,
    private router: Router
  ) {
    // Initialize forms
    this.addUserForm = this.formBuilder.group({
      name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      role: ['student'],
    });

    this.editUserForm = this.formBuilder.group({
      name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.minLength(6)]],
      role: ['student'],
      emailVerified: [false],
    });
  }

  ngOnInit(): void {
    // Check if current user is admin
    const currentUser = this.userService.getCurrentUser();
    if (!currentUser || currentUser.role !== 'admin') {
      this.router.navigate(['/unauthorized']);
      return;
    }

    this.loadUsers();
  }

  // Load all users
  loadUsers(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.userService
      .listUsers(100) // Adjust limit as needed
      .subscribe({
        next: (response) => {
          this.users = response.users;
          this.applyFilters();
          this.isLoading = false;
        },
        error: (error) => {
          this.errorMessage = error.message || 'Failed to load users';
          this.isLoading = false;
        },
      });
  }

  // Apply filters and sorting
  applyFilters(): void {
    let result = [...this.users];

    // Apply role filter
    if (this.filterRole) {
      result = result.filter((user) => user.role === this.filterRole);
    }

    // Apply search
    if (this.searchTerm) {
      const search = this.searchTerm.toLowerCase();
      result = result.filter(
        (user) =>
          user.name.toLowerCase().includes(search) ||
          user.email.toLowerCase().includes(search)
      );
    }

    // Apply sorting
    // Apply sorting
    result.sort((a, b) => {
      switch (this.sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'email':
          return a.email.localeCompare(b.email);
        case 'created_at':
          return (a.created_at || 0) - (b.created_at || 0);
        default:
          return 0;
      }
    });

    this.filteredUsers = result;
    this.totalPages = Math.ceil(this.filteredUsers.length / this.pageSize);
    this.setPage(1);
  }

  // Reset all filters
  resetFilters(): void {
    this.searchTerm = '';
    this.filterRole = '';
    this.sortBy = 'name';
    this.applyFilters();
  }

  // Set current page and update displayed users
  setPage(page: number): void {
    if (page < 1 || page > this.totalPages) {
      return;
    }

    this.currentPage = page;
    const startIndex = (page - 1) * this.pageSize;
    const endIndex = Math.min(
      startIndex + this.pageSize,
      this.filteredUsers.length
    );
    this.paginatedUsers = this.filteredUsers.slice(startIndex, endIndex);
  }

  // Get array of page numbers for pagination
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

  // Get user initials for avatar
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

  // Get badge class based on role
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

  // Select user for editing
  editUser(user: User): void {
    this.selectedUser = user;

    this.editUserForm.patchValue({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
      emailVerified: user.metadata?.emailVerified || false,
    });
  }

  // Add new user
  addUser(): void {
    if (this.addUserForm.invalid) {
      return;
    }

    this.isSaving = true;

    const newUser = {
      name: this.addUserForm.value.name,
      email: this.addUserForm.value.email,
      password: this.addUserForm.value.password,
      role: this.addUserForm.value.role,
      metadata: {
        emailVerified: false,
        createdBy: 'admin',
      },
    };

    this.userService.register(newUser).subscribe({
      next: (user) => {
        this.isSaving = false;
        this.users.push(user);
        this.applyFilters();

        // Close modal
        const modal = document.getElementById('addUserModal');
        if (modal) {
          const bsModal = bootstrap.Modal.getInstance(modal);
          bsModal.hide();
        }

        // Reset form
        this.addUserForm.reset({
          role: 'student',
        });
      },
      error: (error) => {
        this.isSaving = false;
        alert(error.message || 'Failed to add user');
      },
    });
  }

  // Update existing user
  updateUser(): void {
    if (this.editUserForm.invalid || !this.selectedUser) {
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

    this.userService
      .updateUser(this.selectedUser.user_id, updateData)
      .subscribe({
        next: (user) => {
          this.isSaving = false;

          // Update user in local array
          const index = this.users.findIndex((u) => u.user_id === user.user_id);
          if (index !== -1) {
            this.users[index] = user;
          }
          this.applyFilters();

          // Close modal
          const modal = document.getElementById('editUserModal');
          if (modal) {
            const bsModal = bootstrap.Modal.getInstance(modal);
            bsModal.hide();
          }
        },
        error: (error) => {
          this.isSaving = false;
          alert(error.message || 'Failed to update user');
        },
      });
  }

  // Confirm deletion with user
  confirmDeleteUser(user: User): void {
    if (
      confirm(
        `Are you sure you want to delete ${user.name}? This action cannot be undone.`
      )
    ) {
      this.deleteUser(user);
    }
  }

  // Delete a user
  deleteUser(user: User): void {
    this.userService.deleteUser(user.user_id).subscribe({
      next: () => {
        // Remove user from local array
        this.users = this.users.filter((u) => u.user_id !== user.user_id);
        this.applyFilters();
      },
      error: (error) => {
        alert(error.message || 'Failed to delete user');
      },
    });
  }

  // Export users to CSV
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
    link.setAttribute('download', 'users.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Bulk operations
  bulkVerifyEmails(): void {
    if (!this.selectedUsers.length) {
      alert('Please select users first');
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
      forkJoin(updateOperations).subscribe({
        next: () => {
          alert('Email verification status updated for selected users');
          this.loadUsers();
          this.selectedUsers = [];
        },
        error: (error) => {
          alert(error.message || 'Failed to update users');
        },
      });
    }
  }

  // Selected users for bulk operations
  selectedUsers: string[] = [];

  toggleUserSelection(userId: string, event: Event): void {
    const checkbox = event.target as HTMLInputElement;

    if (checkbox.checked) {
      this.selectedUsers.push(userId);
    } else {
      this.selectedUsers = this.selectedUsers.filter((id) => id !== userId);
    }
  }

  toggleSelectAll(event: Event): void {
    const checkbox = event.target as HTMLInputElement;

    if (checkbox.checked) {
      this.selectedUsers = this.paginatedUsers.map((user) => user.user_id);
    } else {
      this.selectedUsers = [];
    }
  }

  isUserSelected(userId: string): boolean {
    return this.selectedUsers.includes(userId);
  }

  areAllSelected(): boolean {
    return (
      this.paginatedUsers.length > 0 &&
      this.paginatedUsers.every((user) =>
        this.selectedUsers.includes(user.user_id)
      )
    );
  }
}
