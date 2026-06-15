export function resolveRequirementProject(
  requested: string | undefined,
  projects: string[],
  last: string | undefined,
) {
  if (requested) return projects.includes(requested) ? requested : undefined
  if (last && projects.includes(last)) return last
  return projects[0]
}
