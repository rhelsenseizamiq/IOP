export type Role = 'Viewer' | 'Operator' | 'Administrator' | 'SuperAdmin';

export interface UserInToken {
  sub: string;
  role: Role;
  full_name: string;
  jti: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  role: Role;
  full_name: string;
}
