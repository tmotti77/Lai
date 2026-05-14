"use client";

export function TargetRolePicker(_: {
  topRoles: Array<{ id: string; name_he: string }>;
  occupationId: string | null;
  onSelectOccupationAction: (id: string | null) => void;
  freeText: string;
  onChangeFreeTextAction: (next: string) => void;
}) {
  return <div data-stub="TargetRolePicker" />;
}
