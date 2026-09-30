export type Role = "admin" | "sender" | "drafter";
export type Permission = "compose" | "send" | "approve" | "manage_officers" | "manage_brand";

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: ["compose", "send", "approve", "manage_officers", "manage_brand"],
  sender: ["compose", "send", "approve"],
  drafter: ["compose"],
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}
