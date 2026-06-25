export function resolveRequirementProject(
  requested: string | undefined,
  projects: string[],
  fallback?: string,
) {
  if (requested) return projects.includes(requested) ? requested : undefined
  if (fallback && projects.includes(fallback)) return fallback
  return undefined
}
