export type Role = "admin" | "sender" | "drafter";
export type Permission =
  | "compose"
  | "send"
  | "approve"
  | "manage_officers"
  | "manage_brand"
  /** Browse and search the subscriber list. */
  | "view_subscribers"
  /** Delete subscribers and export the list: data leaves the app's control. */
  | "manage_subscribers";

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: ["compose", "send", "approve", "manage_officers", "manage_brand", "view_subscribers", "manage_subscribers"],
  sender: ["compose", "send", "approve", "view_subscribers"],
  drafter: ["compose"],
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}
