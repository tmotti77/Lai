"use client";

export function TargetRolePicker(_: {
  topRoles: Array<{ id: string; name_he: string }>;
  occupationId: string | null;
  onSelectOccupation: (id: string | null) => void;
  freeText: string;
  onChangeFreeText: (next: string) => void;
}) {
  return <div data-stub="TargetRolePicker" />;
}
