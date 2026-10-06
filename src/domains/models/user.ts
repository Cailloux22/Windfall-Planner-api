import type { DeviceLabel } from '#models/device';

// openapi.yml : User.
export interface UserDto {
  id: string;
  email: string;
  createdAt: string;
}

// openapi.yml : AuthResult (RT_67).
export interface AuthResult {
  deviceToken: string;
  user: UserDto;
}

export function toUserDto(user: { id: string; email: string; createdAt: Date }): UserDto {
  return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() };
}

export type { DeviceLabel };
