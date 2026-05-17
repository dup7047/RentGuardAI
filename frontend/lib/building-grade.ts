export type BuildingGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export function computeBuildingGrade(openViolations: number): BuildingGrade {
  if (openViolations < 0) {
    throw new Error('openViolations cannot be negative');
  }
  if (openViolations < 5) return 'A';
  if (openViolations < 20) return 'B';
  if (openViolations < 50) return 'C';
  if (openViolations < 100) return 'D';
  return 'F';
}
