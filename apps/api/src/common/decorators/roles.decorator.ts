import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'requiredRoles';
export const PLATFORM_ADMIN_KEY = 'platformAdmin';

/** Requires the caller to hold a platform-level role. */
export const RequiredRoles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** Restricts the route to platform administrators. */
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN_KEY, true);
