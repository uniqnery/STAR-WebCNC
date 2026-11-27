export function displayNameOf(user: { username: string; displayName?: string | null }): string {
  return user.displayName?.trim() || user.username;
}
