import type { CollisionContact } from "./avatarCollisionTypes";

export function formatAvatarCollisionContact(side: "left" | "right", contact: CollisionContact): string {
  const n = contact.surfaceNormal;
  return `${side}.${contact.armPart} -> ${contact.bodyPart}\nsigned distance: ${contact.signedDistance.toFixed(3)}\npenetration: ${contact.penetrationDepth.toFixed(3)}\nnormal: ${n.x.toFixed(3)}, ${n.y.toFixed(3)}, ${n.z.toFixed(3)}`;
}

export function formatAvatarCollisionDiagnostics(side: "left" | "right", contacts: CollisionContact[]): string[] {
  return contacts.map((contact) => formatAvatarCollisionContact(side, contact));
}
